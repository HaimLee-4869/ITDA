# app/routers/demand.py
from typing import List
import datetime as dt

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, conint

from ..services.forecast import forecast

router = APIRouter()


class ForecastReq(BaseModel):
    # 내부 필드명은 target_date로 바꾸고, 외부(JSON)는 "date"로 받도록 alias 지정
    target_date: dt.date = Field(
        ...,
        alias="date",
        description="예: 2025-08-20",
    )
    villages: List[conint(ge=1)]
    products: List[conint(ge=1)]

    model_config = {
        # alias로도 값 주입 허용 (클라이언트는 계속 'date'로 보내면 됩니다)
        "populate_by_name": True,
        "json_schema_extra": {
            "example": {
                "date": "2025-08-20",
                "villages": [1, 2, 3],
                "products": [101, 102, 103],
            }
        },
    }


@router.post("/forecast")
def forecast_api(req: ForecastReq):
    try:
        d = req.target_date.isoformat()
        items = forecast(d, req.villages, req.products)
    except Exception as e:
        # 입력 오류 등은 400으로 변환
        raise HTTPException(status_code=400, detail=f"forecast error: {e}")

    return {
        "date": d,
        "results": [
            {
                "village_id": it.village_id,
                "product_id": it.product_id,
                "qty": it.qty,
                "conf_low": it.conf_low,
                "conf_high": it.conf_high,
                "details": it.details,
            }
            for it in items
        ],
    }
