// src/components/DriverView.jsx
import { useEffect, useRef, useState } from "react";
import { getJSON, postJSON } from "../api";
import useSpeech from "../hooks/useSpeech";

export default function DriverView() {
  const [driverPage, setDriverPage] = useState("home");

  /** ===================== 경로 최적화 ===================== */
  const [routeResult, setRouteResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const mapRef = useRef(null);
  const polyRef = useRef(null);
  const markersRef = useRef([]);

  const sampleVillages = [
    { id: 1, lat: 35.284, lon: 126.514, priority: 0.9 },
    { id: 2, lat: 35.3,  lon: 126.488, priority: 0.7 },
    { id: 3, lat: 35.27, lon: 126.53,  priority: 0.5 },
  ];

  const handleOptimize = async () => {
    setLoading(true);
    setErr("");
    setRouteResult(null);
    try {
      const data = await postJSON("/route/optimize", {
        villages: sampleVillages,
        vehicle: { start_lat: 35.271, start_lon: 126.502 },
      });
      setRouteResult(data);
      setDriverPage("route");
    } catch (e) {
      setErr(e.message || "경로 최적화 요청 중 오류가 발생했어요.");
    } finally {
      setLoading(false);
    }
  };

  /** ===================== 알림 ===================== */
  const [latestAlert, setLatestAlert] = useState(null);
  const fetchLatestAlert = async () => {
    const data = await getJSON("/alerts/recent");
    const a = (data.alerts || [])[0] || null;
    setLatestAlert(a);
    return a;
  };

  /** ===================== 음성 도우미 ===================== */
  const { supported, listening, transcript, error, start, stop, speak, onResult } = useSpeech({
    lang: "ko-KR",
  });
  const [voiceLog, setVoiceLog] = useState([]);
  const activateVoice = () => {
    if (!supported) return alert("이 브라우저에서는 음성 인식이 지원되지 않아요. 크롬을 권장합니다.");
    start();
  };

  onResult(async (text) => {
    setVoiceLog((prev) => [`👂 ${text}`, ...prev].slice(0, 8));
    const t = text.replace(/\s+/g, "");
    if (t.includes("경로") || t.includes("최적")) {
      speak("최적 경로를 계산합니다.");
      await handleOptimize();
      if (routeResult?.ordered_stops?.length) {
        const names = routeResult.ordered_stops.map((s, i) => `${i + 1}번, 마을 ${s.village_id}`).join(", ");
        speak(`방문 순서는 ${names} 입니다.`);
      }
      return;
    }
    if (t.includes("알림")) {
      const a = await fetchLatestAlert();
      if (a) speak(`가장 최근 알림. ${a.type === "emergency" ? "긴급" : "주의"}. ${a.message}`);
      else speak("최근 알림이 없습니다.");
      return;
    }
    if (t.includes("현재시간") || t.includes("지금몇시") || t.includes("시간")) {
      const now = new Date();
      speak(`현재 시각은 ${now.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })} 입니다.`);
      return;
    }
    if (t.includes("경로요약") || t.includes("순서")) {
      if (!routeResult?.ordered_stops?.length) speak("아직 경로 정보가 없습니다. 경로를 먼저 계산해 주세요.");
      else {
        const names = routeResult.ordered_stops.map((s, i) => `${i + 1}번, 마을 ${s.village_id}`).join(", ");
        speak(`총 거리 약 ${Math.round(routeResult.total_distance_km)} 킬로미터. 순서는 ${names} 입니다.`);
      }
      return;
    }
    speak("준비된 명령어가 아닙니다. 경로 계산해, 알림 읽어줘, 현재 시간 등을 말해 보세요.");
  });

  /** ===================== Leaflet 지도 ===================== */
  async function ensureLeafletLoaded() {
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
  }

  const drawMap = async () => {
    await ensureLeafletLoaded();
    const L = window.L;

    if (!mapRef.current) {
      mapRef.current = L.map("route-map", { center: [35.284, 126.514], zoom: 12 });
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

    const stops = routeResult?.ordered_stops ?? [];
    if (!stops.length) return;

    const latlngs = stops.map((s) => [s.lat, s.lon]);
    polyRef.current = window.L.polyline(latlngs, { weight: 5, opacity: 0.8, color: "#3b82f6" })
      .addTo(mapRef.current);

    stops.forEach((s, idx) => {
      const html = `<div style="
        width:28px;height:28px;border-radius:50%;
        background:#16a34a;color:#fff;display:flex;align-items:center;justify-content:center;
        font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25);">${idx + 1}</div>`;
      const icon = window.L.divIcon({ html, className: "itda-marker", iconSize: [28, 28] });
      const mk = window.L.marker([s.lat, s.lon], { icon }).addTo(mapRef.current);
      mk.bindTooltip(`마을 #${s.village_id}`, { permanent: false });
      markersRef.current.push(mk);
    });

    const bounds = window.L.latLngBounds(latlngs);
    mapRef.current.fitBounds(bounds.pad(0.2));
  };

  useEffect(() => { drawMap(); /* eslint-disable-next-line */ }, [routeResult]);

  /** ===================== 운전자 간편 재고 ===================== */
  const [vehicleId, setVehicleId] = useState(1);
  const [inv, setInv] = useState([]); // [{product_id,name,qty}]
  const [invMsg, setInvMsg] = useState("");
  const [invLoading, setInvLoading] = useState(false);

  const loadInv = async () => {
    setInvLoading(true);
    setInvMsg("");
    try {
      const data = await getJSON(`/inventory/vehicle/${vehicleId}`);
      setInv(data.items || []);
      setInvMsg("불러왔습니다.");
    } catch (e) {
      setInvMsg(e.message || "재고 불러오기 실패");
    } finally {
      setInvLoading(false);
    }
  };

  const saveInv = async () => {
    setInvLoading(true);
    setInvMsg("");
    try {
      await postJSON(`/inventory/vehicle/${vehicleId}/set`, { items: inv });
      setInvMsg("저장 완료");
    } catch (e) {
      setInvMsg(e.message || "저장 실패");
    } finally {
      setInvLoading(false);
    }
  };

  const addRow = () => setInv((prev) => [...prev, { product_id: "", name: "", qty: 0 }]);
  const delRow = (idx) => setInv((prev) => prev.filter((_, i) => i !== idx));
  const changeCell = (idx, key, val) =>
    setInv((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: val } : r)));
  const stepQty = (idx, delta) =>
    setInv((prev) => prev.map((r, i) => (i === idx ? { ...r, qty: Math.max(0, Number(r.qty || 0) + delta) } : r)));

  /** ===================== 공통 네비 ===================== */
  const NavItem = ({ id, icon, label }) => (
    <li
      className={`${driverPage === id ? "active" : ""}`}
      onClick={() => setDriverPage(id)}
      style={{ listStyle: "none", cursor: "pointer" }}
    >
      {icon} {label}
    </li>
  );

  return (
    <div className="driver-container">
      {/* Sidebar */}
      <div className="driver-sidebar">
        <h3>🚚 운전자 메뉴</h3>
        <ul className="driver-nav">
          <NavItem id="home" icon="🏠" label="오늘의 운행" />
          <NavItem id="route" icon="🛣️" label="경로 최적화" />
          <NavItem id="inventory" icon="📦" label="재고 관리" />
          <NavItem id="care" icon="💚" label="돌봄 노트" />
          <NavItem id="sales" icon="💰" label="매출 현황" />
          <NavItem id="voice" icon="🎤" label="음성 도우미" />

          {/* 사이드 위젯 */}
          <div className="voice-widget" style={{ marginTop: 24 }}>
            <h4>음성 도우미</h4>
            <button
              className={`voice-button-main ${listening ? "active" : ""}`}
              onClick={listening ? stop : activateVoice}
              title={listening ? "듣기 중지" : "듣기 시작"}
              aria-label={listening ? "듣기 중지" : "듣기 시작"}
            >
              {listening ? "🛑" : "🎤"}
            </button>
            <p style={{ fontSize: 13, opacity: 0.9 }}>
              {supported ? (listening ? "듣는 중..." : "클릭해서 음성명령") : "브라우저 미지원"}
            </p>
          </div>
        </ul>
      </div>

      {/* Main */}
      <div className="driver-main">
        <div className="driver-header">
          <h2>🚚 운전자용 인터페이스</h2>
          <div className="driver-status">
            <span>⏰ 09:30</span>
            <span>📅 2025.08.06</span>
            <span>🔋 A차량 운행중</span>
          </div>
        </div>

        <div className="driver-content">
          {/* 안내 */}
          <div className="alert alert-info" style={{ marginBottom: 20 }}>
            <strong>ℹ️ 운전자용 인터페이스</strong>
            <br />
            이 섹션에서는 운전자가 사용할 수 있는 기능이 구현되어 있습니다.
          </div>

          {/* 홈 */}
          {driverPage === "home" && (
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-number">7</div><div className="stat-label">방문 예정 마을</div></div>
              <div className="stat-card"><div className="stat-number">2h 15m</div><div className="stat-label">예상 소요시간</div></div>
              <div className="stat-card"><div className="stat-number">₩337K</div><div className="stat-label">예상 총 매출</div></div>
            </div>
          )}

          {/* 경로 최적화 */}
          {driverPage === "route" && (
            <div className="card">
              <div className="card-title">🛣️ 경로 최적화</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <button className="button" onClick={handleOptimize} disabled={loading}>
                  {loading ? "계산 중..." : "최적 경로 계산"}
                </button>
              </div>
              {err && <div className="alert alert-warning" style={{ marginBottom: 12 }}>{err}</div>}
              <div className="chart-placeholder route-box">
                {routeResult ? (
                  <>
                    <div className="route-summary">
                      <b>총 거리:</b> {Number(routeResult.total_distance_km ?? 0).toFixed(1)} km &nbsp;|&nbsp;
                      <b>예상 소요:</b> {routeResult.est_duration_min ?? "-"} 분
                    </div>
                    <ol className="route-list">
                      {(routeResult.ordered_stops ?? []).map((s, idx) => (
                        <li key={idx}>
                          마을 #{s.village_id} · ETA: {s.eta ? new Date(s.eta).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"}) : "-"}
                          {" · "}약 {s.distance_km} km
                        </li>
                      ))}
                    </ol>
                  </>
                ) : (<div>🗺️ 버튼을 눌러 최적 경로를 계산하세요</div>)}
              </div>
              <div id="route-map" style={{ height: 360, borderRadius: 12, overflow: "hidden", marginTop: 12 }} />
            </div>
          )}

          {/* 간편 재고 관리 */}
          {driverPage === "inventory" && (
            <div className="card">
              <div className="card-title">📦 재고 관리</div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                <select value={vehicleId} onChange={(e) => setVehicleId(Number(e.target.value))} className="input">
                  <option value={1}>A차량 (#1)</option>
                </select>
                <button className="button button-secondary" onClick={loadInv} disabled={invLoading}>📥 불러오기</button>
                <button className="button" onClick={saveInv} disabled={invLoading}>💾 저장</button>
                <span style={{ fontSize: 13, opacity: 0.8 }}>{invMsg}</span>
              </div>

              <div className="table-like">
                <div className="table-header">
                  <div>상품ID</div><div>상품명</div><div>수량</div><div />
                </div>

                {(inv.length ? inv : [{ product_id: "", name: "", qty: 0 }]).map((row, idx) => (
                  <div className="table-row" key={idx}>
                    <div><input className="input" value={row.product_id} onChange={(e)=>changeCell(idx,"product_id",e.target.value)} placeholder="예: 101" /></div>
                    <div><input className="input" value={row.name} onChange={(e)=>changeCell(idx,"name",e.target.value)} placeholder="예: 두부" /></div>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <button className="qty-btn" onClick={()=>stepQty(idx,-1)}>-</button>
                      <input className="input" style={{ width:80, textAlign:"center" }} value={row.qty} onChange={(e)=>changeCell(idx,"qty",e.target.value.replace(/[^\d]/g,""))} />
                      <button className="qty-btn" onClick={()=>stepQty(idx,+1)}>+</button>
                    </div>
                    <div><button className="button danger" onClick={()=>delRow(idx)}>삭제</button></div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 10 }}>
                <button className="button ghost" onClick={addRow}>+ 행 추가</button>
              </div>
            </div>
          )}

          {/* 돌봄 노트 */}
          {driverPage === "care" && (
            <div className="card">
              <div className="card-title">💚 돌봄 노트</div>
              <div className="chart-placeholder">관리자 대시보드에서 상세 관리합니다.</div>
            </div>
          )}

          {/* 매출 (데모) */}
          {driverPage === "sales" && (
            <div className="card">
              <div className="card-title">💰 매출 현황</div>
              <div className="chart-placeholder">일/주/월 매출 추이(데모)</div>
            </div>
          )}

          {/* 음성 도우미 */}
          {driverPage === "voice" && (
            <div className="card">
              <div className="card-title">🎤 음성 도우미</div>
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12 }}>
                <button
                  className={`voice-button-main ${listening ? "active" : ""}`}
                  onClick={listening ? stop : activateVoice}
                  title={listening ? "듣기 중지" : "듣기 시작"}
                  aria-label={listening ? "듣기 중지" : "듣기 시작"}
                >
                  {listening ? "🛑" : "🎤"}
                </button>
                <button className="button" onClick={() => speak("안녕하세요. 잇다 음성 도우미입니다.")}>🔊 테스트 읽기</button>
                <button className="button button-secondary" onClick={fetchLatestAlert}>🔄 알림 불러오기</button>
              </div>

              <div className="alert alert-info" style={{ marginBottom: 12 }}>
                <b>예시 명령:</b> “경로 계산해”, “경로 요약”, “알림 읽어줘”, “현재 시간”
              </div>

              {transcript && <div className="alert alert-success" style={{ marginBottom: 12 }}>마지막 인식: <b>{transcript}</b></div>}
              {error && <div className="alert alert-warning">음성 오류: {error}</div>}

              {latestAlert && (
                <div className="alert alert-warning" style={{ marginTop: 12 }}>
                  <b>최근 알림</b> — {latestAlert.type === "emergency" ? "🚨 긴급" : "⚠️ 주의"} · {latestAlert.message}
                  <br /><small>{latestAlert.ts}</small>
                </div>
              )}

              <div className="voice-log">
                {voiceLog.map((l, i) => (<div key={i} className="voice-log-item">{l}</div>))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
