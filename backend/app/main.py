from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import APP_NAME, CORS_ORIGINS
from .database import initialize_database
from .auth import router
from .crypto import router as crypto_router
from .history import router as history_router
from .config import validate_auth_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_auth_settings()
    initialize_database()
    yield


app = FastAPI(title=APP_NAME, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)
app.include_router(router)
app.include_router(crypto_router)
app.include_router(history_router)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request, exc):
    # Do not echo request inputs: validation errors may contain plaintext passwords.
    return JSONResponse(status_code=422, content={"detail": [
        {"loc": list(error["loc"]), "msg": error["msg"], "type": error["type"]}
        for error in exc.errors()
    ]})


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "DigitalVault", "version": "0.1.0"}
