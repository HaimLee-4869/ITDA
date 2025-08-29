# app/routers/alerts.py
from __future__ import annotations

from datetime import datetime
from typing import List, Dict, Any

from fastapi import APIRouter
from pydantic import BaseModel
import pandas as pd
from pathlib import Path

# --- DB 및 서비스 모듈 import ---
from ..services import forecast

# --- DB 안전 어댑터 ---
# 어떤 방식으로 DB를 구현했든 데이터를 안전하게 읽어오기 위한 함수입니다.
def _read_db() -> Dict[str, Any]:
    try:
        from ..db import DB as _DB
        with _DB() as d:
            return dict(d)
    except Exception:
        try:
            from ..db import load_db
            return dict(load_db())
        except Exception:
            try:
                from ..db import read_db
                return dict(read_db())
            except Exception:
                # DB 로드 실패 시 빈 딕셔너리 반환
                return {}

# --- CSV 파일 경로 설정 ---
BASE_DIR = Path(__file__).resolve().parent.parent
SALES_CSV = BASE_DIR / "seed/seed_sales.csv"


router = APIRouter()

class ResolveReq(BaseModel):
    id: str

def _alerts_from_care(now: datetime, db: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    하이브리드 AI 이상 징후 감지 시스템:
    1. 규칙 기반: 14일 이상 미방문 고객에게 기본 알림을 보냅니다.
    2. AI 기반: 고객별 구매 패턴을 학습하여, 개인화된 이상 징후를 감지하고 지능형 알림을 보냅니다.
    """
    out: List[Dict[str, Any]] = []
    customers = db.get("care_customers", [])
    if not customers:
        return out

    # --- 1. 규칙 기반 알림 (기본 안전망) ---
    for c in customers:
        last_visit = c.get("last_visit")
        if not last_visit: continue
        try:
            days_since = (now - datetime.fromisoformat(last_visit)).days
            if days_since >= 14:
                out.append({
                    "id": f"care-rule-{c['id']}",
                    "type": "warning", # 규칙 기반은 '주의' 등급
                    "message": f"규칙 기반 알림: {c.get('name','고객')}님이 {days_since}일간 미방문 상태입니다. 확인이 필요합니다.",
                    "ts": now.isoformat(),
                })
        except Exception:
            continue
            
    # --- 2. AI 기반 패턴 분석 알림 (지능형 안전망) ---
    if not SALES_CSV.exists():
        return out # 판매 데이터가 없으면 AI 분석 불가

    sales_df = pd.read_csv(SALES_CSV)
    sales_df['ts'] = pd.to_datetime(sales_df['ts'])

    # 마을 ID를 해당 마을에 속한 고객 리스트와 매핑
    village_customer_map = {}
    for c in customers:
        if c['village_id'] not in village_customer_map:
            village_customer_map[c['village_id']] = []
        village_customer_map[c['village_id']].append(c)

    # 마을별 방문(구매) 기록 추출
    village_visits = sales_df.drop_duplicates(subset=['ts', 'village_id']).sort_values('ts')
    
    for village_id, group in village_visits.groupby('village_id'):
        # 분석을 위해 최소 3회 이상의 방문 기록 필요
        if len(group) < 3: continue
            
        # AI가 방문 간격의 통계적 패턴(평균, 표준편차)을 학습
        intervals = group['ts'].diff().dt.days.dropna()
        avg_interval = intervals.mean()
        std_interval = intervals.std()
        
        # 개인화된 이상 징후 판단 임계값 설정 (평균 + 1.5 * 표준편차)
        threshold_days = avg_interval + 1.5 * std_interval
        
        # 마지막 방문일로부터 현재까지 경과일 계산
        last_visit_date = group['ts'].iloc[-1]
        days_since_last_visit = (now.date() - last_visit_date.date()).days
        
        # 경과일이 개인화된 임계값을 초과하면 위기 징후 알림 생성
        if days_since_last_visit > threshold_days:
            for customer in village_customer_map.get(village_id, []):
                # 이미 규칙 기반 알림이 생성된 고객은 중복 알림 방지
                if not any(alert['id'] == f"care-rule-{customer['id']}" for alert in out):
                    out.append({
                        "id": f"care-ai-pattern-{customer['id']}",
                        "type": "emergency", # AI 기반은 '긴급' 등급
                        "message": f"AI 이상 징후 감지: {customer.get('name')}님 마을의 방문 주기가 평소({avg_interval:.1f}일)와 다릅니다. (현재 {days_since_last_visit}일 미방문)",
                        "ts": now.isoformat(),
                    })
    return out


def _alerts_from_inventory(now: datetime, db: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    AI 수요 예측 기반으로 재고 부족분을 계산하여 경고합니다.
    """
    out: List[Dict[str, Any]] = []
    vehicle_inv = db.get("vehicle_inventories", {}).get(1, [])
    if not vehicle_inv:
        return out

    product_ids = [int(x.get("product_id")) for x in vehicle_inv if "product_id" in x]
    if not product_ids:
        return out

    # AI 모델로 마을 1~3의 합산 수요 예측
    preds = forecast.forecast(now.date().isoformat(), [1, 2, 3], product_ids)
    pred_by_pid: Dict[int, int] = {}
    for it in preds:
        pred_by_pid[it.product_id] = pred_by_pid.get(it.product_id, 0) + int(it.qty)

    # 재고와 AI 예측량을 비교하여 경고 생성
    for row in vehicle_inv:
        pid = int(row.get("product_id"))
        onhand = int(row.get("qty", 0))
        expected = int(pred_by_pid.get(pid, 0))
        
        # 안전재고(예측량의 15%)를 고려한 필요 재고량 계산
        required_stock = expected + int(round(expected * 0.15))

        if onhand < required_stock:
            name = row.get("name", f"상품 #{pid}")
            out.append(
                {
                    "id": f"inv-ai-{pid}",
                    "type": "warning",
                    "message": f"AI 분석결과, '{name}' 재고 부족 예상 (현재 {onhand}개, 권장 {required_stock}개)",
                    "ts": now.isoformat(),
                }
            )
    return out


@router.get("/recent")
def recent_alerts():
    """최근 발생한 모든 알림을 취합하여 반환합니다."""
    now = datetime.utcnow()
    db = _read_db()
    alerts: List[Dict[str, Any]] = []
    
    # 각 알림 생성 함수 호출
    alerts += _alerts_from_care(now, db)
    alerts += _alerts_from_inventory(now, db)
    
    # 최신순으로 정렬하여 상위 10개만 반환
    alerts.sort(key=lambda x: x["ts"], reverse=True)
    return {"alerts": alerts[:10]}


@router.post("/resolve")
def resolve_alert(req: ResolveReq):
    """알림을 확인 처리합니다. (데모용으로 실제 DB 상태 변경은 없음)"""
    return {"ok": True, "resolved_id": req.id}