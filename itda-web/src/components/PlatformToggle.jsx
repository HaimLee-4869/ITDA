// src/components/PlatformToggle.jsx
export default function PlatformToggle({ platform, onChange }) {
  return (
    <div className="platform-toggle">
      <button
        className={`platform-btn ${platform === "driver" ? "active" : ""}`}
        onClick={() => onChange("driver")}
      >
        🚚 운전자용 웹 인터페이스
      </button>
      <button
        className={`platform-btn ${platform === "dashboard" ? "active" : ""}`}
        onClick={() => onChange("dashboard")}
      >
        📊 관리자용 웹 대시보드
      </button>
    </div>
  );
}
