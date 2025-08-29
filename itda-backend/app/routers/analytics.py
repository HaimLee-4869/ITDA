from __future__ import annotations
from fastapi import APIRouter, HTTPException
import pandas as pd
from pathlib import Path

router = APIRouter()

BASE_DIR = Path(__file__).resolve().parent.parent
SALES_CSV = BASE_DIR / "seed/seed_sales.csv"

# 데모용 마을 및 상품 이름 매핑
VILLAGE_NAMES = {1: "행복마을", 2: "평화마을", 3: "소망마을"}
PRODUCT_NAMES = {101: "두부", 102: "계란", 103: "채소"}

@router.get("/summary")
def get_analytics_summary():
    """매출 분석을 위한 요약 데이터를 제공합니다."""
    if not SALES_CSV.exists():
        raise HTTPException(status_code=404, detail="Sales data not found.")

    try:
        df = pd.read_csv(SALES_CSV)
        df['ts'] = pd.to_datetime(df['ts'])
        df['sale'] = df['qty'] * df['price']

        # 1. 시간대별 매출
        sales_over_time = df.groupby(df['ts'].dt.date)['sale'].sum().reset_index()
        sales_over_time.columns = ['date', 'total_sales']
        sales_over_time = sales_over_time.sort_values(by='date')

        # 2. 상품별 매출
        sales_by_product = df.groupby('product_id')['sale'].sum().reset_index()
        sales_by_product['product_name'] = sales_by_product['product_id'].map(PRODUCT_NAMES)
        sales_by_product = sales_by_product.sort_values(by='sale', ascending=False)

        # 3. 마을별 매출
        sales_by_village = df.groupby('village_id')['sale'].sum().reset_index()
        sales_by_village['village_name'] = sales_by_village['village_id'].map(VILLAGE_NAMES)
        sales_by_village = sales_by_village.sort_values(by='sale', ascending=False)

        return {
            "sales_over_time": sales_over_time.to_dict(orient="records"),
            "sales_by_product": sales_by_product.to_dict(orient="records"),
            "sales_by_village": sales_by_village.to_dict(orient="records"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing analytics data: {e}")