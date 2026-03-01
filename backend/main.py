import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import property as property_router

# Load .env from project root (one level above /backend)
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

print(f"DEBUG: EPC_EMAIL={os.getenv('EPC_EMAIL')}, KEY_LEN={len(os.getenv('EPC_API_KEY',''))}")

app = FastAPI(title="PropVal API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(property_router.router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
