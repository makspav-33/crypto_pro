"""JWT-protected text and bounded in-memory file operations; no uploaded files on disk."""
import json
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from .auth import Session
from .ciphers import transform, validate_key
from .sdes import transform_text
from .history import record_operation

router = APIRouter(prefix="/api/crypto", tags=["Crypto Lab"])
Algorithm = Literal["caesar", "vertical", "horizontal", "combined"]
Operation = Literal["encrypt", "decrypt"]
FILE_LIMIT = 1024 * 1024
UPLOAD_LIMIT = 8 * FILE_LIMIT


class TextInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    algorithm: Algorithm
    key: str = Field(min_length=1, max_length=101)
    text: str = Field(max_length=10000)
    language: Literal["UA", "EN"] = "UA"


class SDesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    algorithm: Literal["sdes"]
    key: str
    text: str = Field(max_length=80000)


@router.post("/text/{operation}")
def text_operation(operation: Operation, data: TextInput | SDesInput, session: Session, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        if isinstance(data, SDesInput):
            result = transform_text(data.text, data.key, operation == "decrypt")
        else:
            result = transform(data.text, data.algorithm, data.key, operation == "decrypt", language=data.language)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    record_operation(session[0]["id"], data.algorithm, operation, "text")
    return result


@router.post("/files/{operation}")
async def file_operation(operation: Operation, request: Request, session: Session,
                         algorithm: Algorithm, key: str = Query(min_length=1, max_length=101),
                         filename: str = Query(max_length=255), language: Literal["UA", "EN"] = "UA"):
    if not filename.lower().endswith(".txt"):
        raise HTTPException(422, "Дозволені лише .txt файли")
    try:
        validate_key(algorithm, key)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    limit = FILE_LIMIT if operation == "encrypt" else UPLOAD_LIMIT
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > limit:
            raise HTTPException(413, "Завеликий файл: до 1 MiB оригіналу або 8 MiB контейнера")
        body.extend(chunk)
    try:
        text = body.decode("utf-8")  # Keep BOM and CRLF as actual characters for exact restoration.
    except UnicodeDecodeError:
        raise HTTPException(422, "Файл має бути коректним UTF-8") from None
    try:
        if operation == "encrypt":
            result = transform(text, algorithm, key, visualize=False, language=language)["result"]
            output = json.dumps({"format": "DigitalVault", "version": 1, "algorithm": algorithm,
                                 "length": len(text), "key_width": None if algorithm == "caesar" else len(key),
                                 "language": language if algorithm == "caesar" else None,
                                 "ciphertext": result}, ensure_ascii=False).encode("utf-8")
        else:
            try:
                envelope = json.loads(text)
            except (ValueError, RecursionError):
                raise ValueError("Для розшифрування завантажте зашифрований DigitalVault .txt контейнер")
            if not isinstance(envelope, dict) or envelope.get("format") != "DigitalVault" or type(envelope.get("version")) is not int or envelope["version"] != 1:
                raise ValueError("Невідомий формат контейнера")
            cipher = envelope.get("ciphertext")
            if envelope.get("algorithm") != algorithm:
                raise ValueError("Вибраний алгоритм не відповідає метаданим файлу")
            if not isinstance(cipher, str) or type(envelope.get("length")) is not int or envelope["length"] != len(cipher):
                raise ValueError("Некоректна початкова довжина в метаданих")
            if algorithm != "caesar" and envelope.get("key_width") != len(key):
                raise ValueError("Довжина ключа не відповідає метаданим")
            if algorithm == "caesar" and "language" in envelope and envelope["language"] != language:
                raise ValueError("Оберіть мову, вказану в метаданих файлу: UA або EN")
            if len(cipher.encode("utf-8")) > FILE_LIMIT:
                raise ValueError("Вміст контейнера перевищує 1 MiB")
            # Legacy containers without language used both alphabets; retain their reversibility.
            selected_language = language if "language" in envelope else None
            output = transform(cipher, algorithm, key, decrypt=True, visualize=False, language=selected_language)["result"].encode("utf-8")
    except (ValueError, UnicodeEncodeError) as error:
        raise HTTPException(422, str(error)) from None
    record_operation(session[0]["id"], algorithm, operation, "file", filename)
    return Response(output, media_type="text/plain; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="digitalvault-{operation}.txt"',
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
