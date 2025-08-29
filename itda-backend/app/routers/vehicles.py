# app/routers/vehicles.py
from __future__ import annotations
from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List
from datetime import datetime, timedelta
import random

router = APIRouter()

# 초기 상태(임의 좌표/상태) — 필요하면 실제 GPS 연동으로 교체
_VEHICLES: Dict[int, Dict[str, Any]] = {
    1: {
        "id": 1, "name": "A차량", "status": "운행중",
        "lat": 35.281, "lon": 126.502, "speed_kmh": 32, "load_pct": 68,
        "battery": 84, "last_ping": datetime.utcnow(),
    },
    2: {
        "id": 2, "name": "B차량", "status": "대기",
        "lat": 35.295, "lon": 126.488, "speed_kmh": 0, "load_pct": 41,
        "battery": 76, "last_ping": datetime.utcnow(),
    },
}

def _j(d: datetime) -> str:
    return d.isoformat()

def _tick():
    """간단한 시뮬레이션: 운행중 차량은 약간 이동, ping 갱신"""
    now = datetime.utcnow()
    for v in _VEHICLES.values():
        # 10초 이상 지났으면 위치/속도 살짝 변경
        if now - v["last_ping"] > timedelta(seconds=10):
            if v["status"] == "운행중":
                v["lat"] += random.uniform(-0.001, 0.001)
                v["lon"] += random.uniform(-0.001, 0.001)
                v["speed_kmh"] = max(15, min(45, v["speed_kmh"] + random.uniform(-3, 3)))
                v["load_pct"] = max(0, min(100, v["load_pct"] - random.uniform(0, 0.4)))
            else:
                v["speed_kmh"] = 0
            v["battery"] = max(0, min(100, v["battery"] - random.uniform(0, 0.1)))
            v["last_ping"] = now

@router.get("/list")
def list_vehicles() -> Dict[str, List[Dict[str, Any]]]:
    _tick()
    out = []
    for v in _VEHICLES.values():
        r = dict(v)
        r["last_ping"] = _j(r["last_ping"])
        out.append(r)
    # 최근 ping 우선
    out.sort(key=lambda x: x["last_ping"], reverse=True)
    return {"vehicles": out}

@router.get("/{vehicle_id}")
def get_vehicle(vehicle_id: int):
    _tick()
    v = _VEHICLES.get(vehicle_id)
    if not v:
        raise HTTPException(status_code=404, detail="vehicle not found")
    r = dict(v)
    r["last_ping"] = _j(r["last_ping"])
    return r
