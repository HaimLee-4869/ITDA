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
    Held–Karp DP (open path).
    - Nodes: 1..n (villages), 0 = start only.
    - Minimize cost: start(0) -> ... -> end(any)
    Returns (min_cost, order of villages as indices 1..n).
    NOTE: O(n^2 2^n) — n<=14 권장.
    """
    n = len(D) - 1  # number of villages
    if n == 0:
        return 0.0, []
    if n == 1:
        return float(D[0][1]), [1]

    # dp[mask][j] = (cost, prev) :
    #   start(0)에서 시작, mask(1..n 비트) 방문 상태로 j(1..n)에서 끝났을 때 최소 비용과 이전 노드
    dp: List[Dict[int, Tuple[float, Optional[int]]]] = [dict() for _ in range(1 << n)]

    # 초기: start -> j
    for j in range(1, n + 1):
        mask = 1 << (j - 1)
        dp[mask][j] = (float(D[0][j]), 0)

    # 전개: 존재하는 상태만 확장
    for mask in range(1 << n):
        for j, (cost_j, _prev) in list(dp[mask].items()):
            # j에서 방문 안 한 k로 확장
            for k in range(1, n + 1):
                if mask & (1 << (k - 1)):
                    continue
                nmask = mask | (1 << (k - 1))
                new_cost = cost_j + float(D[j][k])
                if (k not in dp[nmask]) or (new_cost < dp[nmask][k][0]):
                    dp[nmask][k] = (new_cost, j)

    full = (1 << n) - 1
    if not dp[full]:
        raise ValueError("DP table empty at full mask")

    # 끝점 선택(열린 경로)
    end = min(dp[full].keys(), key=lambda j: dp[full][j][0])
    best_cost = dp[full][end][0]

    # 경로 복원 (항상 실제로 존재하는 상태만 추적)
    order_rev: List[int] = []
    mask = full
    j = end
    while True:
        order_rev.append(j)
        _cost, prev = dp[mask][j]
        if prev == 0:
            break
        mask ^= 1 << (j - 1)
        j = prev  # prev는 1..n

    order = list(reversed(order_rev))  # indices 1..n
    return best_cost, order


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
    # 정확해(<=14)는 DP 사용, 실패 시 폴백
    if n <= 14:
        try:
            total_km, order_idx = tsp_open_path_exact(D)
        except Exception:
            total_km, order_idx = tsp_greedy_2opt(D)
    else:
        total_km, order_idx = tsp_greedy_2opt(D)

    # build response
    # order_idx: e.g. [3,1,2] meaning visit villages[2] -> villages[0] -> villages[1]
    ordered = []
    now = datetime.now()

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
