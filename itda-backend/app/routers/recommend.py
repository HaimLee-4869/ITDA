# app/routers/recommend.py
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import Customer, InventoryItem, Note, SalesLog
from ..services import forecast, geo
import datetime as dt
from typing import List, Dict

router = APIRouter()

VILLAGE_NAME_MAP = {1: "행복마을", 2: "평화마을", 3: "소망마을", 4: "햇살마을"}

@router.get("/best-options/{vehicle_id}")
def get_best_village_options(vehicle_id: int, db: Session = Depends(get_db)):
    """
    AI가 수요와 공급의 균형을 맞추기 위해 여러 마을을 비교 분석하고,
    각 선택지에 대한 상세한 근거를 함께 제공합니다.
    """
    inventory = db.query(InventoryItem).filter(InventoryItem.vehicle_id == vehicle_id).all()
    if not inventory:
        raise HTTPException(status_code=404, detail="차량 재고 정보 없음")

    inventory.sort(key=lambda x: x.qty, reverse=True)
    major_products = {item.product_id: item.qty for item in inventory[:3]}
    
    tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    all_villages_q = db.query(Customer.village_id, Customer.lat, Customer.lon).distinct()
    all_villages = [{"id": v[0], "lat": v[1], "lon": v[2]} for v in all_villages_q]
    all_product_ids = [p.product_id for p in inventory]
    
    predictions = forecast.forecast(tomorrow, [v['id'] for v in all_villages], all_product_ids)
    
    village_options = []
    for village in all_villages:
        village_id = village['id']
        score = 0
        reasons = {
            "demand": {"score": 0, "details": []}, "supply_match": {"score": 0, "details": []},
            "care_need": {"score": 0, "details": []}, "distance": {"score": 0, "details": []}
        }

        village_preds = [p for p in predictions if p.village_id == village_id]
        total_demand_score = sum(p.qty for p in village_preds)
        reasons["demand"]["score"] = round(total_demand_score)
        top_demand_items = sorted(village_preds, key=lambda p: p.qty, reverse=True)[:2]
        reasons["demand"]["details"] = [f"'{db.query(InventoryItem.name).filter(InventoryItem.product_id == i.product_id).scalar()}' 수요({i.qty}개) 높음" for i in top_demand_items]
        
        match_score = sum(pred.qty * 1.5 for pred in village_preds if pred.product_id in major_products)
        reasons["supply_match"]["score"] = round(match_score)
        if match_score > 0: reasons["supply_match"]["details"].append("주력 재고와 수요 일치")

        customers_in_village = db.query(Customer).filter(Customer.village_id == village_id).all()
        notes = db.query(Note).filter(Note.customer_id.in_([c.id for c in customers_in_village])).all()
        care_score = 0
        if any("저염식" in n.note for n in notes) and 101 in major_products:
            care_score += 50
            reasons["care_need"]["details"].append("저염식 두부 필요 가구 존재")
        if any("달걀" in n.note or "계란" in n.note for n in notes) and 102 in major_products:
            care_score += 30
            reasons["care_need"]["details"].append("계란 선호 가구 존재")
        reasons["care_need"]["score"] = round(care_score)

        start_lat, start_lon = 36.504, 127.245
        distance = geo.haversine_km(start_lat, start_lon, village['lat'], village['lon'])
        distance_penalty = distance * 2
        reasons["distance"]["score"] = -round(distance_penalty)
        reasons["distance"]["details"].append(f"예상 이동 거리: {distance:.1f}km")

        final_score = total_demand_score + match_score + care_score - distance_penalty
        
        if final_score > 0:
            village_options.append({
                "village_id": village_id, "village_name": VILLAGE_NAME_MAP.get(village_id, f"마을 #{village_id}"),
                "score": round(final_score),
                "reason_summary": f"수요({reasons['demand']['score']}) + 공급 일치({reasons['supply_match']['score']}) + 특별 요청({reasons['care_need']['score']}) + 거리({reasons['distance']['score']})",
                "details": reasons
            })

    sorted_options = sorted(village_options, key=lambda x: x['score'], reverse=True)
    if not sorted_options:
        raise HTTPException(status_code=404, detail="추천할 만한 마을을 찾지 못했습니다.")

    return {"options": sorted_options}

@router.post("/log-sale")
def log_sale(data: Dict = Body(...), db: Session = Depends(get_db)):
    """운전자의 판매 기록과 피드백을 DB에 저장하여 다음 AI 학습에 반영합니다."""
    new_log = SalesLog(
        vehicle_id=data.get("vehicle_id"), village_id=data.get("village_id"),
        items_sold_json=data.get("items_sold", []), total_revenue=sum(item.get('qty', 0) * item.get('price', 0) for item in data.get("items_sold", [])),
        feedback=data.get("feedback"), timestamp=dt.utcnow()
    )
    db.add(new_log)
    db.commit()
    return {"message": "판매 기록이 저장되었습니다. AI가 다음 추천에 반영합니다."}