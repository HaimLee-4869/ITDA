// src/components/DemandForecastView.jsx
import { useEffect, useMemo, useState } from "react";
import { getJSON, postJSON } from "../api";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const fmtDateInput = (d) => d.toISOString().slice(0, 10);
const KR = (n) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(n ?? 0);
const i32 = (x) => (Number.isFinite(+x) ? +x : undefined);

// 데모/학습셋 이름→ID 정규화(백엔드 기준)
const DEMO_PID_BY_NAME = new Map([
  ["두부", 101],
  ["계란", 102],
  ["채소", 103],
]);

export default function DemandForecastView() {
  const [date, setDate] = useState(fmtDateInput(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [modelName, setModelName] = useState("ensemble(rf+hgb+xgb)");
  const [sentVillages, setSentVillages] = useState([]); // 디버그용
  const [sentProducts, setSentProducts] = useState([]); // 디버그용

  // 예측 결과
  const [items, setItems] = useState([]);

  // 후보 세팅
  const [villages, setVillages] = useState([1, 2, 3]);
  const [productIds, setProductIds] = useState([101, 102, 103]);
  const [prodMap, setProdMap] = useState(new Map()); // id -> name

  // ---------- 초기 로딩(마을, 상품 매핑/보정) ----------
  useEffect(() => {
    getJSON("/care/customers").then((res) => {
      const vs = Array.from(
        new Set((res?.customers || []).map((c) => i32(c.village_id)).filter(Boolean))
      ).sort((a, b) => a - b);
      if (vs.length) setVillages(vs);
    }).catch(() => {});

    getJSON("/inventory/vehicle/1").then((res) => {
      const idToName = new Map();
      const ids = new Set();
      for (const it of res?.items || []) {
        const id = i32(it.product_id);
        const name = (it.name || "").trim();
        if (!id && name) {
          // 이름만 있을 때 데모 매핑 적용
          const demoId = DEMO_PID_BY_NAME.get(name);
          if (demoId) {
            idToName.set(demoId, name);
            ids.add(demoId);
          }
          continue;
        }
        if (id) {
          // 재고 ID가 11/12라도 이름이 데모 이름이면 101/102로 치환
          const demoId = DEMO_PID_BY_NAME.get(name);
          if (demoId) {
            idToName.set(demoId, name);
            ids.add(demoId);
          } else {
            idToName.set(id, name || `#${id}`);
            ids.add(id);
          }
        }
      }
      if (ids.size) {
        setProdMap(idToName);
        setProductIds(Array.from(ids.values()));
      }
    }).catch(() => {});
  }, []);

  // ---------- 예측 실행 ----------
  const runForecast = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = {
        date,
        villages,              // int[]
        products: productIds,  // int[]  ← 중요: 문자열 금지
      };
      console.log("[forecast] request", payload);
      setSentVillages(payload.villages);
      setSentProducts(payload.products);

      const res = await postJSON("/demand/forecast", payload);
      console.log("[forecast] response", res);

      // 응답 표준화
      const raw = Array.isArray(res?.items) ? res.items
                : Array.isArray(res?.predictions) ? res.predictions
                : Array.isArray(res?.results) ? res.results   // ✅ 여기 추가
                : Array.isArray(res) ? res
                : [];

      const norm = raw.map((r, idx) => {
        const vid = i32(r.village_id ?? r.village);
        const pid = i32(r.product_id ?? r.product);
        const pname =
          r.product_name ??
          (pid && prodMap.get(pid)) ??
          (typeof r.product === "string" ? r.product : undefined) ??
          (pid ? `#${pid}` : "-");

        return {
          key: `${vid || "?"}-${pid || "?"}-${idx}`,
          village_id: vid,
          village_name: r.village_name ?? (vid ? `마을 #${vid}` : "-"),
          product_id: pid,
          product: pname,
          yhat: Number(r.yhat ?? r.pred ?? r.qty ?? 0),
          yhat_lo: i32(r.yhat_lo ?? r.lo ?? r.lower),
          yhat_hi: i32(r.yhat_hi ?? r.hi ?? r.upper),
        };
      });

      setItems(norm);
      if (res?.model) setModelName(res.model);
    } catch (e) {
      console.error(e);
      setError(e.message || "예측 호출 중 오류가 발생했습니다.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  // ---------- 집계 ----------
  const overallTop3 = useMemo(() => {
    return items
      .slice()
      .sort((a, b) => (b.yhat || 0) - (a.yhat || 0))
      .slice(0, 3)
      .map((r) => ({
        ...r,
        conf:
          r.yhat_lo != null && r.yhat_hi != null
            ? `${KR(r.yhat_lo)} ~ ${KR(r.yhat_hi)}`
            : `±${Math.max(1, Math.round((Math.abs((r.yhat_hi ?? r.yhat) - (r.yhat_lo ?? r.yhat))) / 2) || 1)}`,
      }));
  }, [items]);

  const productTotals = useMemo(() => {
    const map = new Map();
    for (const r of items) {
      const key = r.product || (r.product_id ? `#${r.product_id}` : "-");
      map.set(key, (map.get(key) || 0) + (Number.isFinite(r.yhat) ? r.yhat : 0));
    }
    return Array.from(map.entries())
      .map(([product, total]) => ({ product, total: Math.round(total) }))
      .sort((a, b) => b.total - a.total);
  }, [items]);

  const byVillageTop3 = useMemo(() => {
    const g = new Map();
    for (const r of items) {
      const k = r.village_id || r.village_name || "?";
      if (!g.has(k)) g.set(k, { name: r.village_name || `마을 #${r.village_id ?? k}`, rows: [] });
      g.get(k).rows.push(r);
    }
    return Array.from(g.entries())
      .map(([id, v]) => ({
        village_id: Number(id) || 0,
        village_name: v.name,
        rows: v.rows
          .slice()
          .sort((a, b) => (b.yhat || 0) - (a.yhat || 0))
          .slice(0, 3)
          .map((r) => ({
            product: r.product,
            yhat: Math.round(r.yhat || 0),
            conf:
              r.yhat_lo != null && r.yhat_hi != null
                ? `±${Math.max(1, Math.round(((r.yhat_hi - r.yhat_lo) / 2) || 1))}`
                : "±1",
          })),
      }))
      .sort((a, b) => a.village_id - b.village_id);
  }, [items]);

  // ---------- 차트 ----------
  const productBar = useMemo(
    () => ({
      labels: productTotals.map((p) => p.product),
      datasets: [{ label: `예측 총 수요 (${date})`, data: productTotals.map((p) => p.total), backgroundColor: "#22c55e" }],
    }),
    [productTotals, date]
  );
  const chartOptions = { responsive: true, plugins: { legend: { position: "top" } }, maintainAspectRatio: false };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card">
        <div className="card-header" style={{ alignItems: "center", gap: 8 }}>
          <div className="card-title">🧠 수요 예측(ML) — Top3</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            <button className="button" onClick={runForecast} disabled={loading}>
              {loading ? "계산 중..." : "예측 실행"}
            </button>
            <span className="pill" style={{ background: "#eef2ff" }}>모델: {modelName}</span>
            {/* 디버그 뱃지(심사용) */}
            {!!sentVillages.length && (
              <span className="pill" title="요청에 포함된 마을 ID">{`v:${sentVillages.join(",")}`}</span>
            )}
            {!!sentProducts.length && (
              <span className="pill" title="요청에 포함된 상품 ID">{`p:${sentProducts.join(",")}`}</span>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="card" style={{ margin: 0 }}>
            <div className="card-title">🔥 전체 Top 3 (마을·상품)</div>
            <table className="table-plain fixed">
              <thead>
                <tr>
                  <th className="th-id">순위</th>
                  <th className="th-name">마을</th>
                  <th className="th-name">상품</th>
                  <th className="th-village">예측수요</th>
                  <th className="th-village">신뢰구간</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: "#94a3b8", textAlign: "center" }}>
                      예측을 먼저 실행해주세요.
                    </td>
                  </tr>
                ) : overallTop3.length ? (
                  overallTop3.map((r, i) => (
                    <tr key={r.key}>
                      <td>{i + 1}</td>
                      <td className="nowrap">{r.village_name}</td>
                      <td className="nowrap">{r.product}</td>
                      <td>{KR(r.yhat)}</td>
                      <td>{r.conf}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} style={{ color: "#94a3b8", textAlign: "center" }}>
                      (결과 0건) 선택한 상품/마을 ID를 확인하세요.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ margin: 0 }}>
            <div className="card-title">📦 상품별 총 예측 (모든 마을 합)</div>
            <div style={{ height: 260 }}>
              {productTotals.length ? (
                <Bar options={chartOptions} data={productBar} />
              ) : (
                <div className="chart-placeholder">예측 결과가 없습니다.</div>
              )}
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-title">🏘️ 마을별 Top 3</div>
          {!byVillageTop3.length ? (
            <div className="alert alert-info" style={{ marginTop: 6, marginBottom: 0 }}>
              예측을 실행하면 마을별 Top3가 표시됩니다.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
              {byVillageTop3.map((v) => (
                <div key={v.village_id} className="card" style={{ margin: 0 }}>
                  <div className="card-title">{v.village_name}</div>
                  <table className="table-plain fixed">
                    <thead>
                      <tr>
                        <th className="th-id">순위</th>
                        <th className="th-name">상품</th>
                        <th className="th-village">예측</th>
                        <th className="th-village">±</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(v.rows || []).map((r, i) => (
                        <tr key={`${v.village_id}-${r.product}-${i}`}>
                          <td>{i + 1}</td>
                          <td className="nowrap">{r.product}</td>
                          <td>{KR(r.yhat)}</td>
                          <td>{r.conf}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div className="alert alert-warning">{error}</div>}
      </div>
    </div>
  );
}
