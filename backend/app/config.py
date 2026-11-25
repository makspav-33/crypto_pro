"""Local settings, loaded from the root .env independently of working directory."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".env"
# Absolute path also supports running uvicorn from backend/ or another directory.
# Accept UTF-8 BOM from Windows editors; explicit process settings take precedence.
load_dotenv(ENV_FILE, encoding="utf-8-sig", override=False)
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_TTL_MINUTES = int(os.getenv("JWT_TTL_MINUTES", "15"))


def validate_auth_settings() -> None:
    if len(JWT_SECRET.encode()) < 32:
        raise RuntimeError("Set JWT_SECRET to a random secret of at least 32 bytes in the root .env")
    if not 1 <= JWT_TTL_MINUTES <= 60:
        raise RuntimeError("JWT_TTL_MINUTES must be between 1 and 60")

APP_NAME = os.getenv("APP_NAME", "DigitalVault")
_database_path = Path(os.getenv("DATABASE_PATH", "backend/data/digitalvault.db"))
DATABASE_PATH = _database_path if _database_path.is_absolute() else ROOT / _database_path
CORS_ORIGINS = [origin.strip() for origin in os.getenv(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",") if origin.strip()]
