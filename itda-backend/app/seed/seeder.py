# app/seed/seeder.py
"""
시드 판매데이터 생성 스크립트
- 90일치 (3개 마을 × 3개 상품) 일별 판매량을 생성
- 요일/계절/날씨(비) 효과 + 랜덤성 반영
실행:
    python -m app.seed.seeder
결과:
    app/seed/seed_sales.csv
"""
from __future__ import annotations
import math
from pathlib import Path
from datetime import datetime, timedelta
import random

import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent
OUT_CSV = BASE_DIR / "seed_sales.csv"

# 마을/상품 정의
VILLAGES = [
    {"village_id": 1, "name": "행복마을", "elderly_factor": 1.10},
    {"village_id": 2, "name": "평화마을", "elderly_factor": 1.00},
    {"village_id": 3, "name": "소망마을", "elderly_factor": 0.95},
]
PRODUCTS = [
    {"product_id": 101, "name": "두부", "base": 22.0},
    {"product_id": 102, "name": "계란", "base": 28.0},
    {"product_id": 103, "name": "채소", "base": 16.0},
]

# 요일 효과 (0=월 ... 6=일)
DOW_EFFECT = {
    0: 0.95,  # 월
    1: 1.00,  # 화
    2: 1.03,  # 수
    3: 1.04,  # 목
    4: 0.98,  # 금
    5: 1.12,  # 토
    6: 1.08,  # 일
}

def seasonal_temp(day_of_year: int) -> float:
    # 간단한 계절 온도 (섭씨): 5~28도 사이로 왕복
    return 16 + 11 * math.sin(2 * math.pi * (day_of_year - 30) / 365)

def main():
    random.seed(42)
    np.random.seed(42)

    today = datetime.utcnow().date()
    start = today - timedelta(days=90)

    rows = []
    d = start
    while d < today:
        dow = d.weekday()
        doy = d.timetuple().tm_yday
        temp = seasonal_temp(doy)

        # 비 확률: 여름(6~9월) 35%, 그 외 20%
        rainy = 1 if (((6 <= d.month <= 9) and random.random() < 0.35) or
                      ((d.month < 6 or d.month > 9) and random.random() < 0.20)) else 0

        for v in VILLAGES:
            for p in PRODUCTS:
                base = p["base"]
                qty = base

                # 요일/고령인구 비중 반영
                qty *= DOW_EFFECT[dow]
                qty *= v["elderly_factor"]

                # 날씨 효과: 비오면 신선식품(채소) -18%, 두부/계란 -8%
                if rainy:
                    if p["product_id"] == 103:
                        qty *= 0.82
                    else:
                        qty *= 0.92

                # 온도 효과: 더우면 두부/채소↑, 계란은 영향 적음
                if p["product_id"] in (101, 103):
                    qty *= 1 + (max(temp - 20, 0) * 0.006)

                # 랜덤성
                noise = np.random.normal(loc=0.0, scale=2.0)
                qty = max(0.0, qty + noise)

                rows.append({
                    "ts": datetime(d.year, d.month, d.day, 9, 0, 0).isoformat(),
                    "village_id": v["village_id"],
                    "product_id": p["product_id"],
                    "qty": round(qty),
                    "price": 3000 if p["product_id"] == 101 else (6000 if p["product_id"] == 102 else 2500),
                    "temp": round(temp, 1),
                    "rain": rainy
                })
        d += timedelta(days=1)

    df = pd.DataFrame(rows)
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_CSV, index=False, encoding="utf-8")
    print(f"[OK] Wrote {len(df)} rows -> {OUT_CSV.as_posix()}")

if __name__ == "__main__":
    main()
