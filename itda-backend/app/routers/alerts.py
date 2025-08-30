# app/routers/alerts.py
from __future__ import annotations

from datetime import datetime
from typing import List, Dict, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
import pandas as pd
from pathlib import Path
from sqlalchemy.orm import Session

# --- DB 및 서비스 모듈 import ---
from ..services import forecast
from ..db import get_db
from ..models import Customer

# --- CSV 파일 경로 설정 ---
BASE_DIR = Path(__file__).resolve().parent.parent
SALES_CSV = BASE_DIR / "seed/seed_sales.csv"

router = APIRouter()

class ResolveReq(BaseModel):
    id: str

def _alerts_from_care(now: datetime, db: Session) -> List[Dict[str, Any]]:
    """
    하이브리드 AI 이상 징후 감지 시스템:
    1. 규칙 기반: 14일 이상 미방문 고객에게 기본 알림을 보냅니다.
    2. AI 기반: 고객별 구매 패턴을 학습하여, 개인화된 이상 징후를 감지하고 지능형 알림을 보냅니다.
    """
    out: List[Dict[str, Any]] = []
    
    # SQLAlchemy 세션을 통해 최신 고객 목록을 직접 조회합니다.
    customers = db.query(Customer).all()
    if not customers:
        return out

    # --- 1. 규칙 기반 알림 (기본 안전망) ---
    for c in customers:
        if c.last_visit:
            days_since = (now - c.last_visit).days
            if days_since >= 14:
                out.append({
                    "id": f"care-rule-{c.id}",
                    "type": "warning",
                    "message": f"규칙 기반 알림: {c.name}님이 {days_since}일간 미방문 상태입니다. 확인이 필요합니다.",
                    "ts": now.isoformat(),
                })
            
    # --- 2. AI 기반 패턴 분석 알림 (지능형 안전망) ---
    if not SALES_CSV.exists():
        return out

    sales_df = pd.read_csv(SALES_CSV)
    sales_df['ts'] = pd.to_datetime(sales_df['ts'])

    village_customer_map = {}
    for c in customers:
        if c.village_id not in village_customer_map:
            village_customer_map[c.village_id] = []
        village_customer_map[c.village_id].append(c)

    village_visits = sales_df.drop_duplicates(subset=['ts', 'village_id']).sort_values('ts')
    
    for village_id, group in village_visits.groupby('village_id'):
        if len(group) < 3: continue
            
        intervals = group['ts'].diff().dt.days.dropna()
        avg_interval = intervals.mean()
        std_interval = intervals.std()
        
        threshold_days = avg_interval + 1.5 * std_interval
        last_visit_date = group['ts'].iloc[-1]
        days_since_last_visit = (now.date() - last_visit_date.date()).days
        
        if days_since_last_visit > threshold_days:
            for customer in village_customer_map.get(village_id, []):
                if not any(alert['id'] == f"care-rule-{customer.id}" for alert in out):
                    out.append({
                        "id": f"care-ai-pattern-{customer.id}",
                        "type": "emergency",
                        "message": f"AI 이상 징후 감지: {customer.name}님 마을의 방문 주기가 평소({avg_interval:.1f}일)와 다릅니다. (현재 {days_since_last_visit}일 미방문)",
                        "ts": now.isoformat(),
                    })
    return out


def _alerts_from_inventory(now: datetime, db: Session) -> List[Dict[str, Any]]:
    # 이 함수는 데이터베이스에서 직접 재고를 읽어오도록 수정할 수 있으나,
    # 현재 구조(JSON 기반)를 유지하기 위해 _read_db를 사용합니다.
    # _read_db 함수를 임시로 여기에 다시 정의합니다.
    def _read_temp_db() -> Dict[str, Any]:
        # ... (기존 _read_db와 동일한 로직)
        try:
            with open(BASE_DIR / "seed/inventory_vehicle_1.json") as f:
                import json
                return json.load(f)
        except:
             return {}

    local_db = _read_temp_db()
    out: List[Dict[str, Any]] = []
    vehicle_inv = local_db.get("items", [])
    if not vehicle_inv:
        return out

    product_ids = [int(x.get("product_id")) for x in vehicle_inv if "product_id" in x]
    if not product_ids:
        return out

    preds = forecast.forecast(now.date().isoformat(), [1, 2, 3], product_ids)
    pred_by_pid: Dict[int, int] = {p.product_id: p.qty for p in preds}

    for row in vehicle_inv:
        pid = int(row.get("product_id"))
        onhand = int(row.get("qty", 0))
        expected = int(pred_by_pid.get(pid, 0))
        required_stock = expected + int(round(expected * 0.15))

        if onhand < required_stock:
            name = row.get("name", f"상품 #{pid}")
            out.append({
                "id": f"inv-ai-{pid}",
                "type": "warning",
                "message": f"AI 분석결과, '{name}' 재고 부족 예상 (보유 {onhand}, 권장 {required_stock}개)",
                "ts": now.isoformat(),
            })
    return out


@router.get("/recent")
def recent_alerts(db: Session = Depends(get_db)):
    """최근 발생한 모든 알림을 취합하여 반환합니다."""
    
    # 💡 테스트를 위한 가상 현재 시간
    now = datetime.fromisoformat("2025-08-18T09:00:00")

    alerts: List[Dict[str, Any]] = []
    
    # SQLAlchemy 세션(db)을 _alerts_from_care 함수에 전달
    alerts += _alerts_from_care(now, db)
    # _alerts_from_inventory는 아직 기존 방식을 사용
    alerts += _alerts_from_inventory(now, db)
    
    alerts.sort(key=lambda x: x["ts"], reverse=True)
    return {"alerts": alerts[:10]}


@router.post("/resolve")
def resolve_alert(req: ResolveReq):
    """알림을 확인 처리합니다."""
    return {"ok": True, "resolved_id": req.id}