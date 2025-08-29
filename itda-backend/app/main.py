# app/main.py
from __future__ import annotations

from pathlib import Path
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .db import create_db_and_tables
from .routers import route, demand, care, alerts, inventory, sales
from .routers import vehicles


BASE_DIR = Path(__file__).resolve().parent  # app 디렉터리
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(
    title="ITDA API",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# CORS (개발 단계에서는 * 허용, 운영에서는 도메인 지정 권장)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 정적 파일 서비스 (파비콘 등)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.on_event("startup")
def on_startup() -> None:
    # SQLite 테이블 생성 (모델 기준으로 자동 생성)
    create_db_and_tables()

@app.get("/")
def root():
    return {"ok": True, "message": "ITDA backend running", "docs": "/docs"}

@app.get("/healthz")
def healthz():
    return {"ok": True}

# 파비콘 제공: 있으면 파일 제공, 없으면 204 (로그 지저분해지지 않도록)
@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    icon = STATIC_DIR / "favicon.ico"
    if icon.exists():
        return FileResponse(str(icon), media_type="image/x-icon")
    return Response(status_code=204)

# 라우터 등록
app.include_router(route.router,     prefix="/route",     tags=["route"])
app.include_router(demand.router,    prefix="/demand",    tags=["demand"])
app.include_router(care.router,      prefix="/care",      tags=["care"])
app.include_router(alerts.router,    prefix="/alerts",    tags=["alerts"])
app.include_router(inventory.router, prefix="/inventory", tags=["inventory"])
app.include_router(sales.router,     prefix="/sales",     tags=["sales"])
app.include_router(vehicles.router,  prefix="/vehicles",  tags=["vehicles"]) 