# itda-backend/app/seed/seed_db.py
from __future__ import annotations

import datetime as dt
from sqlalchemy.orm import Session
from ..db import engine, SessionLocal
from ..models import Base, Customer, Note, InventoryItem, SalesLog

# 시연을 위한 20명의 가상 고객 데이터 (마을별 특성 부여)
CUSTOMERS_DATA = [
    # 행복마을 (산악 지역, 건강식품 선호)
    {"id": 1, "name": "김영희", "village_id": 1, "tags": "고혈압,텃밭", "lat": 36.53, "lon": 127.27},
    {"id": 2, "name": "박철수", "village_id": 1, "tags": "당뇨,거동불편", "lat": 36.53, "lon": 127.27},
    {"id": 3, "name": "이순자", "village_id": 1, "tags": "관절염", "lat": 36.53, "lon": 127.27},
    {"id": 4, "name": "최민준", "village_id": 1, "tags": "독거노인", "lat": 36.53, "lon": 127.27},
    {"id": 5, "name": "정수빈", "village_id": 1, "tags": "최근 퇴원", "lat": 36.53, "lon": 127.27},

    # 평화마을 (평야 지역, 일반식품 선호)
    {"id": 6, "name": "강지우", "village_id": 2, "tags": "대가족", "lat": 36.48, "lon": 127.29},
    {"id": 7, "name": "윤서아", "village_id": 2, "tags": "마을회관 단골", "lat": 36.48, "lon": 127.29},
    {"id": 8, "name": "임도윤", "village_id": 2, "tags": "자녀 방문 잦음", "lat": 36.48, "lon": 127.29},
    {"id": 9, "name": "황하윤", "village_id": 2, "tags": "", "lat": 36.48, "lon": 127.29},
    {"id": 10, "name": "송은우", "village_id": 2, "tags": "요리 초보", "lat": 36.48, "lon": 127.29},

    # 소망마을 (해안 지역, 채소/두부 선호)
    {"id": 11, "name": "오지호", "village_id": 3, "tags": "생선 선호", "lat": 36.45, "lon": 127.22},
    {"id": 12, "name": "한유주", "village_id": 3, "tags": "채식주의", "lat": 36.45, "lon": 127.22},
    {"id": 13, "name": "서이준", "village_id": 3, "tags": "알레르기(갑각류)", "lat": 36.45, "lon": 127.22},
    {"id": 14, "name": "권아윤", "village_id": 3, "tags": "손주 돌봄", "lat": 36.45, "lon": 127.22},
    {"id": 15, "name": "문시우", "village_id": 3, "tags": "해조류 선호", "lat": 36.45, "lon": 127.22},

    # 햇살마을 (신규 개발 지역, 간편식 선호)
    {"id": 16, "name": "장하준", "village_id": 4, "tags": "신혼부부", "lat": 36.55, "lon": 127.20},
    {"id": 17, "name": "손지안", "village_id": 4, "tags": "젊은 귀농인", "lat": 36.55, "lon": 127.20},
    {"id": 18, "name": "배유나", "village_id": 4, "tags": "재택근무", "lat": 36.55, "lon": 127.20},
    {"id": 19, "name": "조선우", "village_id": 4, "tags": "자취생", "lat": 36.55, "lon": 127.20},
    {"id": 20, "name": "남이서", "village_id": 4, "tags": "주말농장", "lat": 36.55, "lon": 127.20},
]

# AI가 분석할 구체적인 돌봄 노트 (RAG의 핵심 근거)
NOTES_DATA = [
    {"customer_id": 1, "note": "의사가 저염식 식단 권장. 두부 자주 찾으심."},
    {"customer_id": 2, "note": "부드러운 음식 위주로 구매. 계란찜 좋아하심."},
    {"customer_id": 6, "note": "아이들이 많아 우유, 계란 항상 대량으로 구매."},
    {"customer_id": 8, "note": "주말에 자녀들 오면 삼겹살 파티. 채소 많이 필요."},
    {"customer_id": 11, "note": "고등어, 갈치 등 생선류 입고되면 꼭 알려달라고 하심."},
    {"customer_id": 12, "note": "채식주의자. 신선한 채소와 두부 필수."},
    {"customer_id": 14, "note": "손주들 간식으로 과일이나 과자류 필요."},
    {"customer_id": 17, "note": "요리를 잘 못해서 즉석밥, 라면 등 간편식 선호."},
]

# 시연 시나리오에 맞는 차량 재고 데이터
INVENTORY_DATA = [
    {"vehicle_id": 1, "product_id": 101, "name": "두부", "qty": 50},
    {"vehicle_id": 1, "product_id": 102, "name": "계란", "qty": 60},
    {"vehicle_id": 1, "product_id": 103, "name": "채소", "qty": 40},
]


def create_db_and_tables():
    print("기존 데이터베이스 삭제 및 테이블 재생성 중...")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    print("✅ 테이블 생성 완료")

def seed_customers(session: Session):
    print("고객 데이터 생성 중...")
    customers = []
    for c_data in CUSTOMERS_DATA:
        days_ago = (20 - c_data['id']) % 10 + 2
        last_visit_date = dt.datetime(2025, 8, 18) - dt.timedelta(days=days_ago)
        
        customers.append(Customer(
            id=c_data["id"], name=c_data["name"], village_id=c_data["village_id"],
            tags=c_data["tags"].split(",") if c_data["tags"] else [],
            last_visit=last_visit_date, lat=c_data.get("lat"), lon=c_data.get("lon")
        ))
    session.add_all(customers)
    session.commit()
    print(f"✅ 고객 {len(customers)}명 데이터 생성 완료")

def seed_notes(session: Session):
    print("돌봄 노트 데이터 생성 중...")
    notes = [Note(**n_data) for n_data in NOTES_DATA]
    session.add_all(notes)
    session.commit()
    print(f"✅ 돌봄 노트 {len(notes)}개 데이터 생성 완료")

def seed_inventory(session: Session):
    print("차량 재고 데이터 생성 중...")
    inventory = [InventoryItem(**i_data) for i_data in INVENTORY_DATA]
    session.add_all(inventory)
    session.commit()
    print(f"✅ 재고 {len(inventory)}개 품목 데이터 생성 완료")


if __name__ == "__main__":
    create_db_and_tables()
    db_session = SessionLocal()
    try:
        seed_customers(db_session)
        seed_notes(db_session)
        seed_inventory(db_session)
        print("\n🎉 모든 시연용 데이터 생성이 성공적으로 완료되었습니다!")
        print("이제 백엔드 서버를 실행하여 '잇다'를 시작하세요: uvicorn app.main:app --reload")
    finally:
        db_session.close()