import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from routers import admin as admin_router
from routers import comparables as comparables_router
from routers import property as property_router
from routers.property import _load_green_belt_polygons

# Load .env from project root (one level above /backend)
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Download reference datasets once at startup before serving requests."""
    _load_green_belt_polygons()
    yield


app = FastAPI(title="PropVal API", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    body = await request.body()
    logging.error("422 Validation error on %s\nBody: %s\nErrors: %s",
                  request.url.path, body.decode()[:2000], exc.errors())
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(property_router.router)
app.include_router(comparables_router.router)
app.include_router(admin_router.router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
