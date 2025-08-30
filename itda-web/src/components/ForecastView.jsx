// src/components/ForecastView.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { postJSON } from "../api";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const VILLAGES = [{ id:1, name:"행복마을" }, { id:2, name:"평화마을" }, { id:3, name:"소망마을" }];
const PRODUCTS = [{ id:101, name:"두부" }, { id:102, name:"계란" }, { id:103, name:"채소" }];

function nextDateISO(n=1) {
  const d = new Date();
  d.setDate(d.getDate()+n);
  return d.toISOString().slice(0,10);
}

export default function ForecastView() {
  const [date, setDate] = useState(nextDateISO(1));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const reqRef = useRef(null); // AbortController 보관

  const fetchForecast = async () => {
    // 이전 요청이 진행 중이면 취소
    if (reqRef.current) { try { reqRef.current.abort(); } catch {} }
    const ac = new AbortController();
    reqRef.current = ac;

    setLoading(true); setError(""); setRows([]);
    try {
      const res = await postJSON("/demand/forecast", {
        date,
        villages: VILLAGES.map(v=>v.id),
        products: PRODUCTS.map(p=>p.id),
      });
      if (ac.signal.aborted) return;
      setRows(res.results || []);
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e.message || "예측 로드 실패");
    } finally {
      if (!ac.signal.aborted) setLoading(false);
      reqRef.current = null;
    }
  };

  useEffect(()=>{ fetchForecast(); /* mount 때 1회 */ }, []);

  const top3Overall = useMemo(()=>{
    const arr = [...rows].sort((a,b)=> (b.qty||0)-(a.qty||0)).slice(0,3);
    return arr.map(r=>{
      const v = VILLAGES.find(x=>x.id===r.village_id)?.name || `마을#${r.village_id}`;
      const p = PRODUCTS.find(x=>x.id===r.product_id)?.name || `상품#${r.product_id}`;
      return { ...r, vname:v, pname:p };
    });
  },[rows]);

  const byVillage = useMemo(()=>{
    const m = new Map();
    rows.forEach(r=>{
      const key = r.village_id;
      if(!m.has(key)) m.set(key, []);
      m.get(key).push(r);
    });
    for (const [k, arr] of m) {
      arr.sort((a,b)=>(b.qty||0)-(a.qty||0));
      m.set(k, arr.slice(0,3));
    }
    return m;
  },[rows]);

  const barData = useMemo(()=>{
    const sums = PRODUCTS.map(p=>{
      const total = rows.filter(r=>r.product_id===p.id).reduce((acc,r)=>acc+(r.qty||0),0);
      return { name:p.name, total };
    });
    return {
      labels: sums.map(s=>s.name),
      datasets: [{ label: `예측 총 수요 (${date})`, data: sums.map(s=>s.total) }]
    };
  },[rows, date]);

  const modelBadge = useMemo(()=>{
    const freq = {};
    rows.forEach(r=>{
      const m = r?.details?.model || "rule";
      freq[m] = (freq[m]||0)+1;
    });
    const best = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0];
    return best ? best[0] : "rule";
  },[rows]);

  return (
    <div style={{ display:"grid", gap:20 }}>
      <div className="card">
        <div className="card-header" style={{gap:12}}>
          <div className="card-title">🧠 수요 예측(ML) — Top3</div>
          <div style={{display:"flex", gap:8, alignItems:"center"}}>
            <input type="date" className="input" value={date} onChange={e=>setDate(e.target.value)} />
            <button className="button" onClick={fetchForecast} disabled={loading}>
              {loading ? "예측 중..." : "🔮 예측 실행"}
            </button>
            <span className="pill">모델: {modelBadge}</span>
          </div>
        </div>

        {error && <div className="alert alert-warning">{error}</div>}

        <div style={{ display:"grid", gridTemplateColumns:"1.2fr 1fr", gap:18 }}>
          <div className="card" style={{margin:0}}>
            <div className="card-title">🔥 전체 Top 3 (마을·상품)</div>
            <table className="table-plain">
              <thead>
                <tr><th>순위</th><th>마을</th><th>상품</th><th>예측수요</th><th>신뢰구간</th></tr>
              </thead>
              <tbody>
                {top3Overall.map((r,i)=>(
                  <tr key={i}>
                    <td>{i+1}</td>
                    <td>{r.vname}</td>
                    <td>{r.pname}</td>
                    <td>{r.qty}</td>
                    <td>{r.conf_low} ~ {r.conf_high}</td>
                  </tr>
                ))}
                {!top3Overall.length && <tr><td colSpan={5} style={{textAlign:"center"}}>데이터 없음</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card" style={{margin:0}}>
            <div className="card-title">📦 상품별 총 예측 (모든 마을 합)</div>
            <div style={{height:260}}>
              <Bar data={barData} options={{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:"top"}} }} />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">🏘️ 마을별 Top 3</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:18 }}>
          {Array.from(byVillage.entries()).map(([vid, arr])=>{
            const vname = VILLAGES.find(v=>v.id===vid)?.name || `마을#${vid}`;
            return (
              <div className="card" key={vid} style={{margin:0}}>
                <div className="card-title">{vname}</div>
                <table className="table-plain">
                  <thead>
                    <tr><th>순위</th><th>상품</th><th>예측</th><th>±</th></tr>
                  </thead>
                  <tbody>
                    {(arr||[]).map((r,i)=>{
                      const pname = PRODUCTS.find(p=>p.id===r.product_id)?.name || `#${r.product_id}`;
                      const spread = Math.round(((r.conf_high - r.conf_low)/2));
                      return (
                        <tr key={i}>
                          <td>{i+1}</td>
                          <td>{pname}</td>
                          <td>{r.qty}</td>
                          <td>±{spread}</td>
                        </tr>
                      );
                    })}
                    {(!arr || !arr.length) && <tr><td colSpan={4} style={{textAlign:"center"}}>데이터 없음</td></tr>}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  );
}
