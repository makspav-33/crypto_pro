import sqlite3
import time
from typing import Annotated

import jwt
from argon2 import PasswordHasher, Type
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .config import JWT_SECRET, JWT_TTL_MINUTES
from .database import get_connection

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
hasher = PasswordHasher(type=Type.ID)
# Equalize password verification work for unknown email addresses.
dummy_hash = hasher.hash("unused-dummy-password")
bearer = HTTPBearer(auto_error=False)


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        return value.strip().lower() if isinstance(value, str) else value


class Registration(Credentials):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=12, max_length=128)


class PublicUser(BaseModel):
    id: int
    username: str
    email: str
    created_at: str


class LoginResult(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: int
    user: PublicUser


def unauthorized() -> HTTPException:
    return HTTPException(401, "Сесію завершено або токен недійсний", headers={"WWW-Authenticate": "Bearer"})


def current_session(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
    if credentials is None:
        raise unauthorized()
    try:
        claims = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"],
                            options={"require": ["sub", "iat", "exp"]})
        if not claims["sub"].isdigit() or type(claims["iat"]) is not int or type(claims["exp"]) is not int:
            raise unauthorized()
        if claims["exp"] <= claims["iat"]:
            raise unauthorized()
    except jwt.InvalidTokenError:
        raise unauthorized() from None
    with get_connection() as connection:
        user = connection.execute("SELECT id, username, email, created_at FROM users WHERE id = ?", (claims["sub"],)).fetchone()
    if user is None:
        raise unauthorized()
    return dict(user), claims


Session = Annotated[tuple, Depends(current_session)]


@router.post("/register", response_model=PublicUser, status_code=201)
def register(data: Registration, response: Response):
    response.headers["Cache-Control"] = "no-store"
    password_hash = hasher.hash(data.password)
    try:
        with get_connection() as connection:
            cursor = connection.execute("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
                                        (data.username, str(data.email), password_hash))
            user = connection.execute("SELECT id, username, email, created_at FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Цей email уже зареєстровано") from None
    return dict(user)


@router.post("/login", response_model=LoginResult)
def login(data: Credentials, response: Response):
    response.headers["Cache-Control"] = "no-store"
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM users WHERE email = ?", (str(data.email),)).fetchone()
    try:
        hasher.verify(row["password_hash"] if row else dummy_hash, data.password)
    except (VerificationError, InvalidHashError):
        raise HTTPException(401, "Неправильний email або пароль", headers={"WWW-Authenticate": "Bearer"}) from None
    if row is None:
        raise unauthorized()
    if hasher.check_needs_rehash(row["password_hash"]):
        with get_connection() as connection:
            connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hasher.hash(data.password), row["id"]))
    now = int(time.time())
    claims = {"sub": str(row["id"]), "name": row["username"], "email": row["email"],
              "iat": now, "exp": now + JWT_TTL_MINUTES * 60}
    return {"access_token": jwt.encode(claims, JWT_SECRET, algorithm="HS256"),
            "expires_at": claims["exp"], "user": {key: row[key] for key in ("id", "username", "email", "created_at")}}


@router.get("/me", response_model=PublicUser)
def me(session: Session, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return session[0]


@router.get("/token-info")
def token_info(session: Session, response: Response):
    response.headers["Cache-Control"] = "no-store"
    claims = session[1]
    return {"header": {"alg": "HS256", "typ": "JWT"},
            "payload": {key: claims[key] for key in ("sub", "name", "email", "iat", "exp") if key in claims},
            "signature": {"verified": True, "value": "Приховано", "algorithm": "HMAC-SHA256"}}
