// src/components/InventoryOptimizeView.jsx
import { useEffect, useMemo, useState } from "react";
import { getJSON, postJSON } from "../api";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// 데모 메타데이터(단위용적·원가). 실제로는 백엔드/DB 연동 권장
const PRODUCTS_META = {
  101: { name: "두부", unit_volume: 1, unit_cost: 1200, price: 2000 },
  102: { name: "계란", unit_volume: 1, unit_cost: 3500, price: 5000 },
  103: { name: "채소", unit_volume: 1, unit_cost: 800, price: 1500 },
};

const VILLAGES = [
  { id: 1, name: "행복마을" },
  { id: 2, name: "평화마을" },
  { id: 3, name: "소망마을" },
];

const PRODUCTS = Object.keys(PRODUCTS_META).map((k) => ({ id: Number(k), name: PRODUCTS_META[Number(k)].name }));

const nextDateISO = (n = 1) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

// 표준정규분포 Z값(서비스레벨→Z). 간단 Look-up
function zFromServiceLevel(p) {
  if (p >= 0.997) return 3.0;
  if (p >= 0.990) return 2.33;
  if (p >= 0.975) return 1.96;
  if (p >= 0.950) return 1.645;
  if (p >= 0.900) return 1.282;
  if (p >= 0.800) return 0.842;
  return 0.0;
}

/**
 * 그리디 적재 최적화:
 * - 목표: 차량 용적(capacity) 제약 하에 기대매출(= min(수요, 적재) * 가격) 최대화
 * - 휴리스틱: (기대매출 증가 / 단위용적) 비율 높은 항목부터 단위씩 채우기
 * - 수요는 모든 마을 총합 기준(데모) — 실제는 마을별 라우팅/분배까지 확장 가능
 */
function greedyLoadPlan({ capacity, demandByProduct, currentByProduct }) {
  const meta = PRODUCTS_META;
  const remainingDemand = {};
  const load = {};
  const unitVolume = {};
  const unitValue = {};

  PRODUCTS.forEach((p) => {
    const pid = p.id;
    remainingDemand[pid] = Math.max(0, Math.round(demandByProduct[pid] ?? 0));
    load[pid] = 0;
    unitVolume[pid] = meta[pid]?.unit_volume ?? 1;
    unitValue[pid] = meta[pid]?.price ?? 1000; // 단위 매출(간단화)
  });

  let cap = capacity;
  // “한 단위 추가”의 한계가치/부피 비율 기준 후보 생성
  const items = PRODUCTS.map((p) => {
    const pid = p.id;
    const valuePerUnit = unitValue[pid] / unitVolume[pid];
    return { pid, valuePerUnit };
  }).sort((a, b) => b.valuePerUnit - a.valuePerUnit);

  // 단위 그리디 충전
  loop: while (cap > 0) {
    for (const it of items) {
      const pid = it.pid;
      if (remainingDemand[pid] <= 0) continue;
      if (cap - unitVolume[pid] < 0) continue;
      // 적재 1단위
      load[pid] += 1;
      remainingDemand[pid] -= 1;
      cap -= unitVolume[pid];
      if (cap <= 0) break loop;
    }
    // 더 이상 넣을 수 없으면 종료
    const anyAlloc = items.some((it) => remainingDemand[it.pid] > 0 && cap - unitVolume[it.pid] >= 0);
    if (!anyAlloc) break;
  }

  // 기대매출(추천 적재 기준)
  let expectedRevenue = 0;
  PRODUCTS.forEach((p) => {
    const pid = p.id;
    const sold = Math.min(load[pid] + (currentByProduct[pid] ?? 0), demandByProduct[pid] ?? 0);
    const soldWithout = Math.min((currentByProduct[pid] ?? 0), demandByProduct[pid] ?? 0);
    expectedRevenue += (sold - soldWithout) * (meta[pid]?.price ?? 0);
  });

  return { load, expectedRevenue };
}

