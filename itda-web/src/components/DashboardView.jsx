// src/components/DashboardView.jsx
import { useState, useEffect } from "react";
import { getJSON, postJSON, patchJSON, delJSON } from "../api";

export default function DashboardView() {
  const [dashboardPage, setDashboardPage] = useState("overview");

  // ===== Alerts =====
  const [alerts, setAlerts] = useState([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [alertErr, setAlertErr] = useState("");

  const fetchAlerts = async () => {
    try {
      setLoadingAlerts(true);
      setAlertErr("");
      const data = await getJSON("/alerts/recent");
      setAlerts(data.alerts ?? []);
    } catch (e) {
      setAlertErr(e.message || "알림 조회 중 오류가 발생했어요.");
    } finally {
      setLoadingAlerts(false);
    }
  };

  const resolveAlert = async (id) => {
    try {
      await postJSON("/alerts/resolve", { id });
      await fetchAlerts();
    } catch (e) {
      alert(e.message || "알림 처리 중 오류가 발생했어요.");
    }
  };

  // ===== Vehicles (Overview & Vehicles 탭 공용) =====
  const [vehicles, setVehicles] = useState([]);
  const [vehLoading, setVehLoading] = useState(false);
  const [vehErr, setVehErr] = useState("");

  const loadVehicles = async () => {
    try {
      setVehLoading(true);
      setVehErr("");
      const data = await getJSON("/vehicles/list");
      setVehicles(data.vehicles || []);
    } catch (e) {
      setVehErr(e.message || "차량 현황 조회 중 오류가 발생했어요.");
    } finally {
      setVehLoading(false);
    }
  };

  // ===== Inventory =====
  const [vehicleId, setVehicleId] = useState(1);
  const [invItems, setInvItems] = useState([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invErr, setInvErr] = useState("");

  const loadInventory = async () => {
    try {
      setInvLoading(true);
      setInvErr("");
      const data = await getJSON(`/inventory/vehicle/${vehicleId}`);
      setInvItems(data.items ?? []);
    } catch (e) {
      setInvErr(e.message || "재고 조회 중 오류가 발생했어요.");
    } finally {
      setInvLoading(false);
    }
  };

  const addInvRow = () => {
    setInvItems((prev) => [...prev, { product_id: "", name: "", qty: 0 }]);
  };
  const removeInvRow = (idx) => {
    setInvItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveInventory = async () => {
    try {
      const payload = {
        items: invItems
          .map((it) => ({
            product_id: Number(it.product_id),
            name: (it.name || "").trim() || undefined,
            qty: Number(it.qty || 0),
          }))
          .filter((it) => Number.isFinite(it.product_id) && it.product_id > 0),
      };
      await postJSON(`/inventory/vehicle/${vehicleId}/set`, payload);
      alert("✅ 재고 저장 완료");
      await loadInventory();
    } catch (e) {
      alert(e.message || "재고 저장 중 오류가 발생했어요.");
    }
  };

  // ===== Customers =====
  const [custVillageId, setCustVillageId] = useState("");
  const [customers, setCustomers] = useState([]);
  const [custLoading, setCustLoading] = useState(false);
  const [custErr, setCustErr] = useState("");
  const [edit, setEdit] = useState(null); // {id?, name, village_id, tags, last_visit, tags_text}
  const [creating, setCreating] = useState(false);

  const loadCustomers = async () => {
    try {
      setCustLoading(true);
      setCustErr("");
      const q = custVillageId ? `?village_id=${custVillageId}` : "";
      const data = await getJSON(`/care/customers${q}`);
      setCustomers(data.customers ?? []);
    } catch (e) {
      setCustErr(e.message || "고객 조회 중 오류가 발생했어요.");
    } finally {
      setCustLoading(false);
    }
  };

  const startCreate = () => {
    setCreating(true);
    setEdit({
      name: "",
      village_id: 1,
      tags: [],
      last_visit: "",
      tags_text: "",
    });
  };

  const startEdit = (row) => {
    setCreating(false);
    setEdit({
      id: row.id,
      name: row.name,
      village_id: row.village_id,
      tags: row.tags ?? [],
      last_visit: row.last_visit || "",
      tags_text: (row.tags || []).join(", "),
    });
  };

  const cancelEdit = () => setEdit(null);

  const saveCustomer = async () => {
    try {
      const vId = Number(edit?.village_id);
      if (!edit?.name || !Number.isFinite(vId) || vId <= 0) {
        alert("이름과 마을 ID(양수)는 필수입니다.");
        return;
      }
      const parsedTags = (edit?.tags_text || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (creating) {
        await postJSON("/care/customer", {
          name: edit.name,
          village_id: vId,
          tags: parsedTags,
          last_visit: edit.last_visit || null,
        });
      } else {
        await patchJSON(`/care/customer/${edit.id}`, {
          name: edit.name,
          village_id: vId,
          tags: parsedTags,
          last_visit: edit.last_visit || null,
        });
      }
      alert("✅ 저장 완료");
      setEdit(null);
      await loadCustomers();
    } catch (e) {
      alert(e.message || "저장 중 오류가 발생했어요.");
    }
  };

  const deleteCustomer = async (row) => {
    if (!confirm(`정말 삭제할까요? (${row.name})`)) return;
    try {
      await delJSON(`/care/customer/${row.id}`);
      await loadCustomers();
    } catch (e) {
      alert(e.message || "삭제 중 오류가 발생했어요.");
    }
  };

  const markVisitNow = async (row) => {
    try {
      await postJSON(`/care/customer/${row.id}/visit`, {});
      await loadCustomers();
    } catch (e) {
      alert(e.message || "방문 처리 중 오류가 발생했어요.");
    }
  };

  // ===== 초기 로딩 =====
  useEffect(() => {
    fetchAlerts();
  }, []);

  // 개요/차량 탭 진입시 차량 상태 로드
  useEffect(() => {
    if (dashboardPage === "overview" || dashboardPage === "vehicles") {
      loadVehicles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardPage]);

  const NavItem = ({ id, icon, label }) => (
    <li
      className={`${dashboardPage === id ? "active" : ""}`}
      onClick={() => setDashboardPage(id)}
      style={{ listStyle: "none", cursor: "pointer" }}
    >
      {icon} {label}
    </li>
  );

  const generateReport = (type) => {
    alert(`📋 보고서 생성(데모): ${type}`);
  };

  // ====== UI ======
  return (
    <div className="dashboard-container">
      {/* Sidebar */}
      <div className="dashboard-sidebar">
        <h3>📊 잇다 관리자</h3>
        <ul>
          <NavItem id="overview" icon="🏠" label="대시보드" />
          <NavItem id="vehicles" icon="🚚" label="차량 관리" />
          <NavItem id="inventory" icon="📦" label="재고 관리" />
          <NavItem id="customers" icon="👥" label="고객 관리" />
          <NavItem id="alerts" icon="🚨" label="위기 알림" />
          <NavItem id="analytics" icon="📈" label="매출 분석" />
          <NavItem id="reports" icon="📋" label="보고서" />
          <NavItem id="settings" icon="⚙️" label="설정" />
        </ul>
      </div>

      {/* Main */}
      <div className="dashboard-main">
        <div className="dashboard-header">
          <h2 id="dashboard-title">실시간 운영 현황</h2>
          <div>
            <span>📅 2025.08.06 (수) 09:30</span>
            <button
              className="button"
              style={{ marginLeft: 15 }}
              onClick={() => generateReport("quick")}
            >
              📊 리포트 생성
            </button>
          </div>
        </div>

        <div className="dashboard-content">
          {/* === 개요 === */}
          {dashboardPage === "overview" && (
            <div className="dashboard-page active">
              <div className="stats-grid">
                {[
                  ["3", "운행 중인 차량"],
                  ["₩1.2M", "오늘 총 매출"],
                  ["47", "방문한 가구"],
                  ["92%", "재고 회전율"],
                  ["156", "총 등록 고객"],
                ].map(([num, label]) => (
                  <div className="stat-card" key={label}>
                    <div className="stat-number">{num}</div>
                    <div className="stat-label">{label}</div>
                  </div>
                ))}
              </div>

              <div className="card">
                <div className="card-header">
                  <div className="card-title">🗺️ 실시간 차량 위치 및 상태</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="button button-secondary" onClick={loadVehicles} disabled={vehLoading}>
                      🚚 차량 새로고침
                    </button>
                    <button className="button button-secondary" onClick={fetchAlerts} disabled={loadingAlerts}>
                      🔔 알림 새로고침
                    </button>
                  </div>
                </div>

                {/* 지도 대신 간단한 “요약 카드” 2개 표시 (가벼운 개요용) */}
                {vehErr && <div className="alert alert-warning">{vehErr}</div>}
                {vehLoading && <div className="alert alert-info">차량 정보를 불러오는 중...</div>}
                {!vehLoading &&
                  (vehicles.length ? (
                    vehicles.slice(0, 2).map((v) => (
                      <div key={v.id} className="vehicle-card">
                        <div className="vehicle-header">
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <b>{v.name}</b>
                            <span className="pill">#{v.id}</span>
                            <span className="customer-status status-active">{v.status}</span>
                          </div>
                          <small style={{ color: "#64748b" }}>
                            최근 갱신: {v.last_ping ? new Date(v.last_ping).toLocaleString("ko-KR") : "-"}
                          </small>
                        </div>
                        <div className="vehicle-info">
                          <div className="info-item">
                            <div className="info-label">좌표</div>
                            <div className="info-value">
                              {typeof v.lat === "number" ? v.lat.toFixed(4) : "-"},{" "}
                              {typeof v.lon === "number" ? v.lon.toFixed(4) : "-"}
                            </div>
                          </div>
                          <div className="info-item">
                            <div className="info-label">속도</div>
                            <div className="info-value">{Math.round(v.speed_kmh || 0)} km/h</div>
                          </div>
                          <div className="info-item">
                            <div className="info-label">적재율</div>
                            <div className="info-value">{Math.round(v.load_pct || 0)}%</div>
                          </div>
                          <div className="info-item">
                            <div className="info-label">배터리</div>
                            <div className="info-value">{Math.round(v.battery || 0)}%</div>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="chart-placeholder">차량 데이터가 없습니다.</div>
                  ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 25 }}>
                <div>
                  {alertErr && (
                    <div className="alert alert-warning" style={{ marginBottom: 12 }}>
                      {alertErr}
                    </div>
                  )}
                  {loadingAlerts && (
                    <div className="alert alert-info" style={{ marginBottom: 12 }}>
                      알림 불러오는 중...
                    </div>
                  )}
                  {!loadingAlerts &&
                    (alerts.slice(0, 2).length ? (
                      alerts.slice(0, 2).map((a) => (
                        <div
                          key={a.id}
                          className={`alert ${
                            a.type === "emergency" ? "alert-danger" : "alert-warning"
                          }`}
                          style={{ marginBottom: 12 }}
                        >
                          <strong>{a.type === "emergency" ? "🚨 긴급 알림" : "⚠️ 주의 알림"}</strong>
                          <br />
                          {a.message}
                          <br />
                          <small>{a.ts}</small>
                        </div>
                      ))
                    ) : (
                      <div className="alert alert-info">최근 알림이 없습니다.</div>
                    ))}
                </div>

                <div className="card">
                  <div className="card-title">📊 오늘의 성과</div>
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <div style={{ fontSize: 48, fontWeight: "bold" }}>+15%</div>
                    <p style={{ color: "#666", margin: "10px 0" }}>전일 대비 매출 증가</p>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: "78%" }} />
                    </div>
                    <p>
                      <small>월 목표 달성률: 78%</small>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* === 위기 알림 === */}
          {dashboardPage === "alerts" && (
            <div className="dashboard-page active">
              <div className="card">
                <div className="card-header">
                  <div className="card-title">🚨 위기 알림 (규칙/예측 기반)</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="button button-secondary" onClick={fetchAlerts}>
                      🔄 새로고침
                    </button>
                  </div>
                </div>

                {alertErr && <div className="alert alert-warning">{alertErr}</div>}
                {loadingAlerts && <div className="alert alert-info">불러오는 중...</div>}

                {!loadingAlerts &&
                  (alerts.length ? (
                    alerts.map((a) => (
                      <div
                        key={a.id}
                        className={`alert ${
                          a.type === "emergency" ? "alert-danger" : "alert-warning"
                        }`}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
                      >
                        <div>
                          <strong>{a.type === "emergency" ? "🚨 긴급" : "⚠️ 주의"}</strong>
                          <br />
                          {a.message}
                          <br />
                          <small>{a.ts}</small>
                        </div>
                        <div>
                          <button className="button" onClick={() => resolveAlert(a.id)}>
                            ✅ 처리 완료
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="alert alert-info">활성 알림이 없습니다.</div>
                  ))}
              </div>
            </div>
          )}

          {/* === 재고 관리 === */}
          {dashboardPage === "inventory" && (
            <div className="dashboard-page active">
              <div className="card">
                <div className="card-header">
                  <div className="card-title">📦 차량 재고 관리</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <select
                      value={vehicleId}
                      onChange={(e) => setVehicleId(Number(e.target.value))}
                      className="input"
                      style={{ width: 140 }}
                    >
                      <option value={1}>A차량 (#1)</option>
                      <option value={2}>B차량 (#2)</option>
                    </select>
                    <button className="button button-secondary" onClick={loadInventory} disabled={invLoading}>
                      🔄 불러오기
                    </button>
                    <button className="button" onClick={saveInventory} disabled={invLoading}>
                      💾 저장
                    </button>
                  </div>
                </div>

                {invErr && <div className="alert alert-warning">{invErr}</div>}

                <div className="chart-placeholder" style={{ overflowX: "auto" }}>
                  <table className="table-plain fixed">
                    <thead>
                      <tr>
                        <th className="th-id">상품ID</th>
                        <th className="th-name">상품명</th>
                        <th className="th-qty">수량</th>
                        <th className="th-actions"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {invItems.map((it, idx) => (
                        <tr key={idx}>
                          <td>
                            <input
                              className="input"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={it.product_id}
                              onChange={(e) =>
                                setInvItems((prev) =>
                                  prev.map((row, i) => (i === idx ? { ...row, product_id: e.target.value.replace(/\D/g, "") } : row))
                                )
                              }
                              placeholder="예: 101"
                            />
                          </td>
                          <td>
                            <input
                              className="input"
                              value={it.name ?? ""}
                              onChange={(e) =>
                                setInvItems((prev) =>
                                  prev.map((row, i) => (i === idx ? { ...row, name: e.target.value } : row))
                                )
                              }
                              placeholder="예: 두부"
                            />
                          </td>
                          <td>
                            <input
                              className="input"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={it.qty ?? 0}
                              onChange={(e) =>
                                setInvItems((prev) =>
                                  prev.map((row, i) => (i === idx ? { ...row, qty: e.target.value.replace(/\D/g, "") } : row))
                                )
                              }
                            />
                          </td>
                          <td>
                            <button className="button button-secondary" onClick={() => removeInvRow(idx)}>
                              삭제
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div style={{ marginTop: 10 }}>
                    <button className="button" onClick={addInvRow}>
                      + 행 추가
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* === 차량 관리 === */}
          {dashboardPage === "vehicles" && (
            <div className="dashboard-page active">
              <div className="card">
                <div className="card-header">
                  <div className="card-title">🚚 차량 현황</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="button button-secondary" onClick={loadVehicles} disabled={vehLoading}>
                      🔄 새로고침
                    </button>
                  </div>
                </div>

                {vehErr && <div className="alert alert-warning">{vehErr}</div>}
                {vehLoading && <div className="alert alert-info">불러오는 중...</div>}

                {!vehLoading &&
                  (vehicles.length ? (
                    vehicles.map((v) => (
                      <div key={v.id} className="vehicle-card">
                        <div className="vehicle-header">
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <b>{v.name}</b>
                            <span className="pill">#{v.id}</span>
                            <span className="customer-status status-active">{v.status}</span>
                          </div>
                          <small style={{ color: "#64748b" }}>
                            최근 갱신: {v.last_ping ? new Date(v.last_ping).toLocaleString("ko-KR") : "-"}
                          </small>
                        </div>
                        <div className="vehicle-info">
                          <div className="info-item">
                            <div className="info-label">좌표</div>
                            <div className="info-value">
                              {typeof v.lat === "number" ? v.lat.toFixed(4) : "-"},{" "}
                              {typeof v.lon === "number" ? v.lon.toFixed(4) : "-"}
                            </div>
                          </div>
                          <div className="info-item">
                            <div className="info-label">속도</div>
                            <div className="info-value">{Math.round(v.speed_kmh || 0)} km/h</div>
                          </div>
                          <div className="info-item">
                            <div className="info-label">적재율</div>
                            <div className="info-value">{Math.round(v.load_pct || 0)}%</div>
                          </div>
                          <div className="info-item">
                            <div className="info-label">배터리</div>
                            <div className="info-value">{Math.round(v.battery || 0)}%</div>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="alert alert-info">차량 데이터가 없습니다. 상단에서 새로고침을 눌러주세요.</div>
                  ))}
              </div>
            </div>
          )}

          {dashboardPage === "analytics" && (
            <div className="dashboard-page active">
              <div className="card">
                <div className="card-title">📈 매출 분석</div>
                <div className="chart-placeholder">차트(데모)</div>
              </div>
            </div>
          )}

          {dashboardPage === "reports" && (
            <div className="dashboard-page active">
              <div className="card">
                <div className="card-header">
                  <div className="card-title">📋 보고서 생성</div>
                  <button className="button" onClick={() => generateReport("custom")}>
                    + 커스텀 보고서
                  </button>
                </div>
                <div className="report-template" onClick={() => generateReport("daily")}>
                  📊 일일 운영 보고서
                </div>
                <div className="report-template" onClick={() => generateReport("weekly")}>
                  📈 주간 매출 보고서
                </div>
                <div className="report-template" onClick={() => generateReport("monthly")}>
                  📋 월간 종합 보고서
                </div>
              </div>
            </div>
          )}

          {dashboardPage === "settings" && (
            <div className="dashboard-page active">
              <div className="card">
                <div className="card-title">⚙️ 설정</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
