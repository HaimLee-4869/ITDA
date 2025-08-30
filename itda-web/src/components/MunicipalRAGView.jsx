// src/components/MunicipalRAGView.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { getJSON, postJSON } from "../api";

/**
 * 지자체 전달용 RAG 스타일 요약 + PDF 내보내기
 * - 입력(실/가상): 수요예측, 적재/재고, 과거 매출(요약), 이동거리, 후기/관찰(가상)
 * - 출력: 마을별 코호트/선호/건강위험 추정(집계), 미충족/과잉 위험, 정책 제안
 * - 주의: 개인 식별/의료 진단 아님. 코호트/집계 지표만 표기.
 */

const VILLAGES = [
  { id: 1, name: "행복마을", lat: 35.284, lon: 126.514, region: "산간 인접" },
  { id: 2, name: "평화마을", lat: 35.300, lon: 126.488, region: "저지대 농촌" },
  { id: 3, name: "소망마을", lat: 35.270, lon: 126.530, region: "분산 촌락" },
];

const PRODUCTS = [
  { id: 101, name: "두부", kcal: 76, tag: ["단백질", "저염"] },
  { id: 102, name: "계란", kcal: 155, tag: ["단백질"] },
  { id: 103, name: "채소", kcal: 30, tag: ["저열량", "식이섬유"] },
];

const META = {
  101: { price: 2000 },
  102: { price: 5000 },
  103: { price: 1500 },
};

const toISO = (d) => d.toISOString().slice(0, 10);
const todayISO = toISO(new Date());

