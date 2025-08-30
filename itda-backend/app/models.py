# itda-backend/app/models.py
from __future__ import annotations
from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    create_engine,
    ForeignKey,
    Integer,
    String,
    DateTime,
    Float,
    JSON,  # 💡 This line is the fix!
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, DeclarativeBase

class Base(DeclarativeBase):
    pass

class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, index=True)
    village_id: Mapped[int] = mapped_column(Integer, index=True)
    tags: Mapped[List[str]] = mapped_column(JSON, nullable=True)
    last_visit: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    lat: Mapped[float] = mapped_column(Float, nullable=True)
    lon: Mapped[float] = mapped_column(Float, nullable=True)
    notes: Mapped[List["Note"]] = relationship("Note", back_populates="customer")

class Note(Base):
    __tablename__ = "notes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    note: Mapped[str] = mapped_column(String)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    customer: Mapped["Customer"] = relationship("Customer", back_populates="notes")

class InventoryItem(Base):
    __tablename__ = "inventory_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[int] = mapped_column(Integer, index=True)
    product_id: Mapped[int] = mapped_column(Integer, index=True)
    name: Mapped[str] = mapped_column(String)
    qty: Mapped[int] = mapped_column(Integer)

class SalesLog(Base):
    __tablename__ = "sales_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[int] = mapped_column(Integer, index=True)
    village_id: Mapped[int] = mapped_column(Integer, index=True)
    items_sold_json: Mapped[str] = mapped_column(String, default="[]")
    total_revenue: Mapped[int] = mapped_column(Integer)
    feedback: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)