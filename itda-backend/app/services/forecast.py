# app/services/forecast.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Tuple, Optional
from collections import defaultdict
from pathlib import Path
import datetime as dt
import math
import random

_SKLEARN_OK = True
_XGB_OK = True
try:
    import pandas as pd
    import numpy as np
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.ensemble import HistGradientBoostingRegressor
except Exception:
    _SKLEARN_OK = False
try:
    import xgboost as xgb  # pip install xgboost
except Exception:
    _XGB_OK = False

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

# ---------------- ML Forecaster (Ensemble) ----------------
class _MLForecaster:
    """
    (village_id, product_id) 그룹별 소형회귀 앙상블:
      - XGBoost Regressor (가능시)
      - RandomForestRegressor
      - HistGradientBoostingRegressor
    """
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.sales_csv = self.base_dir / "seed" / "seed_sales.csv"
        self._models: Dict[Tuple[int,int], Dict[str, object]] = {}
        self._sigmas: Dict[Tuple[int,int], float] = {}
        self._history: Optional["pd.DataFrame"] = None
        self._load_history()

    def _load_history(self):
        if not self.sales_csv.exists():
            raise FileNotFoundError("seed_sales.csv not found")
        df = pd.read_csv(self.sales_csv)
        df["ts"] = pd.to_datetime(df["ts"])
        df["date"] = df["ts"].dt.date
        df["qty"] = pd.to_numeric(df["qty"], errors="coerce").fillna(0).astype(int)
        df["dow"] = df["ts"].dt.weekday
        df["month"] = df["ts"].dt.month
        df["doy"] = df["ts"].dt.dayofyear
        if "temp" not in df.columns:
            df["temp"] = 18.0
        if "rain" not in df.columns:
            df["rain"] = 0
        df["temp"] = pd.to_numeric(df["temp"], errors="coerce").fillna(18.0)
        df["rain"] = pd.to_numeric(df["rain"], errors="coerce").fillna(0).astype(int)
        self._history = df.sort_values(["village_id","product_id","date"]).reset_index(drop=True)

    @staticmethod
    def _cyc(vals, period: int):
        rad = 2 * math.pi * vals.astype(float) / period
        return np.sin(rad), np.cos(rad)

    def _build_frame_with_lags(self, g: "pd.DataFrame") -> "pd.DataFrame":
        g = g.copy()
        g["lag1"] = g["qty"].shift(1)
        g["lag7"] = g["qty"].shift(7)
        g["ma7"] = g["qty"].rolling(7, min_periods=1).mean().shift(1)
        dow_sin, dow_cos = self._cyc(g["dow"], 7)
        mon_sin, mon_cos = self._cyc(g["month"], 12)
        doy_sin, doy_cos = self._cyc(g["doy"], 365)
        g["dow_sin"], g["dow_cos"] = dow_sin, dow_cos
        g["mon_sin"], g["mon_cos"] = mon_sin, mon_cos
        g["doy_sin"], g["doy_cos"] = doy_sin, doy_cos
        return g

    def _train_one(self, vid: int, pid: int):
        assert self._history is not None
        key = (vid, pid)
        g = self._history[(self._history["village_id"]==vid) & (self._history["product_id"]==pid)]
        if g.empty or len(g) < 25:
            raise ValueError("not enough data")
        g = self._build_frame_with_lags(g)
        feats = [
            "temp","rain","lag1","lag7","ma7",
            "dow_sin","dow_cos","mon_sin","mon_cos","doy_sin","doy_cos"
        ]
        # FutureWarning 해결: fillna(method="ffill") -> ffill()
        X = g[feats].ffill().fillna(0.0)
        y = g["qty"].astype(float)
        valid = g["lag1"].notna()
        X, y = X[valid], y[valid]
        if len(X) < 20:
            raise ValueError("not enough valid rows")

        models: Dict[str, object] = {}
        preds = []

        if _SKLEARN_OK:
            rf = RandomForestRegressor(
                n_estimators=200, max_depth=None, min_samples_leaf=2, random_state=42, n_jobs=-1
            )
            rf.fit(X, y)
            models["rf"] = rf
            preds.append(rf.predict(X))

        if _SKLEARN_OK:
            hgb = HistGradientBoostingRegressor(
                max_depth=4, max_iter=250, learning_rate=0.06, random_state=42
            )
            hgb.fit(X, y)
            models["hgb"] = hgb
            preds.append(hgb.predict(X))

        if _XGB_OK:
            dtrain = xgb.DMatrix(X.values, label=y.values)
            params = {
                "objective":"reg:squarederror","eta":0.08,"max_depth":4,
                "subsample":0.9,"colsample_bytree":0.9,"seed":42,"eval_metric":"rmse"
            }
            xgbm = xgb.train(params, dtrain, num_boost_round=300, verbose_eval=False)
            models["xgb"] = xgbm
            preds.append(xgbm.predict(dtrain))

        if not preds:
            raise ValueError("no model available")
        ens = np.mean(np.vstack(preds), axis=0)
        resid = y.values - ens
        sigma = float(np.std(resid)) if len(resid) > 1 else 3.0

        self._models[key] = models
        self._sigmas[key] = sigma

    def _ensure_model(self, vid: int, pid: int):
        key = (vid, pid)
        if key not in self._models:
            self._train_one(vid, pid)

    def _feature_row(self, vid: int, pid: int, target_date: dt.date) -> Dict[str,float]:
        assert self._history is not None
        g = self._history[(self._history["village_id"]==vid) & (self._history["product_id"]==pid)].copy()
        g = g.sort_values("date")
        recent = g[g["date"] <= target_date].tail(14)
        temp = float(recent["temp"].mean()) if not recent.empty else 18.0
        rain = int(round(recent["rain"].mean())) if not recent.empty else 0
        d1 = target_date - dt.timedelta(days=1)
        d7 = target_date - dt.timedelta(days=7)
        lag1 = float(g.loc[g["date"]==d1,"qty"].iloc[0]) if (g["date"]==d1).any() else float(g["qty"].iloc[-1]) if len(g) else 15.0
        lag7 = float(g.loc[g["date"]==d7,"qty"].iloc[0]) if (g["date"]==d7).any() else float(g["qty"].tail(7).mean()) if len(g) else 15.0
        mask7 = (g["date"] <= d1) & (g["date"] > d1 - dt.timedelta(days=7))
        ma7 = float(g.loc[mask7,"qty"].mean()) if g.loc[mask7].shape[0]>0 else float(g["qty"].tail(7).mean()) if len(g) else 15.0
        dow = target_date.weekday()
        month = target_date.month
        doy = target_date.timetuple().tm_yday
        def cyc(v, p):
            r = 2*math.pi*float(v)/p
            return math.sin(r), math.cos(r)
        dow_sin, dow_cos = cyc(dow, 7)
        mon_sin, mon_cos = cyc(month, 12)
        doy_sin, doy_cos = cyc(doy, 365)
        return {
            "temp": temp, "rain": rain, "lag1": lag1, "lag7": lag7, "ma7": ma7,
            "dow_sin": dow_sin, "dow_cos": dow_cos, "mon_sin": mon_sin, "mon_cos": mon_cos,
            "doy_sin": doy_sin, "doy_cos": doy_cos
        }

    def predict_one(self, vid: int, pid: int, target_date: dt.date) -> ForecastItem:
        self._ensure_model(vid, pid)
        models = self._models[(vid, pid)]
        sigma = self._sigmas.get((vid, pid), 4.0)
        feats = self._feature_row(vid, pid, target_date)
        order = ["temp","rain","lag1","lag7","ma7","dow_sin","dow_cos","mon_sin","mon_cos","doy_sin","doy_cos"]

        # 경고 제거: 예측 입력에 컬럼명을 포함한 DataFrame 전달
        X1_df = pd.DataFrame([{k: feats[k] for k in order}])[order]

        preds = []
        used = []
        if "rf" in models:
            preds.append(models["rf"].predict(X1_df)[0]); used.append("rf")
        if "hgb" in models:
            preds.append(models["hgb"].predict(X1_df)[0]); used.append("hgb")
        if "xgb" in models:
            dm = xgb.DMatrix(X1_df.values)  # type: ignore
            preds.append(models["xgb"].predict(dm)[0]); used.append("xgb")

        y_hat = float(np.mean(preds)) if preds else 15.0
        base = max(0.0, y_hat)
        qty = int(round(base * 1.10))  # 안전버퍼
        low = max(0, int(round(base - 1.0 * sigma)))
        high = int(round(base + 1.6 * sigma))

        return ForecastItem(
            village_id=vid,
            product_id=pid,
            qty=qty,
            conf_low=low,
            conf_high=high,
            details={
                "model": f"ensemble({'+'.join(used)})" if used else "rule",
                "y_hat": round(base,1),
                "sigma": round(sigma,2),
                "features": feats,
            },
        )