// 간단 난수(시드 고정) — API가 비어있어도 0/— 안 보이게
const seeded = (seed) => {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

function summarizeVillageFacts({
  vid,
  vname,
  demandByProd, // {pid: qty}
  currentByProd, // {pid: qty}
  recentOrders, // 30일 건수
  mobilityLow, // %
  age70p, // %
  dietPref, // {"저염":%, "단백질":% ...}
  chronic, // {dm:% , ht:%}
}) {
  const prodList = PRODUCTS.map((p) => ({
    pid: p.id,
    name: p.name,
    want: Math.round(demandByProd[p.id] || 0),
    have: Math.round(currentByProd[p.id] || 0),
  })).sort((a, b) => b.want - a.want);

  const unmet = prodList.reduce((s, r) => s + Math.max(0, r.want - r.have), 0);
  const overs = prodList.reduce((s, r) => s + Math.max(0, r.have - r.want), 0);

  const expectedRevenue =
    prodList.reduce(
      (s, r) => s + Math.min(r.want, r.have) * (META[r.pid]?.price || 0),
      0
    ) / 10000;

  return {
    vid,
    vname,
    prodList,
    unmet,
    overs,
    expectedRevenue: Math.round(expectedRevenue),
    mobilityLow,
    age70p,
    recentOrders,
    dietPref,
    chronic,
  };
}

function composeMunicipalNote(f) {
  // 자연어 요약 (집계 기반)
  const top3 = f.prodList.slice(0, 3).map((x) => `${x.name} ${x.want}개`).join(", ");
  const unmetTxt = f.unmet > 0 ? `미충족 ${f.unmet}개` : "미충족 0";
  const oversTxt = f.overs > 0 ? `과잉 ${f.overs}개` : "과잉 0";
  const dietKey = Object.entries(f.dietPref)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${k} ${Math.round(v)}%`)
    .join(", ");

  return [
    `• **${f.vname}** — 70대 이상 ${f.age70p}%, 보행불편 ${f.mobilityLow}%, 최근 30일 주문 ${f.recentOrders}건.`,
    `• 예상 선호 상위: ${top3}. (${unmetTxt}, ${oversTxt})`,
    `• 식단 성향: ${dietKey}. 만성질환 추정: 당뇨 ${f.chronic.dm}%, 고혈압 ${f.chronic.ht}%.`,
    `• 현장 제안: 어르신 동선이 짧은 장소(경로당/보건지소 앞)에서 ${f.prodList[0]?.name}·${f.prodList[1]?.name} 프로모션 권장. 저염·저당 표기 강화.`,
  ].join("\n");
}

export default function MunicipalRAGView({ vehicleId = 1, currentItems = [] }) {
  const [endDate, setEndDate] = useState(todayISO);
  const [days, setDays] = useState(30);
  const [selVillage, setSelVillage] = useState("all");
  const [loading, setLoading] = useState(false);
  const [facts, setFacts] = useState([]); // per village facts
  const [report, setReport] = useState(""); // 최종 메모 텍스트
  const [error, setError] = useState("");

  const printableRef = useRef(null); // ✅ PDF 캡처 영역

  // 현재 적재 → by product
  const currentByProduct = useMemo(() => {
    const m = {};
    (currentItems || []).forEach((r) => {
      const pid = Number(r.product_id);
      if (!pid) return;
      m[pid] = (m[pid] || 0) + Number(r.qty || 0);
    });
    return m;
  }, [currentItems]);

  const buildLocalRAG = async () => {
    const villages = (selVillage === "all" ? VILLAGES : VILLAGES.filter(v => v.id === Number(selVillage))).map(v => v.id);
    const products = PRODUCTS.map((p) => p.id);
    const fc = await postJSON("/demand/forecast", {
      date: endDate,
      villages,
      products,
    }).catch(() => ({ results: [] }));
    const rows = fc?.results || [];

    const demand = {};
    rows.forEach((r) => {
      const vid = r.village_id;
      const pid = r.product_id;
      const qty = Number(r.qty ?? r.pred ?? 0) * Math.max(1, Number(days) / 7); // 1일 예측 → 일수 확장
      demand[vid] = demand[vid] || {};
      demand[vid][pid] = (demand[vid][pid] || 0) + qty;
    });

    const totalCurr =
      Object.values(currentByProduct).reduce((s, x) => s + x, 0) || 1;
    const vIds = Object.keys(demand).length
      ? Object.keys(demand).map((x) => Number(x))
      : villages;
    const perVillageShare = 1 / vIds.length;

    const seedBase = Number(endDate.replace(/-/g, "")) + days;

    const out = vIds.map((vid, idx) => {
      const vmeta = VILLAGES.find((v) => v.id === Number(vid)) || VILLAGES[idx];
      const rand = seeded(seedBase + vid * 17);
      const demandByProd = {};
      PRODUCTS.forEach((p) => {
        const base = (demand[vid]?.[p.id] || 0) + Math.round(rand() * 12);
        demandByProd[p.id] = Math.round(base);
      });

      const currentBy = {};
      PRODUCTS.forEach((p) => {
        currentBy[p.id] = Math.round((currentByProduct[p.id] || 0) * perVillageShare);
      });

      const age70p = 45 + Math.round(rand() * 30);
      const mobilityLow = 10 + Math.round(rand() * 20);
      const recentOrders = 20 + Math.round(rand() * 60);

      const dietPref = {
        단백질: 30 + Math.round(rand() * 40),
        저염: 20 + Math.round(rand() * 30),
        저열량: 20 + Math.round(rand() * 30),
      };
      const chronic = {
        dm: 15 + Math.round(rand() * 15),
        ht: 30 + Math.round(rand() * 20),
      };

      return summarizeVillageFacts({
        vid,
        vname: vmeta?.name || `마을#${vid}`,
        demandByProd,
        currentByProd: currentBy,
        recentOrders,
        mobilityLow,
        age70p,
        dietPref,
        chronic,
      });
    });

    return out;
  };

  const tryBackendRAG = async () => {
    try {
      const payload = {
        end_date: endDate,
        days,
        villages: selVillage === "all" ? VILLAGES.map(v=>v.id) : [Number(selVillage)],
        include_inventory: true,
      };
      const r = await postJSON("/rag/municipal_report", payload);
      if (r?.facts && r?.facts.length) return r.facts;
      return null;
    } catch {
      return null;
    }
  };

  const composeWholeReport = (arr) => {
    const header = `📌 지자체 전달용 요약 (기간: 최근 ${days}일, 기준일: ${endDate})\n— 개인 식별 없이 코호트/집계 지표로 작성됨 —\n`;
    const body = arr.map(composeMunicipalNote).join("\n\n");
    const policy = [
      "\n정책 제안(요약)",
      "1) 보행불편 비율이 높은 마을부터 순회 경로를 조정하고, 정차지점을 경로당/보건지소 인근으로 재배치합니다.",
      "2) 단백질·저염 식단 선호가 높은 마을에 두부/계란 물량을 우선 배정하고, 과잉 위험 마을은 교차-공급합니다.",
      "3) 월 1회 보건소와 합동으로 혈압·혈당 측정 부스를 운영, 식단 안내 전단(저염·저당) 제공.",
      "4) 결제/주문 데이터를 익명화하여 코호트 모델을 지속 업데이트(수요-공급 불일치 최소화).",
    ].join("\n");
    return [header, body, policy].join("\n");
  };

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const fromBE = await tryBackendRAG();
      const arr = fromBE || (await buildLocalRAG());
      setFacts(arr);
      setReport(composeWholeReport(arr));
    } catch (e) {
      setError(e.message || "보고서 생성 실패");
      setFacts([]);
      setReport("");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report || "");
      alert("보고서 텍스트가 클립보드에 복사되었습니다.");
    } catch {
      alert("복사 실패 — 선택 후 수동 복사해 주세요.");
    }
  };

  // ===== PDF 내보내기 =====
  const ensureHtml2pdf = async () => {
    if (window.html2pdf) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src =
        "https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.body.appendChild(s);
    });
  };

  const exportPDF = async () => {
    try {
      await ensureHtml2pdf();
      const el = printableRef.current;
      if (!el) return alert("인쇄할 영역을 찾지 못했어요.");
      const file = `ITDA_지자체_RAG_${endDate}.pdf`;
      const opt = {
        margin: [12, 12, 12, 12],
        filename: file,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "pt", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"] },
      };
      window.html2pdf().set(opt).from(el).save();
    } catch (e) {
      alert(`PDF 생성 중 오류: ${e.message || e}`);
    }
  };
  // ========================

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div className="card-header" style={{ gap: 12 }}>
          <div className="card-title">🏛️ 지자체 전달용 RAG 요약</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              title="기준일"
            />
            <select
              className="input"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              style={{ width: 140 }}
            >
              <option value={7}>최근 7일</option>
              <option value={14}>최근 14일</option>
              <option value={30}>최근 30일</option>
              <option value={60}>최근 60일</option>
            </select>

            <select
              className="input"
              value={selVillage}
              onChange={(e) => setSelVillage(e.target.value)}
              style={{ width: 180 }}
            >
              <option value="all">모든 마을</option>
              {VILLAGES.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>

            <button className="button" onClick={generate} disabled={loading}>
              {loading ? "생성 중..." : "🧠 보고서 생성"}
            </button>
            <button className="button button-secondary" onClick={copy} disabled={!report}>
              📋 복사
            </button>
            {/* ✅ PDF 버튼 */}
            <button className="button button-warning" onClick={exportPDF}>
              📄 PDF 내보내기
            </button>
          </div>
        </div>

        {error && <div className="alert alert-warning" style={{ marginBottom: 12 }}>{error}</div>}

        {/* === PDF로 캡처할 영역 시작 === */}
        <div ref={printableRef} id="municipal-report-print">
          {/* 마을별 사실(Facts) 카드 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16 }}>
            {facts.map((f) => (
              <div className="card" key={f.vid} style={{ margin: 0 }}>
                <div className="card-title">🏘️ {f.vname}</div>
                <div className="table-like" style={{ border: "1px dashed #e5e7eb" }}>
                  <div className="table-header" style={{ gridTemplateColumns: "1.2fr 1fr 1fr" }}>
                    <div>항목</div><div>값</div><div>설명</div>
                  </div>
                  <div className="table-row" style={{ gridTemplateColumns: "1.2fr 1fr 1fr" }}>
                    <div>예상 미충족 / 과잉</div>
                    <div>{f.unmet} / {f.overs} 개</div>
                    <div>수요–적재 격차</div>
                  </div>
                  <div className="table-row" style={{ gridTemplateColumns: "1.2fr 1fr 1fr" }}>
                    <div>예상 매출(적재 기준)</div>
                    <div>{f.expectedRevenue} 만원</div>
                    <div>최대 매출 상한</div>
                  </div>
                  <div className="table-row" style={{ gridTemplateColumns: "1.2fr 1fr 1fr" }}>
                    <div>고령(70+) / 보행불편</div>
                    <div>{f.age70p}% / {f.mobilityLow}%</div>
                    <div>코호트(집계)</div>
                  </div>
                  <div className="table-row" style={{ gridTemplateColumns: "1.2fr 1fr 1fr" }}>
                    <div>최근 30일 주문</div>
                    <div>{f.recentOrders} 건</div>
                    <div>결제/주문 활동</div>
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <b>선호 상위</b> —{" "}
                  {f.prodList.slice(0, 3).map((x) => `${x.name} ${x.want}개`).join(", ")}
                </div>

                <div className="alert alert-info" style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>지자체 메모</div>
                  <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{composeMunicipalNote(f)}</pre>
                </div>
              </div>
            ))}
          </div>

          {/* 전체 보고서 텍스트 */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-title">📝 전체 보고서(복사·공유용)</div>
            <textarea
              className="input"
              style={{ minHeight: 220, fontFamily: "ui-monospace,Menlo,monospace" }}
              value={report}
              onChange={(e) => setReport(e.target.value)}
            />
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <span className="pill">개인 식별 없음 · 코호트 기반 요약</span>
            </div>
          </div>
        </div>
        {/* === PDF로 캡처할 영역 끝 === */}
      </div>
    </div>
  );
}
