# app/db.py
from __future__ import annotations
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "itda.db"
DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # SQLite에서 필요
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

def create_db_and_tables():
    from . import models  # 모델 등록
    Base.metadata.create_all(bind=engine)

# FastAPI 의존성
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