# ---------------- Rule-based fallback ----------------
def _seed_history(villages: List[int], products: List[int], days: int = 120) -> List[Tuple[int,int,dt.date,int]]:
    today = dt.date.today()
    out = []
    for vid in villages:
        for pid in products:
            base = 20 + (pid % 7) * 2
            for d in range(days):
                day = today - dt.timedelta(days=days - d)
                w = day.weekday()
                weekday_factor = 1.0
                if w in (1, 4):
                    weekday_factor = 1.2
                elif w in (5, 6):
                    weekday_factor = 0.8
                trend = 1.0 + d / days * 0.05
                noise = random.uniform(0.85, 1.15)
                qty = max(0, int(round(base * weekday_factor * trend * noise)))
                out.append((vid, pid, day, qty))
    return out

def _forecast_rule_based(date: str, villages: List[int], products: List[int]) -> List[ForecastItem]:
    hist = _seed_history(villages, products, days=120)
    target_w = _weekday_idx(date)
    buckets: Dict[Tuple[int,int,int], List[int]] = defaultdict(list)
    last_date = max(h[2] for h in hist)
    cutoff = last_date - dt.timedelta(days=28)
    for vid, pid, d, qty in hist:
        if d.weekday() != target_w: continue
        if d <= cutoff: continue
        buckets[(vid, pid, d.weekday())].append(qty)

    out: List[ForecastItem] = []
    for vid in villages:
        for pid in products:
            arr = buckets.get((vid, pid, target_w), [])
            if not arr:
                arr = [q for (v,p,dd,q) in hist if v==vid and p==pid and (last_date - dd).days <= 7]
            if not arr:
                base = 20; sigma = 5
            else:
                weights = list(range(1, len(arr)+1))
                base = sum(a*w for a,w in zip(arr, weights)) / sum(weights)
                mean = sum(arr)/len(arr)
                var = sum((x-mean)**2 for x in arr) / max(1,(len(arr)-1))
                sigma = math.sqrt(var)
            qty = int(round(base * 1.10 + sigma))
            low = max(0, int(round(base - 1.0*sigma)))
            high = int(round(base + 1.5*sigma))
            out.append(ForecastItem(
                village_id=vid, product_id=pid, qty=qty, conf_low=low, conf_high=high,
                details={"model":"rule","sigma":round(float(sigma),2),"base":round(float(base),1)}
            ))
    return out

# ---------------- Public API ----------------
_BASE_DIR = Path(__file__).resolve().parent.parent
_ML: Optional[_MLForecaster] = None
if _SKLEARN_OK:
    try:
        _ML = _MLForecaster(_BASE_DIR)
    except Exception:
        _ML = None

def forecast(date: str, villages: List[int], products: List[int]) -> List[ForecastItem]:
    try:
        target_date = dt.date.fromisoformat(date)
    except Exception:
        target_date = dt.date.today()

    if _ML is None:
        return _forecast_rule_based(target_date.isoformat(), villages, products)

    out: List[ForecastItem] = []
    for vid in villages:
        for pid in products:
            try:
                out.append(_ML.predict_one(vid, pid, target_date))
            except Exception:
                out.extend(_forecast_rule_based(target_date.isoformat(), [vid], [pid]))
    return out

def predict(date: str, villages: List[int], products: List[int]):
    return forecast(date, villages, products)
