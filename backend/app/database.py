"""SQLite connections and additive schema initialization."""
import sqlite3
from contextlib import contextmanager
from collections.abc import Iterator

from .config import DATABASE_PATH


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database() -> None:
    with get_connection() as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )
        """)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS operation_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                algorithm TEXT NOT NULL,
                operation TEXT NOT NULL CHECK(operation IN ('encrypt','decrypt')),
                data_type TEXT NOT NULL CHECK(data_type IN ('text','file')),
                filename TEXT,
                status TEXT NOT NULL DEFAULT 'success' CHECK(status = 'success')
            )
        """)
        connection.execute("CREATE INDEX IF NOT EXISTS history_user_date ON operation_history(user_id, created_at DESC, id DESC)")
