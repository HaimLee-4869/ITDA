// src/App.jsx
import { useState } from "react";
import "./styles/itda.css";
import PlatformToggle from "./components/PlatformToggle";
import DriverView from "./components/DriverView";
import DashboardView from "./components/DashboardView";

export default function App() {
  const [platform, setPlatform] = useState("dashboard"); // 'driver' or 'dashboard'

  return (
    <div className="container">
      <div className="header">
        <h1>잇다 (ITDA)</h1>
        <p>AI 기반 이동장터 운영 최적화 플랫폼</p>
      </div>

      <PlatformToggle platform={platform} onChange={setPlatform} />

      {/* 운전자 / 관리자 섹션 */}
      {platform === "driver" ? (
        <div id="driver" className="platform-section active">
          <DriverView />
        </div>
      ) : (
        <div id="dashboard" className="platform-section active">
          <DashboardView />
        </div>
      )}
    </div>
  );
}
