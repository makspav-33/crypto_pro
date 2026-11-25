"""Pure educational ciphers. Positions refer to Unicode code points, never bytes."""
import re

EN = "abcdefghijklmnopqrstuvwxyz"
UK = "абвгґдеєжзиіїйклмнопрстуфхцчшщьюя"
ALGORITHMS = ("caesar", "vertical", "horizontal", "combined")
RULES = {
    "caesar": "Кожна літера зміщується в межах власного алфавіту (EN: 26, UK: 33). Регістр збережено; інші символи незмінні.",
    "horizontal": "Запис рядками шириною N. Цифри ключа — ранги стовпців. У кожному рядку читаємо клітинки за зростанням рангу. Відсутні клітинки пропускаємо.",
    "vertical": "Запис рядками шириною N. Цифри ключа — ранги стовпців. Читаємо стовпці згори вниз за зростанням рангу. Відсутні клітинки пропускаємо.",
    "combined": "Спочатку горизонтальна перестановка, потім вертикальна з тим самим ключем. Розшифрування виконує обернені кроки у зворотному порядку.",
}


def validate_key(algorithm: str, key: str):
    if algorithm not in ALGORITHMS:
        raise ValueError("Невідомий алгоритм")
    if algorithm == "caesar":
        if not re.fullmatch(r"[+-]?[0-9]{1,100}", key):
            raise ValueError("Ключ Цезаря — ціле число (до 100 цифр)")
        return int(key)
    if not 2 <= len(key) <= 9 or sorted(key) != [str(i) for i in range(1, len(key) + 1)]:
        raise ValueError("Ключ перестановки: кожна цифра від 1 до N рівно раз, 2 ≤ N ≤ 9; наприклад 1324")
    return sorted(range(len(key)), key=lambda index: key[index])


def index_order(length: int, width: int, columns: list[int], kind: str) -> list[int]:
    if kind == "horizontal":
        return [row + col for row in range(0, length, width) for col in columns if row + col < length]
    return [pos for col in columns for pos in range(col, length, width)]


def transform(text: str, algorithm: str, key: str, decrypt: bool = False, visualize: bool = True, language: str | None = None) -> dict:
    parsed = validate_key(algorithm, key)
    steps = []
    if algorithm == "caesar":
        if language not in (None, "UA", "EN"):
            raise ValueError("Мова Цезаря має бути UA або EN")
        shift = -parsed if decrypt else parsed
        mapping = {}
        alphabets = []
        for alphabet in ((UK,) if language == "UA" else (EN,) if language == "EN" else (EN, UK)):
            shifted = alphabet[shift % len(alphabet):] + alphabet[:shift % len(alphabet)]
            mapping.update(zip(alphabet, shifted))
            mapping.update(zip(alphabet.upper(), shifted.upper()))
            alphabets.append({"source": alphabet, "shifted": shifted, "shift": shift % len(alphabet)})
        result = "".join(mapping.get(char, char) for char in text)
        if visualize:
            steps = [{"kind": "caesar", "alphabets": alphabets,
                      "characters": [{"input": a, "output": b, "position": i + 1} for i, (a, b) in enumerate(zip(text[:120], result[:120]))]}]
    else:
        kinds = ["horizontal", "vertical"] if algorithm == "combined" else [algorithm]
        if decrypt:
            kinds.reverse()
        result = text
        for kind in kinds:
            order = index_order(len(text), len(key), parsed, kind)
            if decrypt:
                inverse = [0] * len(order)
                for output, source in enumerate(order):
                    inverse[source] = output
                order = inverse
            before = result
            result = "".join(before[index] for index in order)
            if visualize:
                steps.append({"kind": kind, "inverse": decrypt, "width": len(key),
                              "columns": [i + 1 for i in parsed], "ranks": list(key),
                              "input": before[:120], "output": result[:120],
                              "output_to_input": [i + 1 for i in order[:120]],
                              "length": len(text)})
    return {"result": result, "algorithm": algorithm, "operation": "decrypt" if decrypt else "encrypt",
            "length": len(text), "rule": (f"Цезар · {language}: {33 if language == 'UA' else 26} літер; інші символи незмінні." if algorithm == "caesar" and language else RULES[algorithm]), "steps": steps,
            "preview_limit": 120, "truncated": len(text) > 120}
