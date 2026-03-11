import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from routers import admin as admin_router
from routers import cases as cases_router
from routers import comparables as comparables_router
from routers import firm_templates as firm_templates_router
from routers import news as news_router
from routers import property as property_router
from routers.property import _load_green_belt_polygons
from routers.rate_limit import limiter
from services.inspire import InspireService

# Load .env from project root (one level above /backend)
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Download reference datasets once at startup before serving requests."""
    import asyncio
    _load_green_belt_polygons()
    app.state.inspire = await asyncio.to_thread(InspireService.load)
    await news_router.start_background_refresh()
    await news_router.start_market_refresh()
    yield


app = FastAPI(title="PropVal API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    body = await request.body()
    logging.error("422 Validation error on %s\nBody: %s\nErrors: %s",
                  request.url.path, body.decode()[:2000], exc.errors())
    return JSONResponse(status_code=422, content={"detail": "Invalid request data"})


app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

@app.middleware("http")
async def request_timeout(request: Request, call_next):
    """Hard 90s cap on every request — prevents hung external API calls draining server resources."""
    import asyncio
    try:
        return await asyncio.wait_for(call_next(request), timeout=90.0)
    except asyncio.TimeoutError:
        logging.error("Request hard timeout (>90s): %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=503,
            content={"detail": "The request timed out. Please try again."},
        )


@app.middleware("http")
async def maintenance_guard(request: Request, call_next):
    """Block all API requests (except /health) when MAINTENANCE_MODE=true."""
    if os.getenv("MAINTENANCE_MODE", "").lower() in ("true", "1"):
        if request.url.path != "/health":
            return JSONResponse(status_code=503, content={"detail": "Service is under maintenance"})
    return await call_next(request)


app.include_router(property_router.router)
app.include_router(comparables_router.router)
app.include_router(cases_router.router)
app.include_router(admin_router.router)
app.include_router(firm_templates_router.router)
app.include_router(news_router.router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
