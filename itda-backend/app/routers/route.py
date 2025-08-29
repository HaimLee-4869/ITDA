from __future__ import annotations

from datetime import datetime, timedelta
from math import radians, sin, cos, asin, sqrt
from typing import List, Optional, Tuple, Dict

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


# ====== Pydantic models ======
class VillageIn(BaseModel):
    id: int
    lat: float
    lon: float
    priority: Optional[float] = None  # 현재 로직에선 경로에 영향 없음(확장 여지)


class VehicleIn(BaseModel):
    start_lat: float
    start_lon: float
    max_stops: Optional[int] = None  # 상한 지정 시 앞에서 자름


class RouteReq(BaseModel):
    villages: List[VillageIn]
    vehicle: VehicleIn


# ====== Geo utils ======
def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Kilometers"""
    R = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * R * asin(sqrt(a))


def build_dist_matrix(
    start: Tuple[float, float], villages: List[VillageIn]
) -> List[List[float]]:
    """
    D[0][j+1] : start -> village j
    D[i+1][j+1] : village i -> village j
    """
    n = len(villages)
    D = [[0.0] * (n + 1) for _ in range(n + 1)]
    for j in range(n):
        d = haversine(start[0], start[1], villages[j].lat, villages[j].lon)
        D[0][j + 1] = D[j + 1][0] = d
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            D[i + 1][j + 1] = haversine(
                villages[i].lat, villages[i].lon, villages[j].lat, villages[j].lon
            )
    return D


# ====== TSP solver (open path: start -> visit all -> stop) ======
def tsp_open_path_exact(D: List[List[float]]) -> Tuple[float, List[int]]:
    """
    Held–Karp DP.
    - Nodes: 1..n (villages), 0 = start only.
    - Minimize cost: start(0) -> ... -> end(any)
    Returns (min_cost, order of villages as indices 1..n).
    NOTE: O(n^2 2^n) — n<=14 권장.
    """
    n = len(D) - 1
    if n == 0:
        return 0.0, []

    # dp[mask][j] = (cost, prev) visiting mask (bits over 1..n), ending at j(1..n)
    dp: List[Dict[int, Tuple[float, Optional[int]]]] = [dict() for _ in range(1 << n)]
    for j in range(1, n + 1):
        mask = 1 << (j - 1)
        dp[mask][j] = (D[0][j], 0)

    for mask in range(1 << n):
        if mask == 0:
            continue
        for j, (cost_j, _) in list(dp[mask].items()):
            prev_mask = mask ^ (1 << (j - 1))
            if prev_mask == 0:
                continue
            # relax from any k in prev_mask to j
            for k, (cost_k, _) in dp[prev_mask].items():
                new_cost = cost_k + D[k][j]
                if j not in dp[mask] or new_cost < dp[mask][j][0]:
                    dp[mask][j] = (new_cost, k)

    full = (1 << n) - 1
    # choose best end j
    best_cost = float("inf")
    end_j = 1
    for j, (c, _) in dp[full].items():
        if c < best_cost:
            best_cost = c
            end_j = j

    # reconstruct
    order_rev: List[int] = []
    mask = full
    j = end_j
    while j != 0:
        order_rev.append(j)
        _, prev = dp[mask][j]
        mask ^= 1 << (j - 1)
        j = prev if prev is not None else 0
    order = list(reversed(order_rev))
    return best_cost, order  # order contains indices in 1..n


def tsp_greedy_2opt(D: List[List[float]]) -> Tuple[float, List[int]]:
    """
    Fallback for 큰 n. Greedy + 2-opt 개선. Indices in 1..n.
    """
    n = len(D) - 1
    if n == 0:
        return 0.0, []

    # greedy from start(0)
    unvisited = set(range(1, n + 1))
    order: List[int] = []
    curr = 0
    while unvisited:
        nxt = min(unvisited, key=lambda j: D[curr][j])
        order.append(nxt)
        unvisited.remove(nxt)
        curr = nxt

    def route_cost(ordr: List[int]) -> float:
        if not ordr:
            return 0.0
        cost = D[0][ordr[0]]
        for a, b in zip(ordr[:-1], ordr[1:]):
            cost += D[a][b]
        return cost

    improved = True
    while improved:
        improved = False
        for i in range(len(order) - 2):
            for j in range(i + 2, len(order)):
                new_order = order[:]
                new_order[i + 1 : j + 1] = reversed(new_order[i + 1 : j + 1])
                if route_cost(new_order) + 1e-9 < route_cost(order):
                    order = new_order
                    improved = True
    return route_cost(order), order


AVG_SPEED_KMPH = 35.0  # 간단 추정 속도


@router.post("/optimize")
def optimize(req: RouteReq):
    villages = req.villages[:]
    if req.vehicle.max_stops:
        villages = villages[: max(0, req.vehicle.max_stops)]

    start = (req.vehicle.start_lat, req.vehicle.start_lon)
    D = build_dist_matrix(start, villages)

    n = len(villages)
    if n <= 14:
        total_km, order_idx = tsp_open_path_exact(D)
    else:
        total_km, order_idx = tsp_greedy_2opt(D)

    # build response
    # order_idx: e.g. [3,1,2] meaning visit villages[2] -> villages[0] -> villages[1]
    ordered = []
    now = datetime.now()
    elapsed_min = 0.0

    def eta_after_km(km: float) -> datetime:
        minutes = (km / AVG_SPEED_KMPH) * 60.0
        return now + timedelta(minutes=minutes)

    # cumulative distances for ETA
    cum_km = 0.0
    if order_idx:
        # distance from start to first
        first = order_idx[0]
        cum_km += D[0][first]

    for idx_pos, idx1 in enumerate(order_idx):
        v = villages[idx1 - 1]
        eta = eta_after_km(cum_km)
        ordered.append(
            {
                "village_id": v.id,
                "lat": v.lat,
                "lon": v.lon,
                "distance_km": round(cum_km, 1),
                "eta": eta.isoformat(),
            }
        )
        if idx_pos < len(order_idx) - 1:
            idx2 = order_idx[idx_pos + 1]
            cum_km += D[idx1][idx2]

    est_duration_min = int(round((total_km / AVG_SPEED_KMPH) * 60.0))

    return {
        "ordered_stops": ordered,
        "total_distance_km": round(total_km, 1),
        "est_duration_min": est_duration_min,
    }
