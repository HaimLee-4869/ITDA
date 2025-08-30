// src/components/DriverView.jsx
import { useEffect, useRef, useState } from "react";
import { getJSON, postJSON } from "../api";
import useSpeech from "../hooks/useSpeech";
import SalesView from "./SalesView";
import "./driver.nbs.css"; // ⬅️ Next-Best-Stop 전용 스타일

export default function DriverView() {
  const [driverPage, setDriverPage] = useState("home");

  /** ===================== 공통 유틸 ===================== */
  const haversine = (lat1, lon1, lat2, lon2) => {
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 6371; // km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  };
  // 간단한 시드 난수 (마을별 데모값 일관성)
  const seeded = (seed) => {
    const x = Math.sin(seed * 9301 + 49297) * 233280;
    return x - Math.floor(x);
  };

  // 로컬 방문기록(학습용)
  const VISIT_KEY = "itda_visit_logs";
  const getVisitLogs = () => {
    try { return JSON.parse(localStorage.getItem(VISIT_KEY) || "[]"); } catch { return []; }
  };
  const addVisitLog = (log) => {
    const arr = getVisitLogs();
    arr.unshift(log);
    localStorage.setItem(VISIT_KEY, JSON.stringify(arr.slice(0, 200)));
  };
  // 과거 전환(없으면 데모 생성)
  const recentVillageStats = (villageId) => {
    const logs = getVisitLogs().filter((x) => x.village_id === villageId).slice(0, 30);
    const orders = logs.length;
    const revenue = logs.reduce((s, x) => s + (x.payment_total || 0), 0);
    if (orders > 0) {
      const histConv = Math.min(0.9, 0.5 + Math.log2(1 + orders) / 10);
      return { orders_30d: orders, revenue_30d: revenue, hist_conv: histConv };
    }
    // 데모: 주문 6~20건, 전환율 35~65%
    const r1 = seeded(villageId);
    const r2 = seeded(villageId + 7);
    const demoOrders = Math.round(6 + r1 * 14);
    const demoRevenue = Math.round(120000 + r2 * 180000);
    const demoConv = 0.35 + seeded(villageId + 13) * 0.3;
    return { orders_30d: demoOrders, revenue_30d: demoRevenue, hist_conv: demoConv };
  };

  /** ===================== 경로 최적화 ===================== */
  const [routeResult, setRouteResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const mapRef = useRef(null);
  const polyRef = useRef(null);
  const markersRef = useRef([]);

  const sampleVillages = [
    { id: 1, name: "행복마을", lat: 35.284, lon: 126.514, priority: 0.9 },
    { id: 2, name: "평화마을", lat: 35.3, lon: 126.488, priority: 0.7 },
    { id: 3, name: "소망마을", lat: 35.27, lon: 126.53, priority: 0.5 },
  ];

  const handleOptimize = async (preferFirstId = null) => {
    setLoading(true);
    setErr("");
    setRouteResult(null);
    try {
      const villages = [...sampleVillages];
      if (preferFirstId) {
        villages.sort((a, b) => (a.id === preferFirstId ? -1 : b.id === preferFirstId ? 1 : 0));
      }
      const data = await postJSON("/route/optimize", {
        villages: villages.map((v) => ({
          id: v.id,
          village_id: v.id,
          lat: v.lat,
          lon: v.lon,
          priority: v.priority,
          service_min: 8,
        })),
        vehicle: { start_lat: vehiclePos?.lat ?? 35.2810, start_lon: vehiclePos?.lon ?? 126.5024 },
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
    const data = await getJSON("/alerts/recent").catch(() => ({ alerts: [] }));
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
      if (a) speak(`가장 최근 알림. ${a.type === "emergency" ? "긴급" : "주의"}. ${a.message || a.title || ""}`);
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

  /** ===================== Leaflet 지도(경로) ===================== */
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

  // 상품 메타(가격)
  const PRODUCTS_META = {
    101: { name: "두부", price: 2000 },
    102: { name: "계란", price: 5000 },
    103: { name: "채소", price: 1500 },
  };

  // 재고 동기화: 불러오고 메시지 + NBS 즉시 재계산
  const loadInv = async () => {
    setInvLoading(true);
    setInvMsg("");
    try {
      const data = await getJSON(`/inventory/vehicle/${vehicleId}`).catch(() => ({ items: [] }));
      const items = data.items || [];
      setInv(items);

      const total = items.reduce(
        (s, it) => s + (Number(it.qty || 0) * (PRODUCTS_META[Number(it.product_id)]?.price || 0)),
        0
      );
      setInvMsg(`불러왔습니다 · ${items.length}종 · 총 ${total.toLocaleString()}원`);
      await runNBS({ externalInv: items });
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
      await runNBS({ externalInv: inv });
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

  /** ===================== Next Best Stop (핵심 AI 고도화) ===================== */
  const [nbsDate, setNbsDate] = useState(new Date().toISOString().slice(0, 10));
  const [nbsLoading, setNbsLoading] = useState(false);
  const [nbsRows, setNbsRows] = useState([]);
  const [nbsTop, setNbsTop] = useState(null);
  const [vehiclePos, setVehiclePos] = useState(null);

  const [cmp, setCmp] = useState([]);         // [id,id]
  const [detail, setDetail] = useState(null); // 상세 설명 row
  const [visitForm, setVisitForm] = useState(null);

  // 차량 현재 위치
  useEffect(() => {
    (async () => {
      try {
        const v = await getJSON("/vehicles/list");
        const first = (v.vehicles || [])[0];
        if (first && (first.lat ?? first.latitude) && (first.lon ?? first.longitude)) {
          setVehiclePos({ lat: first.lat ?? first.latitude, lon: first.lon ?? first.longitude });
        } else {
          setVehiclePos({ lat: 35.2810, lon: 126.5024 });
        }
      } catch {
        setVehiclePos({ lat: 35.2810, lon: 126.5024 });
      }
    })();
  }, []);

  // 지도(추천 버블)
  const nbsMapRef = useRef(null);
  const nbsCircleRefs = useRef([]);
  const drawNBSBubbles = async (rows) => {
    await ensureLeafletLoaded();
    const L = window.L;
    if (!nbsMapRef.current) {
      nbsMapRef.current = L.map("nbs-map", { center: [35.284, 126.514], zoom: 12 });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(nbsMapRef.current);
    }
    nbsCircleRefs.current.forEach((c) => { try { nbsMapRef.current.removeLayer(c); } catch {} });
    nbsCircleRefs.current = [];
    if (!rows?.length) return;
    const maxExp = Math.max(...rows.map((r) => r.expected || 1));
    const bounds = [];
    rows.forEach((r, idx) => {
      const base = Math.max(24, Math.min(48, 24 + (r.expected / (maxExp || 1)) * 24));
      const color = idx === 0 ? "#22c55e" : idx === 1 ? "#f59e0b" : "#ef4444";
      const circle = L.circleMarker([r.lat, r.lon], {
        radius: base / 2, color, weight: 2, fillColor: color, fillOpacity: 0.35,
      }).addTo(nbsMapRef.current);
      circle.bindTooltip(`${r.name} · 예상 ${r.expected}개 · ${r.dist_km ?? "-"}km`, { permanent: false });
      nbsCircleRefs.current.push(circle);
      bounds.push([r.lat, r.lon]);
    });
    if (bounds.length) nbsMapRef.current.fitBounds(bounds, { padding: [30, 30] });
  };

  // 재고 배열 → {pid:qty}
  const invMap = (items) => {
    const m = {};
    (items || []).forEach((it) => {
      const pid = Number(it.product_id);
      if (!pid) return;
      m[pid] = (m[pid] || 0) + Number(it.qty || 0);
    });
    return m;
  };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // NBS 실행 (externalInv로 강제 재계산 가능)
  const runNBS = async ({ externalInv } = {}) => {
    setNbsLoading(true);
    setCmp([]);
    setDetail(null);
    try {
      // 1) 수요예측 불러오기
      const villages = sampleVillages.map((v) => v.id);
      const products = [101, 102, 103];
      const res = await postJSON("/demand/forecast", { date: nbsDate, villages, products });
      const rows = res.results || res || [];

      // 2) 마을별/제품별 합산 + 제품별 전체합
      const mapByVillage = new Map();
      const totalByPid = {};
      for (const r of rows) {
        const vid = r.village_id ?? r.village ?? r.villageId;
        const pid = r.product_id ?? r.product ?? r.productId;
        const qty = Number(r.pred ?? r.qty ?? r.forecast ?? 0);
        const vinfo = sampleVillages.find((v) => v.id === vid);
        if (!vinfo) continue;
        if (!mapByVillage.has(vid)) {
          mapByVillage.set(vid, { id: vid, name: vinfo.name, lat: vinfo.lat, lon: vinfo.lon, total: 0, byProd: {} });
        }
        const obj = mapByVillage.get(vid);
        obj.total += qty;
        obj.byProd[pid] = (obj.byProd[pid] || 0) + qty;

        totalByPid[pid] = (totalByPid[pid] || 0) + qty;
      }
      const byId = [...mapByVillage.values()];
      const maxTotal = Math.max(1, ...byId.map((v) => v.total || 0));
      const maxDist = Math.max(
        0.1,
        ...byId.map((v) => (vehiclePos ? haversine(vehiclePos.lat, vehiclePos.lon, v.lat, v.lon) : 0.1))
      );

      // 0) 재고 스냅샷 (없으면 데모 재고 자동 생성: 전체 예측의 60%)
      let invItems = Array.isArray(externalInv) ? externalInv : inv;
      let invByPid = {};
      if (!invItems?.length) {
        invByPid = {};
        Object.entries(totalByPid).forEach(([pid, total]) => {
          invByPid[Number(pid)] = Math.max(1, Math.round(total * 0.6));
        });
      } else {
        invByPid = invMap(invItems);
      }
      const totalInvValue = Object.entries(invByPid).reduce(
        (s, [pid, q]) => s + (q || 0) * (PRODUCTS_META[pid]?.price || 0),
        0
      );

      // 3) 점수 행 만들기
      const rowsWithScore = byId.map((v) => {
        const dist = vehiclePos ? haversine(vehiclePos.lat, vehiclePos.lon, v.lat, v.lon) : null;
        const sortedProd = Object.entries(v.byProd)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([pid, q]) => ({
            pid: Number(pid),
            name: PRODUCTS_META[Number(pid)]?.name || `#${pid}`,
            qty: Math.round(q),
            price: PRODUCTS_META[Number(pid)]?.price || 0,
          }));

        // 재고 매칭도
        const covered = sortedProd.reduce((s, p) => s + Math.min(invByPid[p.pid] || 0, p.qty), 0);
        const demandTop2 = Math.max(1, sortedProd.reduce((s, p) => s + p.qty, 0));
        const invMatch = clamp01(covered / demandTop2);

        // 과거 전환 (로그 없으면 데모)
        const past = recentVillageStats(v.id);

        // 폐기 위험
        const usedValueTop = sortedProd.reduce((s, p) => s + Math.min(invByPid[p.pid] || 0, p.qty) * p.price, 0);
        const wasteRisk = totalInvValue > 0 ? clamp01((totalInvValue - usedValueTop) / totalInvValue) : 0;

        // 예상 매출
        const expectedRevenue = sortedProd.reduce(
          (s, p) => s + Math.min(p.qty, invByPid[p.pid] || 0) * p.price,
          0
        );

        // 설명 가능한 점수
        const zDemand = v.total / maxTotal;
        const zDist = dist ? dist / maxDist : 0;
        const w = { demand: 60, distance: 25, inv: 30, hist: 10, waste: 15 };
        const cDemand = Math.round(w.demand * zDemand);
        const cDist = -Math.round(w.distance * zDist);
        const cInv = Math.round(w.inv * invMatch);
        const cHist = Math.round(w.hist * past.hist_conv);
        const cWaste = -Math.round(w.waste * wasteRisk);
        const score = cDemand + cDist + cInv + cHist + cWaste;

        return {
          id: v.id,
          name: v.name,
          lat: v.lat,
          lon: v.lon,
          expected: Math.round(v.total),
          dist_km: dist ? Number(dist.toFixed(1)) : null,
          score,
          topItems: sortedProd.map((p) => ({ pid: p.pid, name: p.name, qty: p.qty })),
          past: { orders_30d: past.orders_30d, revenue_30d: past.revenue_30d },
          inv_match: invMatch,
          waste_risk: wasteRisk,
          expected_revenue: expectedRevenue,
          explain: { demand: cDemand, distance: cDist, inv: cInv, hist: cHist, waste: cWaste },
        };
      });

      rowsWithScore.sort((a, b) => b.score - a.score);
      setNbsRows(rowsWithScore);
      setNbsTop(rowsWithScore[0] || null);

      drawNBSBubbles(rowsWithScore);
    } catch (e) {
      console.error(e);
    } finally {
      setNbsLoading(false);
    }
  };

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

  /** ===================== KPI: 수요-공급 매칭 드러내기 ===================== */
  const kpiCards = () => {
    if (!nbsTop) return null;
    const fulfillment = `${Math.round((nbsTop.inv_match || 0) * 100)}`;
    const waste = `${Math.round((nbsTop.waste_risk || 0) * 100)}`;
    const eff =
      nbsTop.dist_km && (nbsTop.expected_revenue || 0) > 0
        ? `${Math.round((nbsTop.expected_revenue || 0) / nbsTop.dist_km).toLocaleString()}`
        : "0";
    return (
      <div className="nbs-metric-cards" style={{ marginTop: 12 }}>
        <div className="nbs-metric">
          <div className="nbs-metric-icon">🎯</div>
          <div>
            <div className="nbs-metric-val">
              {fulfillment} <small>%</small>
            </div>
            <div className="nbs-metric-label">예상 수요충족률</div>
          </div>
        </div>
        <div className="nbs-metric">
          <div className="nbs-metric-icon">🗑️</div>
          <div>
            <div className="nbs-metric-val">
              {waste} <small>%</small>
            </div>
            <div className="nbs-metric-label">폐기 위험(잔여 가치 비중)</div>
          </div>
        </div>
        <div className="nbs-metric">
          <div className="nbs-metric-icon">🚗</div>
          <div>
            <div className="nbs-metric-val">
              {eff} <small>원/km</small>
            </div>
            <div className="nbs-metric-label">이동 효율(예상매출/거리)</div>
          </div>
        </div>
      </div>
    );
  };

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

          {/* 🔥 핵심 AI: Next Best Stop */}
          {driverPage === "home" && (
            <div className="card">
              <div className="card-title">🧠 AI 추천 목적지 (Next Best Stop)</div>

              <div className="nbs-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="date"
                  value={nbsDate}
                  onChange={(e) => setNbsDate(e.target.value)}
                  className="input"
                  style={{ maxWidth: 180 }}
                />
                <button className="button nbs-run" onClick={() => runNBS()} disabled={nbsLoading}>
                  {nbsLoading ? "계산 중..." : "AI 추천 계산"}
                </button>
                <button className="button button-secondary" onClick={loadInv} disabled={invLoading}>
                  📥 재고 동기화
                </button>
                <span style={{ fontSize: 13, color: "#64748b" }}>{invMsg}</span>
                <span className="helper" style={{ marginLeft: 6 }}>
                  (* 수요·거리·재고매칭·과거전환·폐기위험을 반영)
                </span>
              </div>

              {/* 수요-공급 매칭 KPI */}
              {kpiCards()}

              {/* 지도 + 랭킹 */}
              <div className="nbs-stack" style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14, marginTop: 12 }}>
                <div id="nbs-map" className="nbs-map" style={{ height: 360, borderRadius: 12, overflow: "hidden", border: "1px solid #eef2f7" }} />
                <div className="nbs-list">
                  <div className="nbs-list-header" style={{ display: "grid", gridTemplateColumns: "90px 1fr 160px 90px", gap: 8, fontWeight: 700, background: "#f3f7fb", padding: "10px 12px", borderRadius: 8 }}>
                    <div>순위</div>
                    <div>마을</div>
                    <div>예상 판매</div>
                    <div>거리</div>
                  </div>

                  {nbsRows.map((r, idx) => (
                    <div className="nbs-row" key={r.id} style={{ display: "grid", gridTemplateColumns: "90px 1fr 160px 90px", gap: 8, alignItems: "center", padding: "10px 12px", borderBottom: "1px dashed #e5edf5" }}>
                      <div className="nbs-rank">
                        <span className={`pill rank-${idx + 1}`}>{idx + 1}</span>
                        <span className="score" style={{ marginLeft: 8, fontWeight: 700, color: "#111827" }}>{r.score}</span>
                      </div>
                      <div className="nbs-name">
                        <b>{r.name}</b>
                        <div className="nbs-sub" style={{ fontSize: 12, color: "#6b7280" }}>
                          주요 품목:{" "}
                          {r.topItems?.length
                            ? r.topItems.map((t) => `${t.name} ${t.qty}개`).join(", ")
                            : "데이터 부족"}
                        </div>
                      </div>
                      <div className="nbs-pred">
                        <div className="meter" style={{ background: "#f3f4f6", height: 8, borderRadius: 999, overflow: "hidden", marginBottom: 6 }}>
                          <i style={{ display: "block", height: "100%", width: `${Math.min(100, (r.expected / (nbsTop?.expected || 1)) * 100)}%`, background: "#22c55e" }} />
                        </div>
                        <b>{r.expected}개</b>
                      </div>
                      <div className="nbs-dist">
                        {r.dist_km ?? "-"}km
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <button className="button button-secondary" onClick={() => setDetail(r)}>🔍 왜?</button>
                          <button
                            className="button ghost"
                            onClick={() =>
                              setCmp((prev) => {
                                const s = new Set(prev);
                                s.has(r.id) ? s.delete(r.id) : (s.size < 2 && s.add(r.id));
                                return Array.from(s);
                              })
                            }
                          >
                            {cmp.includes(r.id) ? "✓ 비교중" : "비교"}
                          </button>
                          <button className="button" onClick={() => setVisitForm({ village: r })}>방문기록</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 비교 패널 */}
              {cmp.length === 2 && (
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="card-title">🔁 목적지 비교</div>
                  {(() => {
                    const [a, b] = cmp.map((id) => nbsRows.find((x) => x.id === id)).filter(Boolean);
                    if (!a || !b) return null;
                    const row = (x) => (
                      <tr>
                        <td>{x.name}</td>
                        <td>{x.dist_km}km</td>
                        <td>{x.expected}개</td>
                        <td>{`${Math.round((x.inv_match || 0) * 100)}%`}</td>
                        <td>{(x.expected_revenue || 0).toLocaleString()}원</td>
                        <td>{x.score}</td>
                      </tr>
                    );
                    return (
                      <table className="table-plain fixed">
                        <thead>
                          <tr>
                            <th>지역</th>
                            <th>거리</th>
                            <th>예측수요</th>
                            <th>재고매칭</th>
                            <th>예상매출</th>
                            <th>AI점수</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row(a)}
                          {row(b)}
                        </tbody>
                      </table>
                    );
                  })()}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="button" onClick={() => handleOptimize(cmp[0])}>A로 출발</button>
                    <button className="button" onClick={() => handleOptimize(cmp[1])}>B로 출발</button>
                    <button className="button button-secondary" onClick={() => setCmp([])}>비교 해제</button>
                  </div>
                </div>
              )}

              {/* 설명 Drawer */}
              {detail && (
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="card-title">🧠 점수 설명 — {detail.name}</div>
                  <table className="table-plain fixed">
                    <tbody>
                      <tr><td>예측수요</td><td>{detail.expected}개</td><td style={{ color: "#065f46" }}>+{detail.explain?.demand}</td></tr>
                      <tr><td>거리 패널티</td><td>{detail.dist_km}km</td><td style={{ color: "#991b1b" }}>{detail.explain?.distance}</td></tr>
                      <tr><td>재고 매칭도</td><td>{`${Math.round((detail.inv_match || 0) * 100)}%`}</td><td style={{ color: "#065f46" }}>{detail.explain?.inv >= 0 ? `+${detail.explain?.inv}` : detail.explain?.inv}</td></tr>
                      <tr><td>과거 전환</td><td>{`${Math.round((detail.explain?.hist ?? 0) * 10)}%*`}</td><td style={{ color: "#065f46" }}>{detail.explain?.hist >= 0 ? `+${detail.explain?.hist}` : detail.explain?.hist}</td></tr>
                      <tr><td>폐기 위험</td><td>{`${Math.round((detail.waste_risk || 0) * 100)}%`}</td><td style={{ color: "#991b1b" }}>{detail.explain?.waste}</td></tr>
                      <tr><td colSpan={3}><b>총점</b> {detail.score}</td></tr>
                    </tbody>
                  </table>
                  <div style={{ marginTop: 8, color: "#374151" }}>
                    상위상품: {detail.topItems?.map((t) => `${t.name} ${t.qty}개`).join(", ")} <br />
                    지난 30일: 주문 {detail.past?.orders_30d ?? 0}건 · 매출 {(detail.past?.revenue_30d ?? 0).toLocaleString()}원
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <button className="button button-secondary" onClick={() => setDetail(null)}>닫기</button>
                  </div>
                </div>
              )}

              {/* 기본 KPI */}
              <div className="nbs-metric-cards" style={{ marginTop: 12 }}>
                <div className="nbs-metric">
                  <div className="nbs-metric-icon">🛒</div>
                  <div>
                    <div className="nbs-metric-val">
                      {nbsTop?.expected ?? "-"} <small>개</small>
                    </div>
                    <div className="nbs-metric-label">추천 1순위 예상 판매</div>
                  </div>
                </div>
                <div className="nbs-metric">
                  <div className="nbs-metric-icon">📍</div>
                  <div>
                    <div className="nbs-metric-val">
                      {nbsTop?.dist_km ?? "-"} <small>km</small>
                    </div>
                    <div className="nbs-metric-label">거리</div>
                  </div>
                </div>
                <div className="nbs-metric">
                  <div className="nbs-metric-icon">⭐</div>
                  <div>
                    <div className="nbs-metric-val">{nbsTop?.score ?? "-"}</div>
                    <div className="nbs-metric-label">AI 점수</div>
                  </div>
                </div>
              </div>

              {/* 수요-공급 매칭 KPI 보강 */}
              {kpiCards()}

              {/* 요약 CTA */}
              <div className="alert alert-success" style={{ marginTop: 10 }}>
                {nbsTop ? (
                  <>
                    ✨ 지금은 <b>‘{nbsTop.name}’</b>로 가세요!&nbsp;
                    <span style={{ opacity: 0.9 }}>
                      예상 판매 {nbsTop.expected}개, 거리 {nbsTop.dist_km ?? "-"}km, 점수 {nbsTop.score}.&nbsp;
                      주요 품목: {nbsTop.topItems?.map((t) => `${t.name} ${t.qty}개`).join(", ")}
                    </span>
                  </>
                ) : (
                  <>AI 추천을 계산하면 최적 목적지를 알려드립니다.</>
                )}
              </div>

              {/* 방문 기록 폼 */}
              {visitForm && (
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="card-title">📝 방문 기록 — {visitForm.village.name}</div>
                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
                    <input className="input" placeholder="총 매출액(원)" onChange={(e) => (visitForm.total = +e.target.value || 0)} />
                    <input className="input" placeholder="두부 판매수량" onChange={(e) => (visitForm.tofu = +e.target.value || 0)} />
                    <input className="input" placeholder="계란 판매수량" onChange={(e) => (visitForm.egg = +e.target.value || 0)} />
                    <input className="input" placeholder="채소 판매수량" onChange={(e) => (visitForm.veg = +e.target.value || 0)} />
                    <textarea className="input" rows={3} placeholder="현장 소감/후기" onChange={(e) => (visitForm.note = e.target.value)} />
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="button"
                      onClick={async () => {
                        const payload = {
                          dt: new Date().toISOString(),
                          village_id: visitForm.village.id,
                          sold: [
                            { product_id: 101, qty: visitForm.tofu || 0, revenue: (visitForm.tofu || 0) * 2000 },
                            { product_id: 102, qty: visitForm.egg || 0, revenue: (visitForm.egg || 0) * 5000 },
                            { product_id: 103, qty: visitForm.veg || 0, revenue: (visitForm.veg || 0) * 1500 },
                          ],
                          payment_total: visitForm.total || 0,
                          note: visitForm.note || "",
                        };
                        try {
                          await postJSON("/telemetry/visit", payload).catch(() => {});
                          addVisitLog(payload);
                          alert("기록 저장 완료 — 다음 추천에 반영됩니다.");
                          setVisitForm(null);
                          runNBS();
                        } catch (e) {
                          alert(e.message || "저장 실패");
                        }
                      }}
                    >
                      저장
                    </button>
                    <button className="button button-secondary" onClick={() => setVisitForm(null)}>
                      취소
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 경로 최적화 */}
          {driverPage === "route" && (
            <div className="card">
              <div className="card-title">🛣️ 경로 최적화</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <button className="button" onClick={() => handleOptimize()} disabled={loading}>
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
                          마을 #{s.village_id} · ETA:{" "}
                          {s.eta ? new Date(s.eta).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"}) : "-"}
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
              <SalesView />
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
                  <b>최근 알림</b> — {latestAlert.type === "emergency" ? "🚨 긴급" : "⚠️ 주의"} · {latestAlert.message || latestAlert.title}
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
