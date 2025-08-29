from __future__ import annotations

from datetime import datetime
from typing import List, Dict, Any

from fastapi import APIRouter
from pydantic import BaseModel

# --- DB 안전 어댑터 ----------------------------------------------------------
# db.py가 어떤 형태든(컨텍스트매니저 DB(), load_db(), read_db() 등) 읽어오도록 처리
def _read_db() -> Dict[str, Any]:
    try:
        # 우선 DB() 컨텍스트 매니저 시도
        from ..db import DB as _DB  # type: ignore
        with _DB() as d:            # type: ignore
            return dict(d)
    except Exception:
        try:
            from ..db import load_db  # type: ignore
            return dict(load_db())    # type: ignore
        except Exception:
            try:
                from ..db import read_db  # type: ignore
                return dict(read_db())    # type: ignore
            except Exception:
                # 최후: 빈 메모리 DB
                return {}

# ---------------------------------------------------------------------------

from ..services import forecast

router = APIRouter()


class ResolveReq(BaseModel):
    id: str


def _alerts_from_care(now: datetime, db: Dict[str, Any]) -> List[Dict[str, Any]]:
    """최근 2주 이상 미방문 고객 경고(데모)"""
    out: List[Dict[str, Any]] = []
    customers = db.get("care_customers", [])
    for c in customers:
        last_visit = c.get("last_visit")
        if not last_visit:
            continue
        try:
            last = datetime.fromisoformat(last_visit)
        except Exception:
            continue
        days = (now - last).days
        if days >= 14:
            out.append(
                {
                    "id": f"care-{c['id']}",
                    "type": "emergency",
                    "message": f"{c.get('name','고객')} {last.day}일 미방문 — 복지팀 확인 필요",
                    "ts": now.isoformat(),
                }
            )
    return out


def _alerts_from_inventory(now: datetime, db: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    차량 #1 재고 vs. 예측수요 비교. 부족하면 경고.
    """
    out: List[Dict[str, Any]] = []
    vehicle_inv = db.get("vehicle_inventories", {}).get(1, [])
    if not vehicle_inv:
        return out

    product_ids = [int(x.get("product_id")) for x in vehicle_inv if "product_id" in x]
    if not product_ids:
        return out

    # 마을 1~3 합산 수요 예측
    preds = forecast.forecast(now.date().isoformat(), [1, 2, 3], product_ids)
    pred_by_pid: Dict[int, int] = {}
    for it in preds:
        pred_by_pid[it.product_id] = pred_by_pid.get(it.product_id, 0) + int(it.qty)

    # 재고와 비교해 경고 생성 (예측 > 보유 + 5)
    for row in vehicle_inv:
        pid = int(row.get("product_id"))
        onhand = int(row.get("qty", 0))
        expected = int(pred_by_pid.get(pid, 0))
        if expected > onhand + 5:
            name = row.get("name", f"상품 #{pid}")
            out.append(
                {
                    "id": f"inv-{pid}-{int(now.timestamp())}",
                    "type": "warning",
                    "message": f"A차량 {name} 재고 부족 예상 (보유 {onhand}, 예측 {expected})",
                    "ts": now.isoformat(),
                }
            )
    return out


@router.get("/recent")
def recent_alerts():
    now = datetime.utcnow()
    db = _read_db()  # 안전하게 로드
    alerts: List[Dict[str, Any]] = []
    alerts += _alerts_from_care(now, db)
    alerts += _alerts_from_inventory(now, db)
    alerts.sort(key=lambda x: x["ts"], reverse=True)
    return {"alerts": alerts[:10]}


@router.post("/resolve")
def resolve_alert(req: ResolveReq):
    return {"ok": True, "resolved_id": req.id}
