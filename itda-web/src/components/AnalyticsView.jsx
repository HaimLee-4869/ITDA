// src/components/AnalyticsView.jsx
import { useState, useEffect } from "react";
import { getJSON } from "../api";
import { Line, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

export default function AnalyticsView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        setError("");
        const result = await getJSON("/analytics/summary");
        setData(result);
      } catch (e) {
        setError(e.message || "분석 데이터를 불러오는 중 오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, []);

  if (loading) return <div className="alert alert-info">분석 데이터를 불러오는 중입니다...</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!data) return null;

  const salesOverTimeData = {
    labels: data.sales_over_time.map(d => d.date),
    datasets: [{
      label: '일일 총 매출',
      data: data.sales_over_time.map(d => d.total_sales),
      borderColor: '#4CAF50',
      backgroundColor: 'rgba(76, 175, 80, 0.1)',
      fill: true,
    }],
  };

  const salesByProductData = {
    labels: data.sales_by_product.map(p => p.product_name),
    datasets: [{
      label: '상품별 총 매출',
      data: data.sales_by_product.map(p => p.sale),
      backgroundColor: '#3b82f6',
    }],
  };
  
  const salesByVillageData = {
    labels: data.sales_by_village.map(v => v.village_name),
    datasets: [{
      label: '마을별 총 매출',
      data: data.sales_by_village.map(v => v.sale),
      backgroundColor: '#f97316',
    }],
  };
  
  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'top' },
    },
  };

  return (
    <div style={{ display: 'grid', gap: '25px' }}>
      <div className="card">
        <div className="card-title">📈 시간대별 매출 추이</div>
        <div style={{ height: '300px' }}>
          <Line options={{...chartOptions, maintainAspectRatio: false}} data={salesOverTimeData} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '25px' }}>
        <div className="card">
          <div className="card-title">📦 상품별 매출 순위</div>
          <div style={{ height: '300px' }}>
            <Bar options={{...chartOptions, maintainAspectRatio: false}} data={salesByProductData} />
          </div>
        </div>
        <div className="card">
          <div className="card-title">🏠 마을별 매출 순위</div>
          <div style={{ height: '300px' }}>
            <Bar options={{...chartOptions, maintainAspectRatio: false}} data={salesByVillageData} />
          </div>
        </div>
      </div>
    </div>
  );
}