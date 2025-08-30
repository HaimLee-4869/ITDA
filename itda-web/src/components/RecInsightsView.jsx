// src/components/RecInsightsView.jsx
import { useEffect, useMemo, useState } from "react";
import { getJSON } from "../api";

/**
 * 마을별 선호/계절 추천 AI (데모 데이터 내장, API 있으면 자동 사용)
 * - 과거 판매(마을/상품) + 고객 태그(돌봄 태그) + 계절 가중치로 점수 계산
 * - 현재 시즌 추천 리스트, 계절별 Top, 태그 프로필 표시
 */
export default function RecInsightsView() {
  const [villageId, setVillageId] = useState(1);
  const [secondVillageId, setSecondVillageId] = useState(""); // 선택 시 간단 비교
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // 분석 결과
  const [result, setResult] = useState(null);

  // ===== 유틸 =====
  const today = useMemo(() => new Date(), []);
  const yyyyMmDd = (d) => d.toISOString().slice(0, 10);
  useEffect(() => {
    // 기본 기간: 최근 60일
    const to = new Date(today);
    const from = new Date(today);
    from.setDate(from.getDate() - 60);
    setDateFrom(yyyyMmDd(from));
    setDateTo(yyyyMmDd(to));
  }, [today]);

  const seasonOf = (date) => {
    const m = (date ? new Date(date) : new Date()).getMonth() + 1;
    if ([3,4,5].includes(m)) return "spring";
    if ([6,7,8].includes(m)) return "summer";
    if ([9,10,11].includes(m)) return "autumn";
    return "winter";
  };
  const seasonLabel = { spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" };

  // ===== 계절 가중치 (상품명/카테고리 추정 기반) =====
  const seasonalWeights = {
    spring: { "두부": 1.15, "나물": 1.2, "채소": 1.1, "생선": 1.05 },
    summer: { "수박": 1.35, "참외": 1.25, "아이스크림": 1.3, "냉면": 1.2, "우유": 1.1, "과일": 1.15 },
    autumn: { "고구마": 1.3, "사과": 1.25, "배추": 1.15, "과일": 1.1, "떡": 1.1 },
    winter: { "김치": 1.3, "라면": 1.2, "죽": 1.25, "탕": 1.2, "수프": 1.15, "우유": 1.1 }
  };
  const weightFor = (name, season) => {
    const table = seasonalWeights[season] || {};
    // 이름에 해당 키워드가 포함되면 가중
    for (const key of Object.keys(table)) {
      if (name.includes(key)) return table[key];
    }
    // 기본 1.0
    return 1.0;
  };

  // ===== 태그 → 상품 가중치 =====
  // (돌봄/건강 태그 비중을 보고 특정 상품/군 가중)
  const tagBoostMap = {
    "고혈압": { includes: ["두부","생선","과일","저염","나물"], boost: 0.15 },
    "당뇨":   { includes: ["저당","두부","생선","과일"], boost: 0.18 },
    "치아":   { includes: ["우유","죽","두부","빵"], boost: 0.12 },
    "저염식": { includes: ["저염","두부","생선","나물"], boost: 0.15 },
  };
  const tagBoostFor = (productName, tagStats) => {
    let boost = 0;
    Object.entries(tagBoostMap).forEach(([tag, conf]) => {
      const share = (tagStats[tag] || 0); // 0~1
      const hit = conf.includes.some((k) => productName.includes(k));
      if (hit) boost += conf.boost * share; // 태그 점유율을 반영
    });
    return boost; // 0~(0.3 내외)
  };

  // ===== API or Demo =====
  // 기대 스키마:
  // - analytics.by_village_products: [{village_id, village_name, product_id, product_name, qty}, ...]
  // - care/customers?village_id=: [{tags:[...]}]
  async function fetchAnalyticsOrDemo(vId, from, to) {
    try {
      // 1) 백엔드가 이 엔드포인트를 제공한다면 사용
      const rich = await getJSON(`/analytics/by_village_products?from=${from}&to=${to}`).catch(() => null);
      const customers = await getJSON(`/care/customers?village_id=${vId}`).catch(() => ({ customers: [] }));
      if (rich && Array.isArray(rich.rows)) {
        return { mode: "api", rows: rich.rows, customers: customers.customers || [] };
      }
    } catch (_) {}
    // 2) 폴백: 데모 데이터
    const demo = makeDemoData();
    const customers = demo.customers.filter((c) => c.village_id === vId);
    const rows = demo.sales.filter((r) => r.date >= from && r.date <= to);
    return { mode: "demo", rows, customers };
  }

  // 데모 데이터 생성기(안정적, 고정)
  function makeDemoData() {
    const villages = [
      { id: 1, name: "행복마을" },
      { id: 2, name: "평화마을" },
      { id: 3, name: "소망마을" },
    ];
    const products = [
      { id: 101, name: "두부" }, { id: 102, name: "우유" }, { id: 103, name: "사과" },
      { id: 104, name: "수박" }, { id: 105, name: "라면" }, { id: 106, name: "김치" },
      { id: 107, name: "생선" }, { id: 108, name: "떡" }, { id: 109, name: "저당빵" }, { id: 110, name: "나물무침" },
    ];
    // 월별 기본 수요(마을별 미묘한 차)
    const baseVillageBias = { 1: 1.0, 2: 0.95, 3: 0.9 };
    const sales = [];
    const months = [...Array(12)].map((_, i) => i + 1);
    for (const v of villages) {
      for (const m of months) {
        const season = seasonOf(`2025-${String(m).padStart(2, "0")}-01`);
        for (const p of products) {
          const base =
            (10 +
              (p.id % 7)) * // 상품 기본
            baseVillageBias[v.id] *
            weightFor(p.name, season);
          // 데모 흔들림
          const jitter = ((v.id * 13 + p.id * 7 + m * 3) % 8) / 10; // 0~0.7
          const qty = Math.round(base * (1.0 + jitter));
          const date = `2025-${String(m).padStart(2, "0")}-15`;
          sales.push({
            village_id: v.id,
            village_name: v.name,
            product_id: p.id,
            product_name: p.name,
            qty,
            date,
          });
        }
      }
    }
    // 고객(태그) 데모
    const customers = [
      // 행복마을 - 고혈압/저염 많음
      ...[...Array(40)].map((_, i) => ({ id: i+1, name: `행복#${i+1}`, village_id: 1, tags: i%3===0?["고혈압","저염식"]:i%5===0?["치아"]:[]
      })),
      // 평화마을 - 당뇨/치아
      ...[...Array(35)].map((_, i) => ({ id: 100+i, name: `평화#${i+1}`, village_id: 2, tags: i%4===0?["당뇨"]:i%6===0?["치아"]:[] })),
      // 소망마을 - 태그 적음
      ...[...Array(28)].map((_, i) => ({ id: 200+i, name: `소망#${i+1}`, village_id: 3, tags: i%7===0?["고혈압"]:[] })),
    ];
    return { villages, products, sales, customers };
  }

  // 태그 분포(0~1)
  function makeTagStats(customers) {
    const counts = {};
    let total = 0;
    customers.forEach((c) => (c.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; total += 1; }));
    const stats = {};
    Object.keys(counts).forEach((k) => { stats[k] = total ? counts[k] / total : 0; });
    return stats;
  }

  // 추천 계산
  async function run() {
    try {
      setLoading(true);
      setErr("");
      const { rows, customers } = await fetchAnalyticsOrDemo(villageId, dateFrom, dateTo);
      const tagStats = makeTagStats(customers);

      const season = seasonOf(dateTo || new Date());
      // 마을 필터
      const filtered = rows.filter((r) => r.village_id === Number(villageId));
      // 상품별 집계
      const map = {};
      filtered.forEach((r) => {
        const key = r.product_id;
        map[key] = map[key] || { product_id: r.product_id, product_name: r.product_name, past_qty: 0 };
        map[key].past_qty += Number(r.qty || 0);
      });

      // 점수/추천수량 계산
      const items = Object.values(map).map((it) => {
        const seasonal = weightFor(it.product_name, season);
        const tagBoost = tagBoostFor(it.product_name, tagStats); // 0~0.3
        const score = it.past_qty * seasonal * (1 + tagBoost);
        // 추천 수량(다음 방문 40~60개 가정, 점수 비중으로 분배)
        return { ...it, seasonal, tagBoost, score };
      });
      const totalScore = items.reduce((a,b)=>a+b.score,0) || 1;
      const visitTarget = 50; // 데모: 다음 방문 준비수량
      const rec = items
        .map((it) => ({
          ...it,
          rec_qty: Math.max(1, Math.round((it.score / totalScore) * visitTarget)),
          reasons: reasonChips(it, season, tagStats),
        }))
        .sort((a,b)=>b.score-a.score)
        .slice(0, 10);

      // 계절별 Top(간단히 동일 집계에서 시즌만 바꿔 시뮬레이션)
      const seasonalTops = ["spring","summer","autumn","winter"].map((s) => {
        const sims = Object.values(map).map((it) => {
          const sc = it.past_qty * weightFor(it.product_name, s) * (1 + tagBoostFor(it.product_name, tagStats));
          return { name: it.product_name, score: sc };
        }).sort((a,b)=>b.score-a.score).slice(0,5);
        return { season: s, items: sims };
      });

      // 비교(선택된 경우)
      let compare = null;
      if (secondVillageId) {
        const { rows: rows2 } = await fetchAnalyticsOrDemo(Number(secondVillageId), dateFrom, dateTo);
        const filtered2 = rows2.filter((r) => r.village_id === Number(secondVillageId));
        const m2 = {};
        filtered2.forEach((r) => {
          const k = r.product_id;
          m2[k] = (m2[k] || 0) + Number(r.qty || 0);
        });
        // 공통 상품만 비교
        const diffs = Object.values(map).map((i) => ({
          product_id: i.product_id,
          product_name: i.product_name,
          a: i.past_qty,
          b: m2[i.product_id] || 0,
          gap: (i.past_qty - (m2[i.product_id] || 0)),
        })).sort((x,y)=>Math.abs(y.gap)-Math.abs(x.gap)).slice(0,8);
        compare = diffs;
      }

      setResult({
        season, seasonLabel: seasonLabel[season],
        tagStats, rec, seasonalTops, compare,
      });
    } catch (e) {
      setErr(e.message || "추천 생성 중 오류가 발생했어요.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function reasonChips(it, season, tagStats) {
    const chips = [];
    if (it.past_qty > 0) chips.push(`최근 ${it.past_qty}개 판매`);
    const w = weightFor(it.product_name, season);
    if (w > 1.05) chips.push(`${seasonLabel[season]} 시즌 가중 ${Math.round((w-1)*100)}%`);
    const tb = tagBoostFor(it.product_name, tagStats);
    if (tb > 0.05) chips.push(`태그 가중 +${Math.round(tb*100)}%`);
    return chips;
  }

  // ===== 초기 한 번 실행 =====
  useEffect(() => { if (dateFrom && dateTo) run(); /* eslint-disable-next-line */ }, [villageId, dateFrom, dateTo]);

  return (
    <div className="card">
      <div className="card-header" style={{ flexWrap: "wrap" }}>
        <div className="card-title">🧭 마을별 선호 · 계절 추천 AI</div>
        <div style={{ color: "#64748b" }}>
          과거 판매 + 고객 태그 + 계절 가중치를 조합해, <b>지금</b> 준비하면 좋은 상품/수량을 추천합니다.
        </div>
      </div>

      {/* 컨트롤 */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div>
          <div className="label-sm">마을 선택</div>
          <select className="input" value={villageId} onChange={(e)=>setVillageId(Number(e.target.value))}>
            <option value={1}>행복마을 (#1)</option>
            <option value={2}>평화마을 (#2)</option>
            <option value={3}>소망마을 (#3)</option>
          </select>
        </div>
        <div>
          <div className="label-sm">기간 시작</div>
          <input type="date" className="input" value={dateFrom} onChange={(e)=>setDateFrom(e.target.value)} />
        </div>
        <div>
          <div className="label-sm">기간 종료</div>
          <input type="date" className="input" value={dateTo} onChange={(e)=>setDateTo(e.target.value)} />
        </div>
        <div>
          <div className="label-sm">비교 마을(선택)</div>
          <select className="input" value={secondVillageId} onChange={(e)=>setSecondVillageId(e.target.value)}>
            <option value="">— 선택 안 함 —</option>
            <option value="1">행복마을 (#1)</option>
            <option value="2">평화마을 (#2)</option>
            <option value="3">소망마을 (#3)</option>
          </select>
        </div>

        <div style={{ alignSelf: "end" }}>
          <button className="button" onClick={run} disabled={loading}>
            {loading ? "분석 중..." : "🧠 AI 추천 생성"}
          </button>
        </div>
      </div>

      {err && <div className="alert alert-warning" style={{ marginTop: 12 }}>{err}</div>}

      {!result ? (
        <div className="chart-placeholder" style={{ marginTop: 12 }}>추천을 생성하는 중입니다…</div>
      ) : (
        <>
          {/* 추천 리스트 */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">
              <div className="card-title">🎯 현재 시즌 추천 — {result.seasonLabel}</div>
              <small style={{ color: "#64748b" }}>
                근거: 최근 판매량, {result.seasonLabel} 가중, 태그 가중(고혈압/당뇨/치아/저염식)
              </small>
            </div>

            <div className="table-like">
              <div className="table-header">
                <div>상품</div>
                <div>근거(설명)</div>
                <div>예상 수요지수</div>
                <div>추천 수량</div>
              </div>
              {result.rec.map((r, i) => (
                <div className="table-row" key={i}>
                  <div className="rank-stack">
                    <span className="rank-chip" style={{ background: i<3?"#22c55e":"#60a5fa" }}>{i+1}</span>
                    <div>
                      <div className="village-cell">
                        <div className="village-name">{r.product_name}</div>
                        <div className="village-sub">시즌 가중 ×{r.seasonal.toFixed(2)} · 태그가중 +{Math.round(r.tagBoost*100)}%</div>
                      </div>
                    </div>
                  </div>
                  <div className="nowrap">
                    {(r.reasons || []).map((t,idx)=>(
                      <span key={idx} className="tag" style={{ marginRight: 6 }}>{t}</span>
                    ))}
                  </div>
                  <div className="pred-wrap">
                    <div className="pred-bar"><div className="pred-fill" style={{ width: `${Math.min(100, Math.round((r.score/result.rec[0].score)*100))}%`, background: "#22c55e" }} /></div>
                    <div className="pred-badge">{Math.round(r.score)}</div>
                  </div>
                  <div className="td-right"><b>{r.rec_qty}</b> 개</div>
                </div>
              ))}
            </div>
          </div>

          {/* 계절별 변화 */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header"><div className="card-title">🍃 계절별로 잘 팔리는 품목 변화</div></div>
            <div className="stats-grid">
              {result.seasonalTops.map((s)=>(
                <div key={s.season} className="card" style={{ margin: 0 }}>
                  <div className="card-title">{seasonLabel[s.season]}</div>
                  <ul className="note-list">
                    {s.items.map((it, idx)=>(
                      <li key={idx} className="note-item">
                        <b>{idx+1}. {it.name}</b>
                        <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, Math.round((it.score/s.items[0].score)*100))}%` }} /></div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* 태그 프로필 & 비교 */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">
              <div className="card-title">👤 태그 분포 / 마을 비교</div>
            </div>

            <div className="stats-grid">
              <div className="card" style={{ margin: 0 }}>
                <div className="card-title">돌봄/건강 태그 분포</div>
                <ul className="note-list">
                  {["고혈압","당뇨","치아","저염식"].map((t)=>(
                    <li key={t} className="note-item">
                      {t} <span className="score-pill">{Math.round((result.tagStats[t]||0)*100)}%</span>
                      <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.round((result.tagStats[t]||0)*100)}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="card" style={{ margin: 0 }}>
                <div className="card-title">마을 간 수요 차이(상위)</div>
                {!result.compare ? (
                  <div style={{ color: "#64748b" }}>우측 상단에서 비교 마을을 선택하면 차이를 보여줍니다.</div>
                ) : (
                  <table className="table-plain">
                    <thead>
                      <tr><th>상품</th><th>선택 마을</th><th>비교 마을</th><th>격차</th></tr>
                    </thead>
                    <tbody>
                      {result.compare.map((d,i)=>(
                        <tr key={i}>
                          <td className="nowrap">{d.product_name}</td>
                          <td>{d.a}</td>
                          <td>{d.b}</td>
                          <td><b style={{ color: d.gap>=0?"#16a34a":"#ef4444" }}>{d.gap>=0?"+":""}{d.gap}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
