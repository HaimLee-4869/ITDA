// src/components/VoiceAgent.jsx
import { useEffect, useRef, useState } from "react";
import { getJSON, postJSON } from "../api";

/**
 * 운전자용 음성 에이전트
 * - STT: Web Speech API (SpeechRecognition)
 * - TTS: speechSynthesis
 * - NLU: 경량 정규식/키워드 기반 인텐트 추출
 * - Tools: /route/optimize, /alerts/recent, /vehicles/list, /demand/forecast 등 호출
 * - 화면: 실시간 인식, 의도/슬롯, 행동 로그, 응답 음성/텍스트
 */

const hasSpeech =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

const say = (text) => {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {}
};

const nowKR = () =>
  new Date().toLocaleString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });

export default function VoiceAgent() {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [finalText, setFinalText] = useState("");
  const [intent, setIntent] = useState(null);
  const [slots, setSlots] = useState({});
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);

  const recRef = useRef(null);

  // === STT 세팅 ===
  useEffect(() => {
    if (!hasSpeech) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "ko-KR";
    rec.interimResults = true;
    rec.continuous = true;

    rec.onresult = (e) => {
      let interim = "";
      let fin = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) fin += t + " ";
        else interim += t + " ";
      }
      if (interim) setPartial(interim);
      if (fin) {
        const text = (fin || "").trim();
        setFinalText(text);
        setPartial("");
        runAgent(text);
      }
    };
    rec.onend = () => {
      setListening(false);
    };
    rec.onerror = () => {
      setListening(false);
    };

    recRef.current = rec;
  }, []);

  const start = () => {
    if (!hasSpeech || !recRef.current) return;
    setFinalText("");
    setIntent(null);
    setSlots({});
    setLogs((l) => [{ ts: nowKR(), type: "sys", msg: "듣기 시작" }, ...l]);
    setListening(true);
    recRef.current.start();
  };

  const stop = () => {
    if (!hasSpeech || !recRef.current) return;
    recRef.current.stop();
    setListening(false);
    setLogs((l) => [{ ts: nowKR(), type: "sys", msg: "듣기 종료" }, ...l]);
  };

  // === NLU: 의도/슬롯 추출(경량) ===
  const parseIntent = (utter) => {
    const u = (utter || "").replace(/\s+/g, "");
    // 경로
    if (/경로(계산|추천|최적화)/.test(u) || /(루트|route)/i.test(u))
      return { name: "route_optimize", slots: {} };
    if (/경로(요약|요약해|어때)/.test(u))
      return { name: "route_summary", slots: {} };
    // 알림
    if (/(알림|공지).*(읽|보여|요약)/.test(u))
      return { name: "alerts_read", slots: {} };
    // 시간/상태
    if (/(현재)?시간/.test(u)) return { name: "time_now", slots: {} };
    if (/(속도|배터리|위치)/.test(u))
      return { name: "vehicle_status", slots: {} };
    // 수요/재고
    if (/예측(실행|해|돌려)/.test(u))
      return { name: "demand_forecast", slots: {} };
    if (/(재고|적정|안전재고).*(추천|계산)/.test(u))
      return { name: "inventory_opt", slots: {} };

    return { name: "fallback", slots: {} };
  };

  // === Tools ===
  const tool_vehicle = async () => {
    const v = await getJSON("/vehicles/list");
    const first = v?.vehicles?.[0];
    return {
      speed: first?.speed_kmh ?? 0,
      batt: first?.battery ?? 0,
      lat: first?.lat,
      lon: first?.lon,
    };
  };

  const tool_alerts = async () => {
    const a = await getJSON("/alerts/recent");
    return a?.alerts ?? [];
  };

  const tool_forecast = async () => {
    const date = new Date().toISOString().slice(0, 10);
    const villages = [1, 2, 3];
    const products = [101, 102, 103];
    const r = await postJSON("/demand/forecast", { date, villages, products });
    return r?.results ?? [];
  };

  const tool_route = async () => {
    const date = new Date().toISOString().slice(0, 10);
    const veh = await getJSON("/vehicles/list").catch(() => ({}));
    const start = veh?.vehicles?.[0] || {};
    const start_lat = typeof start?.lat === "number" ? start.lat : 35.271;
    const start_lon = typeof start?.lon === "number" ? start.lon : 126.502;
    const villages = [
      { id: 1, lat: 35.284, lon: 126.514, priority: 1, service_min: 8 },
      { id: 2, lat: 35.3, lon: 126.488, priority: 1, service_min: 8 },
      { id: 3, lat: 35.27, lon: 126.53, priority: 1, service_min: 8 },
    ];
    const r = await postJSON("/route/optimize", {
      vehicle: { start_lat, start_lon, start_time: `${date}T09:00:00` },
      villages,
      objective: "weighted_distance_time",
      meta: { model: "voice-agent" },
    });
    return r;
  };

  const tool_inventory = async () => {
    // 간단 데모: 수요예측 기반 안전재고 제안(서비스레벨 95%, 리드타임 2일)
    const res = await tool_forecast();
    const perVillage = {};
    res.forEach((r) => {
      perVillage[r.village_id] = (perVillage[r.village_id] || 0) + (r.pred || 0);
    });
    // z=1.65, σ approx = pred의 15% 라고 가정
    const suggestions = Object.entries(perVillage).map(([v, d]) => {
      const mu = d;
      const sigma = mu * 0.15;
      const lt = 2;
      const z = 1.65;
      const s = Math.round(z * sigma * Math.sqrt(lt));
      const rop = Math.round(mu * lt + s);
      return { village_id: Number(v), daily_demand: mu, safety: s, reorder_point: rop };
    });
    return suggestions;
  };

  const log = (type, msg) =>
    setLogs((l) => [{ ts: nowKR(), type, msg }, ...l]);

  // === 에이전트 루프 ===
  const runAgent = async (utter) => {
    const { name, slots } = parseIntent(utter);
    setIntent(name);
    setSlots(slots);
    log("user", utter);

    setBusy(true);
    try {
      switch (name) {
        case "time_now": {
          const t = nowKR();
          say(`지금은 ${t} 입니다.`);
          log("agent", `현재 시간: ${t}`);
          break;
        }
        case "vehicle_status": {
          const v = await tool_vehicle();
          const msg = `현재 속도 ${Math.round(v.speed)}킬로, 배터리 ${v.batt}% 입니다.`;
          say(msg);
          log("tool", JSON.stringify(v));
          log("agent", msg);
          break;
        }
        case "alerts_read": {
          const a = await tool_alerts();
          if (!a.length) {
            say("새로운 알림이 없습니다.");
            log("agent", "새 알림 없음");
            break;
          }
          const top = a[0];
          say(`가장 최근 알림: ${top.title || "알림"} 입니다.`);
          log("tool", `alerts: ${a.length}건`);
          log("agent", `최근 알림: ${top.title || top.message || ""}`);
          break;
        }
        case "demand_forecast": {
          const r = await tool_forecast();
          log("tool", `forecast results: ${r.length}개`);
          // Top1 합산
          const byVillage = {};
          r.forEach((x) => (byVillage[x.village_id] = (byVillage[x.village_id] || 0) + (x.pred || 0)));
          const top = Object.entries(byVillage).sort((a, b) => b[1] - a[1])[0];
          if (top) {
            say(`예측 결과, 수요가 가장 높은 곳은 마을 ${top[0]} 입니다.`);
            log("agent", `Top 수요 마을: #${top[0]} (${Math.round(top[1])})`);
          } else {
            say("예측 결과를 가져오지 못했습니다.");
            log("agent", "예측 결과 없음");
          }
          break;
        }
        case "inventory_opt": {
          const s = await tool_inventory();
          log("tool", `inventory suggestions: ${JSON.stringify(s)}`);
          const msg = s.length
            ? `안전재고 기준으로 재주문점은 예를 들어 마을 ${s[0].village_id}에서 ${s[0].reorder_point} 개 수준입니다.`
            : "재고 제안 계산에 실패했습니다.";
          say(msg);
          log("agent", msg);
          break;
        }
        case "route_optimize": {
          const r = await tool_route();
          const n = r?.ordered_stops?.length || 0;
          const msg = n
            ? `최적 경로 계산 완료. 총 ${n}개 정류장을 방문합니다. 첫 번째는 마을 ${r.ordered_stops[0].id ?? r.ordered_stops[0].village_id} 입니다.`
            : "경로 계산에 실패했습니다.";
          log("tool", `route: ${JSON.stringify(r)}`);
          say(msg);
          log("agent", msg);
          break;
        }
        case "route_summary": {
          const r = await tool_route();
          const msg = r
            ? `총 거리 ${Math.round(r.total_distance_km)} 킬로미터, 예상 ${r.est_duration_min} 분입니다.`
            : "경로 요약에 실패했습니다.";
          log("tool", `route: ${JSON.stringify(r)}`);
          say(msg);
          log("agent", msg);
          break;
        }
        default: {
          const msg = "죄송해요, 이해하지 못했어요. ‘경로 계산해’, ‘알림 읽어줘’ 처럼 말씀해 주세요.";
          say(msg);
          log("agent", msg);
        }
      }
    } catch (e) {
      const msg = `요청 처리 중 오류가 발생했습니다: ${e.message || e}`;
      say("처리 중 오류가 발생했습니다.");
      log("error", msg);
    } finally {
      setBusy(false);
    }
  };

  // === UI ===
  return (
    <div className="card" id="voice-agent">
      <div className="card-header">
        <div className="card-title">🎙️ 음성 도우미 (Agent)</div>
        <div style={{ color: "#64748b", fontSize: 13 }}>
          인식(Web Speech) + 도구호출(Route/Forecast/Alerts) + TTS
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="button" onClick={listening ? stop : start} disabled={!hasSpeech || busy}>
          {listening ? "🛑 듣기 종료" : "🎤 듣기 시작"}
        </button>
        <button
          className="button ghost"
          onClick={() => {
            const sample = "경로 계산해";
            setFinalText(sample);
            runAgent(sample);
          }}
          disabled={busy}
        >
          ▶️ 테스트 읽기
        </button>
        {!hasSpeech && (
          <span className="pill" style={{ background: "#fee2e2", color: "#991b1b" }}>
            이 브라우저는 음성 인식을 지원하지 않아요
          </span>
        )}
      </div>

      <div className="table-like" style={{ marginTop: 12 }}>
        <div className="table-header" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>실시간 인식</div>
          <div>최종 문장</div>
          <div>의도 / 슬롯</div>
        </div>
        <div className="table-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>{partial || <span style={{ color: "#94a3b8" }}>…</span>}</div>
          <div>{finalText || <span style={{ color: "#94a3b8" }}>…</span>}</div>
          <div>
            {intent ? (
              <>
                <b>{intent}</b>{" "}
                <span className="pill tag-soft" style={{ marginLeft: 6 }}>
                  {Object.keys(slots).length ? JSON.stringify(slots) : "no-slots"}
                </span>
              </>
            ) : (
              <span style={{ color: "#94a3b8" }}>…</span>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title">⚙️ 에이전트 로그</div>
        <div
          style={{
            maxHeight: 220,
            overflow: "auto",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 13,
            background: "#f8fafc",
            borderRadius: 8,
            padding: 8,
          }}
        >
          {logs.length === 0 ? (
            <div style={{ color: "#9ca3af" }}>대화와 도구 호출 내역이 여기에 표시됩니다.</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <span style={{ color: "#64748b" }}>[{l.ts}]</span>{" "}
                <span
                  style={{
                    color:
                      l.type === "user"
                        ? "#111827"
                        : l.type === "agent"
                        ? "#065f46"
                        : l.type === "error"
                        ? "#991b1b"
                        : "#334155",
                    fontWeight: l.type === "user" ? 600 : 400,
                  }}
                >
                  {l.type.toUpperCase()}
                </span>{" "}
                — {l.msg}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
