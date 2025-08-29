# app/services/optimizer.py
from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Tuple
from datetime import datetime, timedelta

from .geo import haversine_km, travel_minutes

@dataclass
class Village:
    id: int
    lat: float
    lon: float
    priority: float = 0.5  # 0.0~1.0 (높을수록 먼저 방문)

@dataclass
class Vehicle:
    start_lat: float
    start_lon: float
    max_stops: int | None = None

def _weighted_cost(a: Tuple[float,float], b: Village) -> float:
    """거리 / (0.5 + priority) : 우선순위 높을수록 비용 낮아져 먼저 방문"""
    d = haversine_km(a[0], a[1], b.lat, b.lon)
    w = 0.5 + max(0.0, min(1.0, b.priority or 0.0))
    return d / w

def _nearest_route(vs: List[Village], start: Tuple[float,float]) -> List[Village]:
    remain = vs[:]
    path: List[Village] = []
    cur = start
    while remain:
        nxt = min(remain, key=lambda v: _weighted_cost(cur, v))
        path.append(nxt)
        cur = (nxt.lat, nxt.lon)
        remain.remove(nxt)
    return path

def _two_opt(path: List[Village]) -> List[Village]:
    """간단 2-opt 개선"""
    import math
    def seglen(a: Village, b: Village) -> float:
        return haversine_km(a.lat, a.lon, b.lat, b.lon)

    best = path[:]
    n = len(best)
    if n < 4:
        return best

    improved = True
    while improved:
        improved = False
        for i in range(0, n-3):
            for j in range(i+2, n-1):
                a, b = best[i], best[i+1]
                c, d = best[j], best[j+1]
                cur = seglen(a,b) + seglen(c,d)
                new = seglen(a,c) + seglen(b,d)
                if new + 1e-6 < cur:
                    best[i+1:j+1] = reversed(best[i+1:j+1])
                    improved = True
    return best

def optimize(villages: List[Village], vehicle: Vehicle) -> Dict:
    # 1) subset by max_stops
    vs = villages[:]
    if vehicle.max_stops and vehicle.max_stops > 0:
        # 우선순위 높은 순으로 자르기
        vs = sorted(vs, key=lambda v: (-(v.priority or 0), v.id))[: vehicle.max_stops]

    start = (vehicle.start_lat, vehicle.start_lon)

    # 2) nearest + 2opt
    nn = _nearest_route(vs, start)
    route = _two_opt(nn)

    # 3) metrics + ETA
    total_km = 0.0
    now = datetime.utcnow()
    ordered = []
    prev = start
    for v in route:
        leg_km = haversine_km(prev[0], prev[1], v.lat, v.lon)
        total_km += leg_km
        eta = now + timedelta(minutes=travel_minutes(leg_km))
        ordered.append({
            "village_id": v.id,
            "lat": v.lat,
            "lon": v.lon,
            "distance_km": round(leg_km, 1),
            "eta": eta.isoformat(),
        })
        now = eta
        prev = (v.lat, v.lon)

    return {
        "ordered_stops": ordered,
        "total_distance_km": round(total_km, 1),
        "est_duration_min": int(travel_minutes(total_km)),
    }
