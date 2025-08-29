# app/services/forecast.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Tuple
from collections import defaultdict
import datetime as dt
import math
import random

# ---------------------------
# 데모용 판매 이력 생성기
# ---------------------------
def _seed_history(villages: List[int], products: List[int], days: int = 90) -> List[Tuple[int,int,dt.date,int]]:
    """
    (village_id, product_id, date, qty) 리스트 생성
    - 요일 seasonality: 주말 0.8x, 화/금 1.2x
    - 트렌드: 최근일수록 +5% 정도
    """
    today = dt.date.today()
    out = []
    for vid in villages:
        for pid in products:
            base = 20 + (pid % 7) * 2  # 품목별 기본 수요
            for d in range(days):
                day = today - dt.timedelta(days=days - d)
                w = day.weekday()  # 0=Mon
                weekday_factor = 1.0
                if w in (1, 4):  # Tue/Fri 장날 효과
                    weekday_factor = 1.2
                elif w in (5, 6):  # 주말
                    weekday_factor = 0.8
                trend = 1.0 + d / days * 0.05
                noise = random.uniform(0.85, 1.15)
                qty = max(0, int(round(base * weekday_factor * trend * noise)))
                out.append((vid, pid, day, qty))
    return out

# ---------------------------
# 예측 본체
# ---------------------------
@dataclass
class ForecastItem:
    village_id: int
    product_id: int
    qty: int
    conf_low: int
    conf_high: int
    details: Dict

def _weekday_idx(date_str: str) -> int:
    y, m, d = [int(x) for x in date_str.split("-")]
    return dt.date(y, m, d).weekday()

def forecast(date: str, villages: List[int], products: List[int]) -> List[ForecastItem]:
    """
    가중 이동평균 + 요일 계수
    - 직전 4주 같은 요일만 모아 평균
    - 최근일수록 가중치↑ (4,3,2,1)
    - 표준편차로 ±신뢰구간 제시
    """
    hist = _seed_history(villages, products, days=120)  # 데모 이력
    target_w = _weekday_idx(date)

    # (vid,pid,weekday)-> 최근4주 qty
    buckets: Dict[Tuple[int,int,int], List[int]] = defaultdict(list)
    last_date = max(h[2] for h in hist)
    # 최근 28일(4주) window
    cutoff = last_date - dt.timedelta(days=28)

    for vid, pid, d, qty in hist:
        if d.weekday() != target_w:
            continue
        if d <= cutoff:
            continue
        buckets[(vid, pid, d.weekday())].append(qty)

    out: List[ForecastItem] = []
    for vid in villages:
        for pid in products:
            arr = buckets.get((vid, pid, target_w), [])
            if not arr:
                # fallback: 전체 최근 7일 평균
                arr = [q for (v,p,dd,q) in hist if v==vid and p==pid and (last_date - dd).days <= 7]
            if not arr:
                base = 20
                sigma = 5
            else:
                # 가중 평균 (최근값이 뒤에 있음)
                weights = list(range(1, len(arr)+1))
                base = sum(a*w for a,w in zip(arr, weights)) / sum(weights)
                # 표준편차
                mean = sum(arr)/len(arr)
                var = sum((x-mean)**2 for x in arr) / max(1, (len(arr)-1))
                sigma = math.sqrt(var)

            # 안전버퍼 10% + 1*sigma
            qty = int(round(base * 1.10 + sigma))
            low = max(0, int(round(base - 1.0*sigma)))
            high = int(round(base + 1.5*sigma))

            out.append(ForecastItem(
                village_id=vid,
                product_id=pid,
                qty=qty,
                conf_low=low,
                conf_high=high,
                details={"samples": arr[-8:], "sigma": round(float(sigma),2), "base": round(float(base),1)},
            ))
    return out

def predict(date: str, villages: list[int], products: list[int]):
    # 기존 forecast() 로직 재사용
    return forecast(date, villages, products)