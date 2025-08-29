from __future__ import annotations
from fastapi import APIRouter, HTTPException
import pandas as pd
from pathlib import Path

router = APIRouter()

# CSV 파일 경로 설정
BASE_DIR = Path(__file__).resolve().parent.parent
SALES_CSV = BASE_DIR / "seed/seed_sales.csv"

@router.get("/summary")
def get_sales_summary():
    """일별, 주별, 월별 매출 요약을 제공합니다."""
    if not SALES_CSV.exists():
        raise HTTPException(status_code=404, detail="Sales data not found.")

    try:
        df = pd.read_csv(SALES_CSV)
        df['ts'] = pd.to_datetime(df['ts'])
        df['sale'] = df['qty'] * df['price']

        # 일별 매출
        daily_sales = df.groupby(df['ts'].dt.date)['sale'].sum().reset_index()
        daily_sales.columns = ['date', 'total_sales']
        daily_sales = daily_sales.sort_values(by='date', ascending=False).head(7)

        # 주별 매출
        weekly_sales = df.groupby(df['ts'].dt.to_period('W'))['sale'].sum().reset_index()
        weekly_sales['ts'] = weekly_sales['ts'].dt.start_time.dt.date
        weekly_sales.columns = ['week_start_date', 'total_sales']
        weekly_sales = weekly_sales.sort_values(by='week_start_date', ascending=False).head(4)

        # 월별 매출
        monthly_sales = df.groupby(df['ts'].dt.to_period('M'))['sale'].sum().reset_index()
        monthly_sales['ts'] = monthly_sales['ts'].dt.start_time.dt.date
        monthly_sales.columns = ['month', 'total_sales']
        monthly_sales = monthly_sales.sort_values(by='month', ascending=False).head(3)

        return {
            "daily": daily_sales.to_dict(orient="records"),
            "weekly": weekly_sales.to_dict(orient="records"),
            "monthly": monthly_sales.to_dict(orient="records"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing sales data: {e}")