# app/routers/inventory.py
from __future__ import annotations
from fastapi import APIRouter, Path as PathParam, Depends
from typing import Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import select, delete
from ..db import get_db
from ..models import InventoryItem

router = APIRouter()

@router.get("/vehicle/{vehicle_id}")
def vehicle_inventory(vehicle_id: int = PathParam(..., ge=1), db: Session = Depends(get_db)):
    rows = db.execute(select(InventoryItem).where(InventoryItem.vehicle_id == vehicle_id)).scalars().all()
    items = [
        {"product_id": r.product_id, "name": r.name, "qty": r.qty}
        for r in rows
    ]
    return {"items": items}

@router.post("/vehicle/{vehicle_id}/set")
def set_vehicle_inventory(payload: Dict[str, Any], vehicle_id: int = PathParam(..., ge=1), db: Session = Depends(get_db)):
    items = payload.get("items", [])
    # 기존 데이터 삭제 후 삽입
    db.execute(delete(InventoryItem).where(InventoryItem.vehicle_id == vehicle_id))
    for it in items:
        db.add(InventoryItem(
            vehicle_id=vehicle_id,
            product_id=int(it.get("product_id")),
            name=it.get("name") or f"상품#{it.get('product_id')}",
            qty=int(it.get("qty", 0)),
        ))
    db.commit()
    return {"ok": True}
