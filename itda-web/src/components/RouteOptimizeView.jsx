// src/components/RouteOptimizeView.jsx
import { useEffect, useRef, useState } from "react";
import { getJSON, postJSON } from "../api";

/**
 * 경로 최적화 (AI)
 * - 수요예측(ML) 결과로 마을 우선도(priority) 산출
 * - 차량 현재 위치를 시작점으로 사용
 * - /route/optimize 로 최적 경로 요청
 */
export default function RouteOptimizeView() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [serviceMin, setServiceMin] = useState(8);
  const [maxStops, setMaxStops] = useState(8);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);

  const modelMeta = "AI: demand-ensemble(rf+hgb+xgb) ➜ 2-opt routing";

  // 샘플 마을 좌표
  const villageGeo = {
    1: { id: 1, name: "마을 #1", lat: 35.284, lon: 126.514 },
    2: { id: 2, name: "마을 #2", lat: 35.300, lon: 126.488 },
    3: { id: 3, name: "마을 #3", lat: 35.270, lon: 126.530 },
  };

  const mapRef = useRef(null);
  const polyRef = useRef(null);
  const markersRef = useRef([]);

  const ensureLeafletLoaded = async () => {
    if (window.L) return;
    await new Promise((res) => {
      const cssId = "leaflet-css";
      if (!document.getElementById(cssId)) {
        const link = document.createElement("link");
        link.id = cssId;
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
      const jsId = "leaflet-js";
      if (document.getElementById(jsId)) return res();
      const script = document.createElement("script");
      script.id = jsId;
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => res();
      document.body.appendChild(script);
    });
  };

  const drawMap = async (ordered) => {
    await ensureLeafletLoaded();
    const L = window.L;

    if (!mapRef.current) {
      mapRef.current = L.map("routing-map", { center: [35.284, 126.514], zoom: 12 });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(mapRef.current);
    }

    if (polyRef.current) {
      try { mapRef.current.removeLayer(polyRef.current); } catch {}
      polyRef.current = null;
    }
    markersRef.current.forEach((m) => { try { mapRef.current.removeLayer(m); } catch {} });
    markersRef.current = [];

    if (!ordered?.length) return;

    const latlngs = ordered.map((s) => [s.lat, s.lon]);
    polyRef.current = window.L.polyline(latlngs, { weight: 5, opacity: 0.85, color: "#22c55e" })
      .addTo(mapRef.current);

    ordered.forEach((s, idx) => {
      const html = `<div style="width:28px;height:28px;border-radius:9999px;background:#16a34a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25);">${idx + 1}</div>`;
      const icon = window.L.divIcon({ html, className: "itda-pin", iconSize: [28, 28] });
      const mk = window.L.marker([s.lat, s.lon], { icon }).addTo(mapRef.current);
      const vid = s.village_id ?? s.id;
      mk.bindTooltip(`마을 #${vid}`, { permanent: false });
      markersRef.current.push(mk);
    });

    const bounds = window.L.latLngBounds(latlngs);
    mapRef.current.fitBounds(bounds.pad(0.18));
  };

  useEffect(() => {
    if (result?.ordered_stops?.length) drawMap(result.ordered_stops);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const runOptimize = async () => {
    setLoading(true);
    setErr("");
    setResult(null);

    try {
      // 차량 시작 좌표
      const vehResp = await getJSON("/vehicles/list").catch(() => ({ vehicles: [] }));
      const start = vehResp?.vehicles?.[0];
      const start_lat = typeof start?.lat === "number" ? start.lat : 35.271;
      const start_lon = typeof start?.lon === "number" ? start.lon : 126.502;

      // (ML) 수요예측 → 우선도
      const villages = [1, 2, 3];
      const products = [101, 102, 103];
      const fc = await postJSON("/demand/forecast", { date, villages, products });

      const pri = { 1: 0, 2: 0, 3: 0 };
      (fc?.results || []).forEach((r) => {
        const v = r.village_id;
        pri[v] = (pri[v] || 0) + (r.pred || 0);
      });

      // ✅ 백엔드 스키마: villages[*].id 필수 (village_id 아님!)
      const stops = villages.slice(0, maxStops).map((vid) => ({
        id: vid,
        lat: villageGeo[vid].lat,
        lon: villageGeo[vid].lon,
        priority: pri[vid] || 0,
        service_min: Number(serviceMin),
      }));

      const opt = await postJSON("/route/optimize", {
        vehicle: { start_lat, start_lon, start_time: `${date}T09:00:00` },
        villages: stops,
        objective: "weighted_distance_time",
        meta: { model: modelMeta, date },
      });

      setResult(opt);
    } catch (e) {
      setErr(e.message || "경로 최적화 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const fmtHHMM = (iso) => {
    try { return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }); }
    catch { return "-"; }
  };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <div className="card-title">🛣️ 경로 최적화 (AI)</div>
        <div style={{ color: "#64748b", fontSize: 13 }}>{modelMeta}</div>
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", marginBottom: 12 }}>
        <div>
          <div className="label-sm">날짜</div>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <div className="label-sm">마을당 서비스 시간(분)</div>
          <input className="input" inputMode="numeric" value={serviceMin}
                 onChange={(e) => setServiceMin(e.target.value.replace(/[^\d]/g, ""))} />
        </div>
        <div>
          <div className="label-sm">최대 방문 정류장 수</div>
          <input className="input" inputMode="numeric" value={maxStops}
                 onChange={(e) => setMaxStops(e.target.value.replace(/[^\d]/g, ""))} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <button className="button" onClick={runOptimize} disabled={loading}>
          {loading ? "계산 중..." : "🧠 AI 경로 계산"}
        </button>
        {result?.ordered_stops?.length ? (
          <span className="pill">총 {Number(result.total_distance_km ?? 0).toFixed(1)} km · 예상 {result.est_duration_min ?? "-"} 분</span>
        ) : null}
      </div>

      {err && <div className="alert alert-warning" style={{ marginBottom: 12 }}>{err}</div>}

      <div style={{ display: "grid", gap: 18, gridTemplateColumns: "1.3fr 1fr" }}>
        <div className="card" style={{ margin: 0 }}>
          <div className="card-title">🚩 방문 순서 & ETA</div>
          <div className="chart-placeholder route-box" style={{ height: "auto", padding: 0, border: "none" }}>
            {result?.ordered_stops?.length ? (
              <ol className="route-list" style={{ padding: "12px 16px" }}>
                {result.ordered_stops.map((s, i) => {
                  const vid = s.village_id ?? s.id;
                  return (
                    <li key={i} style={{ margin: "8px 0" }}>
                      <b>{i + 1}.</b> 마을 #{vid}{" "}
                      <span className="pill">ETA {s.eta ? fmtHHMM(s.eta) : "-"}</span>
                      <span className="pill" style={{ marginLeft: 6 }}>구간 {Number(s.distance_km ?? 0).toFixed(1)} km</span>
                      {typeof s.priority === "number" ? (
                        <span className="pill tag-soft" style={{ marginLeft: 6 }}>우선도 {Math.round(s.priority)}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div style={{ padding: 16 }}>🗺️ 상단 ‘AI 경로 계산’을 눌러 최적 경로를 확인하세요.</div>
            )}
          </div>

          <div id="routing-map" className="map-wrap" style={{ height: 360, borderRadius: 12, overflow: "hidden", marginTop: 8 }} />
        </div>

        <div className="card" style={{ margin: 0 }}>
          <div className="card-title">📈 요약 · 지속가능성 지표</div>
          <div className="table-like" style={{ border: "1px dashed #d8e3ea" }}>
            <div className="table-header" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
              <div>지표</div><div>값</div>
            </div>
            <div className="table-row" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
              <div>총 거리</div>
              <div>{Number(result?.total_distance_km ?? 0).toFixed(1)} km</div>
            </div>
            <div className="table-row" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
              <div>예상 소요</div>
              <div>{result?.est_duration_min ?? "-"} 분</div>
            </div>
            <div className="table-row" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
              <div>추정 CO₂ 절감(대비 15% 단축 가정)</div>
              <div>{result ? Math.round((result.total_distance_km || 0) * 0.15 * 0.21) : 0} kg</div>
            </div>
            <div className="table-row" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
              <div>사용 모델</div>
              <div>{modelMeta}</div>
            </div>
          </div>

          <div className="alert alert-info" style={{ marginTop: 12 }}>
            수요예측(랜덤포레스트+HistGB+XGBoost 앙상블)로 마을별 우선도를 계산하고,
            경로는 2-opt 휴리스틱으로 개선했습니다. (우선도 기반 가중 거리/시간 최소화)
          </div>
        </div>
      </div>
    </div>
  );
}
