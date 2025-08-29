# app/seed/seed_db.py
"""
JSON 시드파일을 읽어 SQLite DB에 주입
실행:
    python -m app.seed.seed_db
"""
from __future__ import annotations
from pathlib import Path
import json
from datetime import datetime
from sqlalchemy.orm import Session

from ..db import SessionLocal, create_db_and_tables
from ..models import Customer, Note, InventoryItem

BASE = Path(__file__).resolve().parent
CUSTOMERS_JSON = BASE / "customers.json"
INV1_JSON = BASE / "inventory_vehicle_1.json"

def _read_json(p: Path, default):
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default

def seed():
    create_db_and_tables()
    db: Session = SessionLocal()
    try:
        # 고객
        if db.query(Customer).count() == 0:
            customers = _read_json(CUSTOMERS_JSON, [])
            for c in customers:
                last_visit = None
                if c.get("last_visit"):
                    try:
                        last_visit = datetime.fromisoformat(c["last_visit"])
                    except Exception:
                        last_visit = None
                db.add(Customer(
                    id=c.get("id"),
                    name=c.get("name", "고객"),
                    village_id=c.get("village_id", 1),
                    tags_json=json.dumps(c.get("tags", []), ensure_ascii=False),
                    last_visit=last_visit
                ))
            db.commit()
            # 데모 노트 1~2개
            cs = db.query(Customer).all()
            for c in cs:
                db.add(Note(customer_id=c.id, note=f"{c.name} 초기 메모", tags_json="[]"))
            db.commit()

        # 차량1 재고
        if db.query(InventoryItem).filter(InventoryItem.vehicle_id == 1).count() == 0:
            inv = _read_json(INV1_JSON, {"items": []})
            for it in inv.get("items", []):
                db.add(InventoryItem(
                    vehicle_id=1,
                    product_id=int(it.get("product_id")),
                    name=it.get("name") or f"상품#{it.get('product_id')}",
                    qty=int(it.get("qty", 0)),
                ))
            db.commit()

        print("[OK] DB seed completed.")
    finally:
        db.close()

if __name__ == "__main__":
    seed()