export default function InventoryOptimizeView({ vehicleId = 1, currentItems = [] }) {
  const [date, setDate] = useState(nextDateISO(1));
  const [serviceLevel, setServiceLevel] = useState(0.95);
  const [leadTime, setLeadTime] = useState(2); // 일
  const [capacity, setCapacity] = useState(120); // 단위 용적
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]); // /demand/forecast 결과

  const currentByProduct = useMemo(() => {
    const m = {};
    currentItems.forEach((r) => {
      const pid = Number(r.product_id);
      if (!pid) return;
      m[pid] = (m[pid] || 0) + Number(r.qty || 0);
    });
    return m;
  }, [currentItems]);

  // 예측 로드
  const loadForecast = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await postJSON("/demand/forecast", {
        date,
        villages: VILLAGES.map((v) => v.id),
        products: PRODUCTS.map((p) => p.id),
      });
      setRows(res?.results || []);
    } catch (e) {
      setError(e.message || "예측 불러오기 실패");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadForecast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // μ,σ 집계(전체 마을 합)
  const muSigmaByProduct = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      const pid = r.product_id;
      const mu = r?.details?.y_hat ?? r.qty ?? 0;
      // 상세 σ 제공되면 사용, 없으면 (conf 구간/1.6) 근사
      const sigma = r?.details?.sigma ?? Math.max(1, (r.conf_high - r.conf_low) / 1.6);
      m[pid] = m[pid] || { mu: 0, sigma2: 0 };
      m[pid].mu += mu;
      m[pid].sigma2 += sigma * sigma; // 독립 가정하 합산
    });
    const out = {};
    Object.entries(m).forEach(([pid, v]) => {
      out[pid] = { mu: v.mu, sigma: Math.sqrt(v.sigma2) };
    });
    return out;
  }, [rows]);

  // 목표 재고수준 = μ*L + Z*σ*√L  (단순 합계 수요 가정)
  const targets = useMemo(() => {
    const Z = zFromServiceLevel(serviceLevel);
    const L = Math.max(1, Number(leadTime));
    const t = {};
    Object.entries(muSigmaByProduct).forEach(([pid, v]) => {
      const target = v.mu * L + Z * v.sigma * Math.sqrt(L);
      t[Number(pid)] = Math.max(0, Math.round(target));
    });
    return t;
  }, [muSigmaByProduct, serviceLevel, leadTime]);

  // 추천 발주/적재량(= max(0, Target - 현재고))
  const orderSuggestion = useMemo(() => {
    const o = {};
    Object.keys(targets).forEach((k) => {
      const pid = Number(k);
      const need = Math.max(0, (targets[pid] || 0) - (currentByProduct[pid] || 0));
      o[pid] = need;
    });
    return o;
  }, [targets, currentByProduct]);

  // 차량 적재 최적화(용적 제약)
  const loadPlan = useMemo(() => {
    const demandByProduct = {};
    Object.keys(orderSuggestion).forEach((k) => {
      const pid = Number(k);
      // 리드타임 구간 동안 판매 예상치(μ*L). 안전재고는 발주쪽, 적재는 소진 수요 중심으로
      const mu = muSigmaByProduct[pid]?.mu ?? 0;
      const L = Math.max(1, Number(leadTime));
      demandByProduct[pid] = Math.round(mu * L);
    });
    return greedyLoadPlan({
      capacity: Math.max(0, Number(capacity)),
      demandByProduct,
      currentByProduct,
    });
  }, [orderSuggestion, muSigmaByProduct, leadTime, capacity, currentByProduct]);

  const chartData = useMemo(() => {
    const labels = PRODUCTS.map((p) => p.name);
    const curr = PRODUCTS.map((p) => currentByProduct[p.id] || 0);
    const reco = PRODUCTS.map((p) => (loadPlan.load[p.id] || 0) + (currentByProduct[p.id] || 0));
    return {
      labels,
      datasets: [
        { label: "현재 적재", data: curr, backgroundColor: "#94a3b8" },
        { label: "추천 적재(현재+추가)", data: reco, backgroundColor: "#22c55e" },
      ],
    };
  }, [currentByProduct, loadPlan.load]);

  const modelBadge = useMemo(() => {
    const freq = {};
    rows.forEach((r) => {
      const m = r?.details?.model || "rule";
      freq[m] = (freq[m] || 0) + 1;
    });
    const best = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : "rule";
  }, [rows]);

  // 테이블 데이터: 제품별 요약
  const tableRows = useMemo(() => {
    return PRODUCTS.map((p) => {
      const pid = p.id;
      const curr = currentByProduct[pid] || 0;
      const target = targets[pid] || 0;
      const order = Math.max(0, target - curr);
      const toLoad = loadPlan.load[pid] || 0;
      const meta = PRODUCTS_META[pid] || {};
      const mu = muSigmaByProduct[pid]?.mu ?? 0;
      const sigma = muSigmaByProduct[pid]?.sigma ?? 0;
      return {
        pid,
        name: p.name,
        mu: Math.round(mu),
        sigma: Math.round(sigma),
        current: curr,
        target,
        order,
        add_load: toLoad,
        volume: meta.unit_volume ?? 1,
        price: meta.price ?? 0,
      };
    }).sort((a, b) => (b.order || 0) - (a.order || 0));
  }, [currentByProduct, targets, muSigmaByProduct, loadPlan.load]);

  const totalVolume = useMemo(
    () => tableRows.reduce((s, r) => s + r.add_load * r.volume, 0),
    [tableRows]
  );

  const avoidedStockoutRevenue = useMemo(() => loadPlan.expectedRevenue || 0, [loadPlan]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <div className="card-title">🤖 AI 재고 최적화 (서비스레벨 기반 + 그리디 적재)</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <select className="input" value={serviceLevel} onChange={(e) => setServiceLevel(Number(e.target.value))} style={{ width: 150 }}>
            <option value={0.90}>서비스레벨 90%</option>
            <option value={0.95}>서비스레벨 95%</option>
            <option value={0.975}>서비스레벨 97.5%</option>
            <option value={0.99}>서비스레벨 99%</option>
          </select>
          <input className="input" type="number" min={1} value={leadTime} onChange={(e) => setLeadTime(e.target.value)} style={{ width: 140 }} placeholder="리드타임(일)" />
          <input className="input" type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} style={{ width: 160 }} placeholder="차량 용적" />
          <button className="button" onClick={loadForecast} disabled={loading}>{loading ? "계산 중..." : "🔁 다시 계산"}</button>
          <span className="pill">모델: {modelBadge}</span>
        </div>
      </div>

      {error && <div className="alert alert-warning" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 18 }}>
        {/* 표: 제품별 상세 */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-title">📦 제품별 목표·추천</div>
          <div style={{ overflowX: "auto" }}>
            <table className="table-plain fixed">
              <thead>
                <tr>
                  <th>제품</th>
                  <th>μ</th>
                  <th>σ</th>
                  <th>현재</th>
                  <th>목표</th>
                  <th>추천 발주</th>
                  <th>추가 적재</th>
                  <th>단위용적</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => (
                  <tr key={r.pid}>
                    <td className="nowrap">{r.name}</td>
                    <td>{r.mu}</td>
                    <td>{r.sigma}</td>
                    <td>{r.current}</td>
                    <td>{r.target}</td>
                    <td>{r.order}</td>
                    <td>{r.add_load}</td>
                    <td>{r.volume}</td>
                  </tr>
                ))}
                {!tableRows.length && (
                  <tr><td colSpan={8} style={{ textAlign: "center" }}>데이터 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 차트 + 요약 */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-title">📊 현재 vs 추천 적재</div>
          <div style={{ height: 260 }}>
            <Bar data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "top" } } }} />
          </div>
          <div style={{ marginTop: 12, color: "#334155" }}>
            <div>🚚 사용 용적: <b>{totalVolume}</b> / {capacity}</div>
            <div>💰 예상 매출 증가(품절 방지): <b>{avoidedStockoutRevenue.toLocaleString()}원</b></div>
            <div>🔐 파라미터: 서비스레벨 <b>{Math.round(serviceLevel * 100)}%</b>, 리드타임 <b>{leadTime}일</b></div>
            <div>🧠 사용 모델: <b>{modelBadge}</b> (수요 ML 예측 μ±σ → 안전재고·목표재고 → 용적 그리디 최적화)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
