# app/models.py
from __future__ import annotations
from datetime import datetime
from typing import Optional

from sqlalchemy import Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100))
    village_id: Mapped[int] = mapped_column(Integer, index=True)
    tags_json: Mapped[Optional[str]] = mapped_column(String, default="[]")  # JSON 문자열
    last_visit: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    notes: Mapped[list["Note"]] = relationship("Note", back_populates="customer", cascade="all, delete-orphan")

class Note(Base):
    __tablename__ = "notes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    note: Mapped[str] = mapped_column(String)
    tags_json: Mapped[str] = mapped_column(String, default="[]")

    customer: Mapped["Customer"] = relationship("Customer", back_populates="notes")

class InventoryItem(Base):
    __tablename__ = "inventory_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[int] = mapped_column(Integer, index=True)
    product_id: Mapped[int] = mapped_column(Integer, index=True)
    name: Mapped[str] = mapped_column(String(100))
    qty: Mapped[int] = mapped_column(Integer, default=0)

class AlertResolved(Base):
    __tablename__ = "alerts_resolved"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # 알림 ID(md5 10자리여도 열로 32)
    resolved_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
