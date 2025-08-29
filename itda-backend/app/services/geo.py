# app/services/geo.py
import math

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """구면 코사인/Haversine: km"""
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

def travel_minutes(distance_km: float, avg_kmh: float = 35.0) -> float:
    """시골도로 평균 30~40km/h 가정"""
    if avg_kmh <= 0:
        avg_kmh = 35.0
    return (distance_km / avg_kmh) * 60.0
