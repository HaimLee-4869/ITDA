// src/components/DriverView.jsx
import { useState, useEffect } from "react";
import { getJSON, postJSON } from "../api";

function RecommendationCard({ option, isBest, onSelect }) {
    const [showDetails, setShowDetails] = useState(isBest);
    const ScoreBar = ({ score }) => (
        <div style={{ width: '100%', backgroundColor: '#e2e8f0', borderRadius: '4px', overflow: 'hidden', height: '10px' }}>
            <div style={{ width: `${Math.min(100, Math.max(0, score / 2))}%`, backgroundColor: isBest ? '#4ade80' : '#60a5fa', height: '100%' }} />
        </div>
    );
  
    return (
      <div className={`card ${isBest ? 'best-choice' : ''}`}>
        <div className="card-header" onClick={() => setShowDetails(!showDetails)} style={{cursor: 'pointer'}}>
          <div className="card-title">{isBest && "✨ AI 최우선 추천: "} {option.village_name}</div>
          <div style={{textAlign: 'right'}}><div style={{fontSize: '1.5em', fontWeight: 'bold'}}>{option.score}점</div><ScoreBar score={option.score} /></div>
        </div>
        
        {showDetails && (
          <div className="card-content">
            <p><strong>AI 종합 평가:</strong> {option.reason_summary}</p><hr/>
            <ul>
              {option.details.demand.details.length > 0 && <li><strong>예상 수요:</strong> {option.details.demand.details.join(', ')}</li>}
              {option.details.supply_match.details.length > 0 && <li><strong>재고 일치도:</strong> {option.details.supply_match.details.join(', ')}</li>}
              {option.details.care_need.details.length > 0 && <li><strong>특별 요청:</strong> {option.details.care_need.details.join(', ')}</li>}
              {option.details.distance.details.length > 0 && <li><strong>이동 효율:</strong> {option.details.distance.details.join(', ')}</li>}
            </ul>
            <button className="button" style={{width: '100%', marginTop: '1rem'}} onClick={() => onSelect(option)}>
              {option.village_name}(으)로 출발 및 판매 기록 시작
            </button>
          </div>
        )}
      </div>
    );
}

function SalesLogForm({ village, onSaleLogged }) {
    const [itemsSold, setItemsSold] = useState([{ product_id: 101, qty: 0, price: 3000 }]);
    const [feedback, setFeedback] = useState("");

    const handleSubmit = async () => {
        const payload = {
            vehicle_id: 1, village_id: village.village_id,
            items_sold: itemsSold.filter(item => item.qty > 0 && item.price > 0),
            feedback: feedback
        };
        try {
            const response = await postJSON("/recommend/log-sale", payload);
            alert(response.message);
            onSaleLogged();
        } catch (e) { alert("판매 기록 저장 실패: " + e.message); }
    };

    return (
        <div className="card" style={{marginTop: '2rem'}}>
            <div className="card-title">{village.village_name} 판매 기록 및 피드백 입력</div>
            <p>판매 정보를 입력하면 AI가 학습하여 다음 추천이 더 똑똑해집니다.</p>
            {itemsSold.map((item, index) => (
                <div key={index} style={{display: 'flex', gap: '8px', marginBottom: '8px'}}>
                    <select className="input" value={item.product_id} onChange={e => setItemsSold(itemsSold.map((i, idx) => idx === index ? {...i, product_id: Number(e.target.value)} : i))}>
                        <option value={101}>두부</option><option value={102}>계란</option><option value={103}>채소</option>
                    </select>
                    <input className="input" type="number" placeholder="수량" value={item.qty} onChange={e => setItemsSold(itemsSold.map((i, idx) => idx === index ? {...i, qty: Number(e.target.value)} : i))} />
                </div>
            ))}
            <button className="button button-secondary" onClick={() => setItemsSold([...itemsSold, { product_id: 102, qty: 0, price: 6000 }])}>+ 품목 추가</button>
            <textarea className="input" placeholder="특이사항이나 고객 피드백을 입력하세요... (예: 다음엔 우유를 가져다 달라고 하심)" value={feedback} onChange={e => setFeedback(e.target.value)} style={{marginTop: '1rem', minHeight: '80px'}}/>
            <button className="button" onClick={handleSubmit} style={{marginTop: '1rem'}}>판매 완료 및 AI 학습 데이터로 저장</button>
        </div>
    );
}

export default function DriverView() {
  const [driverPage, setDriverPage] = useState("recommend");
  const [recommendations, setRecommendations] = useState([]);
  const [recoLoading, setRecoLoading] = useState(false);
  const [selectedVillage, setSelectedVillage] = useState(null);

  const fetchRecommendations = async () => {
    setRecoLoading(true); setRecommendations([]); setSelectedVillage(null);
    try {
      const data = await getJSON("/recommend/best-options/1");
      setRecommendations(data.options);
    } catch (e) { alert("AI 추천 로딩 실패: " + e.message); } 
    finally { setRecoLoading(false); }
  };

  useEffect(() => { if (driverPage === 'recommend') fetchRecommendations(); }, [driverPage]);

  // NavItem remains the same as your code.
  const NavItem = ({ id, icon, label }) => (<li className={`${driverPage === id ? "active" : ""}`} onClick={() => setDriverPage(id)}>{icon} {label}</li>);

  return (
    <div className="driver-container">
      <div className="driver-sidebar">
        <h3>🚚 운전자 메뉴</h3>
        <ul className="driver-nav">
          <NavItem id="recommend" icon="✨" label="AI 최적 판매 추천" />
          <NavItem id="route" icon="🛣️" label="경로 최적화" />
          <NavItem id="inventory" icon="📦" label="재고 관리" />
          {/* Other NavItems */}
        </ul>
      </div>
      <div className="driver-main">
        <div className="driver-header"><h2>🚚 운전자용 인터페이스</h2></div>
        <div className="driver-content">
          {driverPage === "recommend" && (
            <div>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <h2>✨ AI가 분석한 최적 판매 장소 ✨</h2>
                <button className="button" onClick={fetchRecommendations} disabled={recoLoading}>{recoLoading ? "분석 중..." : "🔄 다시 분석"}</button>
              </div>
              <p>AI가 수요와 공급, 이동 효율을 모두 고려하여 최적의 판매 장소 두 곳을 비교해드립니다.</p>
              {recoLoading && <div className="alert alert-info">AI가 실시간으로 데이터를 분석하고 있습니다...</div>}
              <div className="recommendation-grid">
                {recommendations.slice(0, 2).map((option, index) => (
                    <RecommendationCard key={option.village_id} option={option} isBest={index === 0} onSelect={setSelectedVillage} />
                ))}
              </div>
              {selectedVillage && <SalesLogForm village={selectedVillage} onSaleLogged={() => { fetchRecommendations(); }} />}
            </div>
          )}
          {/* Other pages' UI */}
        </div>
      </div>
    </div>
  );
}