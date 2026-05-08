import React, { useState, useEffect } from 'react';
import { Wallet, ArrowUpRight, ArrowDownRight, Clock, TrendingUp, CheckCircle2, Star, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

const TYPE_LABELS = {
  topup: { label: 'Kredi Yükleme', color: 'var(--success)', icon: '💰' },
  xml_import: { label: 'XML İçe Aktarma', color: 'var(--warning)', icon: '📦' },
  xml_convert: { label: 'XML Dönüştürme', color: 'var(--info, #60a5fa)', icon: '🔄' },
  admin_adjust: { label: 'Admin Düzeltmesi', color: 'var(--accent-primary)', icon: '⚙️' }
};

export default function CreditsPage() {
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subPlans, setSubPlans] = useState([]);

  // Credit top-up states
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [purchaseAmount, setPurchaseAmount] = useState('50');
  const [iframeToken, setIframeToken] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);

  // Subscription purchase states
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [subIframeToken, setSubIframeToken] = useState(null);
  const [subPaymentLoading, setSubPaymentLoading] = useState(false);

  useEffect(() => {
    fetchData();

    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    if (paymentStatus === 'success') {
      toast.success('Ödemeniz başarıyla alındı ve krediniz hesabınıza yüklendi!');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (paymentStatus === 'sub_success') {
      toast.success('Abonelik ödemeniz alındı! Hesabınız kısa süre içinde aktive edilecektir.');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (paymentStatus === 'fail' || paymentStatus === 'sub_fail') {
      toast.error('Ödeme işlemi başarısız oldu veya iptal edildi.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const fetchData = async () => {
    try {
      const [balRes, txRes, plansRes] = await Promise.all([
        api.get('/credits/balance'),
        api.get('/credits/transactions'),
        api.get('/public/pricing-plans').catch(() => ({ data: [] }))
      ]);
      setBalance(balRes.data.balance);
      setTransactions(txRes.data);
      setSubPlans(plansRes.data);
    } catch {
      toast.error('Veriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  // Credit top-up
  const handleStartCreditPayment = async () => {
    const amount = parseFloat(purchaseAmount);
    if (isNaN(amount) || amount < 10) {
      toast.error('Minimum 10 TL yükleyebilirsiniz.');
      return;
    }
    setPaymentLoading(true);
    try {
      const res = await api.post('/payment/paytr-token', { amount });
      setIframeToken(res.data.token);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ödeme başlatılamadı.');
    } finally {
      setPaymentLoading(false);
    }
  };

  // Subscription purchase
  const handleStartSubPayment = async (plan) => {
    const priceNum = parseFloat(String(plan.price).replace(/[^\d.]/g, ''));
    if (isNaN(priceNum) || priceNum < 1) {
      toast.error('Bu plan için geçerli bir fiyat bulunamadı.');
      return;
    }
    const days = plan.period && plan.period.includes('yıl') ? 365 : 30;
    setSubPaymentLoading(true);
    try {
      const res = await api.post('/payment/subscription-token', {
        amount: priceNum,
        planName: plan.name,
        days
      });
      setSubIframeToken(res.data.token);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ödeme başlatılamadı.');
    } finally {
      setSubPaymentLoading(false);
    }
  };

  // PayTR iframe resizer
  useEffect(() => {
    const token = iframeToken || subIframeToken;
    if (!token) return;
    const script = document.createElement('script');
    script.src = 'https://www.paytr.com/js/iframeResizer.min.js';
    script.async = true;
    document.body.appendChild(script);
    script.onload = () => { if (window.iFrameResize) window.iFrameResize({}, '#paytriframe'); };
    return () => { if (document.body.contains(script)) document.body.removeChild(script); };
  }, [iframeToken, subIframeToken]);

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Abonelik & Kredi</h1>
          <p>Abonelik satın alın veya kredi bakiyenizi yönetin</p>
        </div>
        <button className="btn btn-secondary" onClick={() => { setCreditModalOpen(true); setIframeToken(null); setPurchaseAmount('50'); }}>
          <Wallet size={16} /> Kredi Yükle
        </button>
      </div>

      {/* Balance Card */}
      <div className="card" style={{
        marginBottom: 32,
        background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))',
        border: '1px solid rgba(59,130,246,0.25)',
        display: 'flex', alignItems: 'center', gap: 16, padding: 24
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
        }}>
          <Wallet size={26} style={{ color: 'var(--accent-primary)' }} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Mevcut Kredi Bakiyesi</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--text-primary)' }}>
            {balance.toFixed(2)} <span style={{ fontSize: 18, color: 'var(--text-muted)' }}>Kredi</span>
          </div>
        </div>
      </div>

      {/* Subscription Plans */}
      {subPlans.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Abonelik Planları</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 20, fontSize: 14 }}>
            ModulPOS'u kesintisiz kullanmak için bir plan seçin. Ödeme onaylandıktan sonra aboneliğiniz aktive edilir.
          </p>
          <div className="grid grid-3" style={{ gap: 16 }}>
            {subPlans.map(plan => (
              <div key={plan.id} className="card" style={{
                display: 'flex', flexDirection: 'column',
                border: plan.isHighlighted ? '2px solid var(--accent-primary)' : undefined,
                position: 'relative'
              }}>
                {plan.isHighlighted && (
                  <div style={{
                    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                    background: 'var(--accent-gradient)', color: '#fff',
                    fontSize: 11, fontWeight: 700, padding: '3px 14px', borderRadius: 20,
                    display: 'flex', alignItems: 'center', gap: 4
                  }}>
                    <Star size={11} /> EN POPÜLER
                  </div>
                )}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{plan.name}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-primary)' }}>{plan.price}</span>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{plan.period}</span>
                  </div>
                </div>
                <ul style={{ listStyle: 'none', margin: '0 0 20px', padding: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(Array.isArray(plan.features) ? plan.features : []).map((f, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                      <CheckCircle2 size={15} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  className={`btn ${plan.isHighlighted ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setSelectedPlan(plan); setSubIframeToken(null); setSubModalOpen(true); }}
                  style={{ width: '100%' }}
                >
                  <Zap size={15} /> {plan.ctaText || 'Satın Al'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transaction History */}
      <div className="card">
        <div className="table-header">
          <h3><Clock size={18} /> İşlem Geçmişi</h3>
        </div>
        {transactions.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px 20px' }}>
            <TrendingUp size={48} className="empty-icon" />
            <h3>Henüz işlem yok</h3>
            <p>Kredi yüklendiğinde veya harcandığında burada görünecektir.</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>İşlem</th>
                  <th>Açıklama</th>
                  <th style={{ textAlign: 'right' }}>Tutar</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => {
                  const typeInfo = TYPE_LABELS[tx.type] || { label: tx.type, color: 'var(--text-muted)', icon: '📋' };
                  const isPositive = tx.amount > 0;
                  return (
                    <tr key={tx.id}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>
                        {new Date(tx.createdAt).toLocaleDateString('tr-TR')} {new Date(tx.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                          background: `${typeInfo.color}15`, color: typeInfo.color, border: `1px solid ${typeInfo.color}30`
                        }}>
                          {typeInfo.icon} {typeInfo.label}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{tx.description || '-'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: isPositive ? 'var(--success)' : 'var(--danger)' }}>
                          {isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                          {isPositive ? '+' : ''}{tx.amount.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Credit Top-up Modal */}
      {creditModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 500, padding: 0, background: 'var(--bg-primary)', overflow: 'hidden' }}>
            <div className="table-header" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Wallet size={18} style={{ color: 'var(--accent-primary)' }} /> Kredi Yükle
              </h3>
              <button className="text-btn" onClick={() => setCreditModalOpen(false)}>Kapat</button>
            </div>
            <div style={{ padding: 20 }}>
              {!iframeToken ? (
                <>
                  <div className="form-group" style={{ marginBottom: 16 }}>
                    <label className="form-label">Yüklenecek Tutar (TL)</label>
                    <div style={{ position: 'relative' }}>
                      <input type="number" className="form-input" min="10" step="10" value={purchaseAmount}
                        onChange={e => setPurchaseAmount(e.target.value)}
                        style={{ fontSize: 18, fontWeight: 600, paddingRight: 40 }} autoFocus />
                      <span style={{ position: 'absolute', right: 12, top: 12, color: 'var(--text-muted)', fontWeight: 600 }}>TL</span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginTop: 8 }}>
                      1 TL = 1 Kredi olarak hesabınıza yansıyacaktır. Minimum 10 TL yükleyebilirsiniz.
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                    <button className="btn btn-secondary" onClick={() => setCreditModalOpen(false)}>İptal</button>
                    <button className="btn btn-primary" onClick={handleStartCreditPayment} disabled={paymentLoading}>
                      {paymentLoading ? 'Bağlanıyor...' : 'Güvenli Ödeme Yap'}
                    </button>
                  </div>
                  <div style={{ marginTop: 24, textAlign: 'center' }}>
                    <img src="https://www.paytr.com/img/general/PayTR-Odeme-Altyapisi.svg" alt="PayTR" style={{ height: 30, opacity: 0.8 }} />
                  </div>
                </>
              ) : (
                <div style={{ width: '100%' }}>
                  <iframe src={`https://www.paytr.com/odeme/guvenli/${iframeToken}`} id="paytriframe"
                    frameBorder="0" scrolling="no" style={{ width: '100%', minHeight: '550px' }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Subscription Purchase Modal */}
      {subModalOpen && selectedPlan && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 500, padding: 0, background: 'var(--bg-primary)', overflow: 'hidden' }}>
            <div className="table-header" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Zap size={18} style={{ color: 'var(--accent-primary)' }} /> {selectedPlan.name} Planı
              </h3>
              <button className="text-btn" onClick={() => { setSubModalOpen(false); setSubIframeToken(null); }}>Kapat</button>
            </div>
            <div style={{ padding: 20 }}>
              {!subIframeToken ? (
                <>
                  <div style={{
                    background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                    borderRadius: 10, padding: 16, marginBottom: 20,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Seçilen Plan</div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedPlan.name}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent-primary)' }}>{selectedPlan.price}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedPlan.period}</div>
                    </div>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                    Ödeme onaylandıktan sonra ekibimiz aboneliğinizi en kısa sürede aktive edecektir.
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button className="btn btn-secondary" onClick={() => { setSubModalOpen(false); setSubIframeToken(null); }}>İptal</button>
                    <button className="btn btn-primary" onClick={() => handleStartSubPayment(selectedPlan)} disabled={subPaymentLoading}>
                      {subPaymentLoading ? 'Bağlanıyor...' : 'Güvenli Ödeme Yap'}
                    </button>
                  </div>
                  <div style={{ marginTop: 24, textAlign: 'center' }}>
                    <img src="https://www.paytr.com/img/general/PayTR-Odeme-Altyapisi.svg" alt="PayTR" style={{ height: 30, opacity: 0.8 }} />
                  </div>
                </>
              ) : (
                <div style={{ width: '100%' }}>
                  <iframe src={`https://www.paytr.com/odeme/guvenli/${subIframeToken}`} id="paytriframe"
                    frameBorder="0" scrolling="no" style={{ width: '100%', minHeight: '550px' }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
