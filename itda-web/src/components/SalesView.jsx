// src/components/SalesView.jsx
import { useState, useEffect } from "react";
import { getJSON } from "../api";

export default function SalesView() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchSales = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await getJSON("/sales/summary");
        setSummary(data);
      } catch (e) {
        setError(e.message || "매출 데이터를 불러오는 중 오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    };
    fetchSales();
  }, []);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(amount);
  };

  const SalesTable = ({ title, data, dateKey, valueKey }) => (
    <div className="card" style={{ marginBottom: 20 }}>
      <h4 className="card-title">{title}</h4>
      <table className="table-plain">
        <thead>
          <tr>
            <th>기간</th>
            <th>총 매출</th>
          </tr>
        </thead>
        <tbody>
          {data && data.length > 0 ? (
            data.map((item, index) => (
              <tr key={index}>
                <td>{item[dateKey]}</td>
                <td>{formatCurrency(item[valueKey])}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="2" style={{ textAlign: 'center' }}>데이터가 없습니다.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  if (loading) return <div className="alert alert-info">매출 데이터를 불러오는 중입니다...</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;

  return (
    <div>
      <SalesTable title="📅 최근 7일 매출" data={summary?.daily} dateKey="date" valueKey="total_sales" />
      <SalesTable title="📈 주간 매출 (최근 4주)" data={summary?.weekly} dateKey="week_start_date" valueKey="total_sales" />
      <SalesTable title="🗓️ 월간 매출 (최근 3개월)" data={summary?.monthly} dateKey="month" valueKey="total_sales" />
    </div>
  );
}