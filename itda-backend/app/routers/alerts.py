# app/routers/alerts.py
from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Dict, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Customer, InventoryItem, AlertResolved
from ..services import forecast

router = APIRouter()


class ResolveReq(BaseModel):
    id: str


# ------ 알림 생성: 고객 돌봄(최근 2주 이상 미방문) ------
def _alerts_from_care_db(now: datetime, db: Session) -> List[Dict[str, Any]]:
    two_weeks_ago = now - timedelta(days=14)
    rows = db.execute(
        select(Customer).where(Customer.last_visit.is_(None) | (Customer.last_visit < two_weeks_ago))
    ).scalars().all()

    out: List[Dict[str, Any]] = []
    for c in rows:
        last = c.last_visit or datetime.min
        out.append(
            {
                "id": f"care-{c.id}",
                "type": "emergency",
                "message": f"{c.name} {last.day}일 미방문 — 복지팀 확인 필요",
                "ts": now.isoformat(),
            }
        )
    return out


# ------ 알림 생성: 차량 재고 vs 예측 수요 ------
def _alerts_from_inventory_db(now: datetime, db: Session, vehicle_id: int = 1) -> List[Dict[str, Any]]:
    # 차량 재고 읽기
    items = db.execute(
        select(InventoryItem).where(InventoryItem.vehicle_id == vehicle_id)
    ).scalars().all()
    if not items:
        return []

    product_ids = [int(r.product_id) for r in items]
    # 마을 1~3 합산 예측
    preds = forecast.forecast(now.date().isoformat(), [1, 2, 3], product_ids)
    pred_by_pid: Dict[int, int] = {}
    for it in preds:
        pred_by_pid[it.product_id] = pred_by_pid.get(it.product_id, 0) + int(it.qty)

    out: List[Dict[str, Any]] = []
    for r in items:
        pid = int(r.product_id)
        onhand = int(r.qty or 0)
        expected = int(pred_by_pid.get(pid, 0))
        if expected > onhand + 5:
            name = r.name or f"상품 #{pid}"
            out.append(
                {
                    "id": f"inv-{vehicle_id}-{pid}-{int(now.timestamp())}",
                    "type": "warning",
                    "message": f"A차량 {name} 재고 부족 예상 (보유 {onhand}, 예측 {expected})",
                    "ts": now.isoformat(),
                }
            )
    return out


def _filter_resolved(db: Session, alerts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not alerts:
        return alerts
    ids = [a["id"] for a in alerts]
    resolved = {
        r.id for r in db.execute(select(AlertResolved).where(AlertResolved.id.in_(ids))).scalars().all()
    }
    return [a for a in alerts if a["id"] not in resolved]


@router.get("/recent")
def recent_alerts(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    alerts: List[Dict[str, Any]] = []
    alerts += _alerts_from_care_db(now, db)
    alerts += _alerts_from_inventory_db(now, db, vehicle_id=1)
    alerts = _filter_resolved(db, alerts)
    alerts.sort(key=lambda x: x["ts"], reverse=True)
    return {"alerts": alerts[:10]}


@router.post("/resolve")
def resolve_alert(req: ResolveReq, db: Session = Depends(get_db)):
    # 처리된 알림을 기록하여 재표시 방지
    db.add(AlertResolved(id=req.id))
    db.commit()
    return {"ok": True, "resolved_id": req.id}
