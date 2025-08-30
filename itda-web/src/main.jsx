// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "leaflet/dist/leaflet.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  // 개발모드에서 useEffect가 두 번 실행되어 API가 중복 호출되는 것을 방지
  <App />
);
