// src/api.js
const BASE_URL = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

async function raw(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

export async function getJSON(path) {
  return raw(path, { method: "GET" });
}
export async function postJSON(path, body) {
  return raw(path, { method: "POST", body: JSON.stringify(body) });
}
export async function patchJSON(path, body) {
  return raw(path, { method: "PATCH", body: JSON.stringify(body) });
}
export async function delJSON(path) {
  return raw(path, { method: "DELETE" });
}

export { BASE_URL };
