# app/routers/care.py
from __future__ import annotations
from typing import Optional, List
from datetime import datetime
import json

from fastapi import APIRouter, Depends, Query, Path as PathParam, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Customer, Note

router = APIRouter()

# -------- JSON <-> 배열 유틸 --------
def _j2a(s: Optional[str]) -> List[str]:
    try:
        return json.loads(s or "[]")
    except Exception:
        return []

def _a2j(a: Optional[List[str]]) -> str:
    try:
        return json.dumps(a or [], ensure_ascii=False)
    except Exception:
        return "[]"

# -------- 조회 --------
@router.get("/customers")
def customers(village_id: Optional[int] = Query(default=None), db: Session = Depends(get_db)):
    stmt = select(Customer)
    if village_id is not None:
        stmt = stmt.where(Customer.village_id == village_id)
    rows = db.execute(stmt).scalars().all()
    return {
        "customers": [
            {
                "id": r.id,
                "name": r.name,
                "village_id": r.village_id,
                "tags": _j2a(r.tags_json),
                "last_visit": r.last_visit.isoformat() if r.last_visit else None,
            }
            for r in rows
        ]
    }

@router.get("/notes")
def notes(customer_id: Optional[int] = Query(default=None), db: Session = Depends(get_db)):
    if customer_id is None:
        return {"notes": []}
    stmt = select(Note).where(Note.customer_id == customer_id).order_by(desc(Note.ts))
    rows = db.execute(stmt).scalars().all()
    return {
        "notes": [
            {
                "id": n.id,
                "customer_id": n.customer_id,
                "ts": n.ts.isoformat(),
                "note": n.note,
                "tags": _j2a(n.tags_json),
            }
            for n in rows
        ]
    }

class CareNoteIn(BaseModel):
    customer_id: int
    note: str
    tags: List[str] = []

@router.post("/note")
def add_note(payload: CareNoteIn, db: Session = Depends(get_db)):
    # 존재 확인
    c = db.get(Customer, payload.customer_id)
    if not c:
        raise HTTPException(status_code=404, detail="customer not found")
    n = Note(
        customer_id=payload.customer_id,
        note=payload.note,
        tags_json=_a2j(payload.tags),
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return {"ok": True, "note_id": n.id}

# -------- 고객 CRUD --------
class CustomerIn(BaseModel):
    name: str
    village_id: int
    tags: List[str] = []
    last_visit: Optional[str] = None  # ISO8601

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    village_id: Optional[int] = None
    tags: Optional[List[str]] = None
    last_visit: Optional[str] = None  # ISO8601

@router.post("/customer")
def create_customer(payload: CustomerIn, db: Session = Depends(get_db)):
    last_visit_dt = None
    if payload.last_visit:
        try:
            last_visit_dt = datetime.fromisoformat(payload.last_visit)
        except Exception:
            raise HTTPException(status_code=422, detail="invalid last_visit")
    c = Customer(
        name=payload.name,
        village_id=payload.village_id,
        tags_json=_a2j(payload.tags),
        last_visit=last_visit_dt,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"ok": True, "id": c.id}

@router.patch("/customer/{customer_id}")
def update_customer(
    payload: CustomerUpdate,
    customer_id: int = PathParam(..., ge=1),
    db: Session = Depends(get_db),
):
    c = db.get(Customer, customer_id)
    if not c:
        raise HTTPException(status_code=404, detail="customer not found")

    if payload.name is not None:
        c.name = payload.name
    if payload.village_id is not None:
        c.village_id = payload.village_id
    if payload.tags is not None:
        c.tags_json = _a2j(payload.tags)
    if payload.last_visit is not None:
        try:
            c.last_visit = datetime.fromisoformat(payload.last_visit) if payload.last_visit else None
        except Exception:
            raise HTTPException(status_code=422, detail="invalid last_visit")

    db.commit()
    return {"ok": True}

@router.delete("/customer/{customer_id}")
def delete_customer(customer_id: int = PathParam(..., ge=1), db: Session = Depends(get_db)):
    c = db.get(Customer, customer_id)
    if not c:
        raise HTTPException(status_code=404, detail="customer not found")
    db.delete(c)  # Note는 cascade로 함께 삭제
    db.commit()
    return {"ok": True}

@router.post("/customer/{customer_id}/visit")
def mark_visit_now(customer_id: int = PathParam(..., ge=1), db: Session = Depends(get_db)):
    c = db.get(Customer, customer_id)
    if not c:
        raise HTTPException(status_code=404, detail="customer not found")
    c.last_visit = datetime.utcnow()
    db.commit()
    return {"ok": True, "last_visit": c.last_visit.isoformat()}
