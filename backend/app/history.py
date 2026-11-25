"""User-scoped metadata only. Never accepts content, keys or tokens for persistence."""
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response

from .auth import Session
from .database import get_connection

router = APIRouter(prefix="/api/history", tags=["History"])


def record_operation(user_id: int, algorithm: str, operation: str, data_type: str, filename: str | None = None):
    # Strip client-supplied paths; only a display filename belongs in history.
    name = filename.replace("\\", "/").split("/")[-1] if filename is not None else None
    with get_connection() as connection:
        connection.execute("""INSERT INTO operation_history(user_id, algorithm, operation, data_type, filename)
                              VALUES (?, ?, ?, ?, ?)""", (user_id, algorithm, operation, data_type, name))


@router.get("")
def list_history(session: Session, response: Response, search: str = Query(default="", max_length=255),
                 algorithm: Literal['caesar', 'horizontal', 'vertical', 'combined'] | None = None,
                 operation: Literal['encrypt', 'decrypt'] | None = None,
                 data_type: Literal['text', 'file'] | None = None,
                 limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0)):
    response.headers["Cache-Control"] = "no-store"
    clauses = ["user_id = ?"]
    params = [session[0]["id"]]
    for column, value in (("algorithm", algorithm), ("operation", operation), ("data_type", data_type)):
        if value is not None:
            clauses.append(f"{column} = ?")
            params.append(value)
    if search:
        clauses.append("(instr(lower(coalesce(filename,'')), lower(?)) > 0 OR instr(algorithm, lower(?)) > 0 OR instr(CAST(id AS TEXT), ?) > 0)")
        params.extend([search, search, search])
    where = " AND ".join(clauses)
    with get_connection() as connection:
        connection.execute("BEGIN")
        total = connection.execute(f"SELECT count(*) FROM operation_history WHERE {where}", params).fetchone()[0]
        rows = connection.execute(f"SELECT * FROM operation_history WHERE {where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", [*params, limit, offset]).fetchall()
    return {"items": [dict(row) for row in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/stats")
def stats(session: Session, response: Response):
    response.headers["Cache-Control"] = "no-store"
    user_id = session[0]["id"]
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=6)
    with get_connection() as connection:
        # One read transaction keeps all aggregates consistent during concurrent writes.
        connection.execute("BEGIN")
        totals = dict(connection.execute("""SELECT count(*) AS total_operations,
            coalesce(sum(operation = 'encrypt'),0) AS encryptions,
            coalesce(sum(operation = 'decrypt'),0) AS decryptions,
            coalesce(sum(data_type = 'file'),0) AS files_processed
            FROM operation_history WHERE user_id = ?""", (user_id,)).fetchone())
        distribution = [dict(row) for row in connection.execute("""SELECT algorithm, count(*) AS count FROM operation_history
            WHERE user_id = ? GROUP BY algorithm ORDER BY count DESC, algorithm ASC""", (user_id,))]
        daily = dict(connection.execute("""SELECT substr(created_at,1,10), count(*) FROM operation_history
            WHERE user_id = ? AND created_at >= ? AND created_at < ? GROUP BY substr(created_at,1,10)""",
            (user_id, str(start), str(today + timedelta(days=1)))).fetchall())
        recent = [dict(row) for row in connection.execute("SELECT * FROM operation_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 5", (user_id,))]
    return {**totals, "most_used_algorithm": distribution[0]["algorithm"] if distribution else None,
            "algorithms": distribution, "activity": [{"date": str(start + timedelta(days=i)), "count": daily.get(str(start + timedelta(days=i)), 0)} for i in range(7)],
            "recent": recent, "timezone": "UTC"}


@router.delete("/{record_id}", status_code=204)
def delete_record(record_id: int, session: Session):
    with get_connection() as connection:
        deleted = connection.execute("DELETE FROM operation_history WHERE id = ? AND user_id = ?", (record_id, session[0]["id"])).rowcount
        if not deleted:
            raise HTTPException(404, "Запис не знайдено")
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.delete("", status_code=204)
def clear_history(session: Session):
    with get_connection() as connection:
        connection.execute("DELETE FROM operation_history WHERE user_id = ?", (session[0]["id"],))
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
