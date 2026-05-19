import React, { useState, useEffect, useRef } from 'react';
import { Wallet, ArrowUpRight, ArrowDownRight, Clock, TrendingUp, CheckCircle2, Star, Zap, X, CreditCard, RefreshCw, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

const TYPE_LABELS = {
  topup:        { label: 'Kredi Yükleme',    color: 'var(--success)',           icon: '💰' },
  xml_import:   { label: 'XML İçe Aktarma',  color: 'var(--warning)',           icon: '📦' },
  xml_convert:  { label: 'XML Dönüştürme',   color: 'var(--info, #60a5fa)',     icon: '🔄' },
  admin_adjust: { label: 'Admin Düzeltmesi', color: 'var(--accent-primary)',    icon: '⚙️' },
  subscription: { label: 'Abonelik',         color: 'var(--accent-secondary)',  icon: '⭐' },
};

const QUICK_AMOUNTS = [50, 100, 200, 500];

function extractPrice(str) {
  if (!str) return NaN;
  return parseFloat(String(str).replace(/[^\d.]/g, ''));
}

export default function CreditsPage() {
  const [balance, setBalance]       = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [subPlans, setSubPlans]     = useState([]);
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [planMarkup, setPlanMarkup] = useState({});

  // Credit top-up
  const [creditModal, setCreditModal]       = useState(false);
  const [purchaseAmount, setPurchaseAmount] = useState('100');
  const [iframeToken, setIframeToken]       = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);

  // Subscription
  const [subModal, setSubModal]             = useState(false);
  const [selectedPlan, setSelectedPlan]     = useState(null);
  const [selectedCycle, setSelectedCycle]   = useState('monthly');
  const [subIframeToken, setSubIframeToken] = useState(null);
  const [subPaymentLoading, setSubPaymentLoading] = useState(false);

  const iframeRef = useRef(null);

  useEffect(() => {
    fetchData();
    const p = new URLSearchParams(window.location.search).get('payment');
    if (p === 'success')      { toast.success('Ödemeniz alındı, krediniz yüklendi!'); }
    else if (p === 'sub_success') { toast.success('Abonelik ödemesi alındı! Hesabınız kısa süre içinde aktive edilecek.'); }
    else if (p === 'fail' || p === 'sub_fail') { toast.error('Ödeme başarısız veya iptal edildi.'); }
    if (p) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  useEffect(() => {
    const token = iframeToken || subIframeToken;
    if (!token) return;
    const existing = document.getElementById('paytr-resizer-script');
    if (existing) { tryResize(); return; }
    const s = document.createElement('script');
    s.id = 'paytr-resizer-script';
    s.src = 'https://www.paytr.com/js/iframeResizer.min.js';
    s.onload = tryResize;
    document.body.appendChild(s);
  }, [iframeToken, subIframeToken]);

  const tryResize = () => {
    setTimeout(() => {
      if (window.iFrameResize && iframeRef.current) {
        window.iFrameResize({}, iframeRef.current);
      }
    }, 200);
  };

  const fetchData = async () => {
    try {
      const [balRes, txRes, plansRes, markupRes] = await Promise.all([
        api.get('/credits/balance'),
        api.get('/credits/transactions'),
        api.get('/public/pricing-plans').catch(() => ({ data: [] })),
        api.get('/public/xml-plan-markup').catch(() => ({ data: {} }))
      ]);
      setBalance(balRes.data.balance);
      setTransactions(txRes.data);
      setSubPlans(plansRes.data);
      setPlanMarkup(markupRes.data);
    } catch {
      toast.error('Veriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  const openCreditModal = () => {
    setIframeToken(null);
    setPurchaseAmount('100');
    setCreditModal(true);
  };

  const closeCreditModal = () => {
    setCreditModal(false);
    setIframeToken(null);
  };

  const handleStartCreditPayment = async () => {
    const amount = parseFloat(purchaseAmount);
    if (isNaN(amount) || amount < 10) return toast.error('Minimum 10 TL yükleyebilirsiniz.');
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

  const openSubModal = (plan) => {
    setSelectedPlan(plan);
    setSelectedCycle(billingCycle);
    setSubIframeToken(null);
    setSubModal(true);
  };

  const handleStartSubPayment = async () => {
    const plan = selectedPlan;
    const cycle = selectedCycle;
    const priceStr = cycle === 'yearly' && plan.yearlyPrice ? plan.yearlyPrice : plan.price;
    const priceNum = extractPrice(priceStr);
    if (isNaN(priceNum) || priceNum < 1) return toast.error('Bu plan için geçerli bir fiyat bulunamadı.');
    const days = cycle === 'yearly' ? 365 : 30;
    setSubPaymentLoading(true);
    try {
      const res = await api.post('/payment/subscription-token', {
        amount: priceNum,
        planName: plan.name,
        planId: plan.id,
        days,
        billingCycle: cycle
      });
      setSubIframeToken(res.data.token);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ödeme başlatılamadı.');
    } finally {
      setSubPaymentLoading(false);
    }
  };

  // Savings calculation for a plan
  function getSavings(plan) {
    const monthly = extractPrice(plan.price);
    const yearly  = extractPrice(plan.yearlyPrice);
    if (isNaN(monthly) || isNaN(yearly) || monthly <= 0) return null;
    const monthlyTotal = monthly * 12;
    const saved = monthlyTotal - yearly;
    if (saved <= 0) return null;
    const pct = Math.round((saved / monthlyTotal) * 100);
    return { saved, pct };
  }


  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  return (
    <div>
      {/* Header */}
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Abonelik & Kredi</h1>
          <p>Abonelik satın alın veya kredi bakiyenizi yönetin</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={fetchData}><RefreshCw size={15} /></button>
          <button className="btn btn-primary" onClick={openCreditModal}>
            <CreditCard size={15} /> Kredi Yükle
          </button>
        </div>
      </div>

      {/* Balance Card */}
      <div className="card" style={{
        marginBottom: 32,
        background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))',
        border: '1px solid rgba(59,130,246,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 24, flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Wallet size={26} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Mevcut Kredi Bakiyesi</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--text-primary)' }}>
              {balance.toFixed(2)} <span style={{ fontSize: 18, color: 'var(--text-muted)' }}>Kredi</span>
            </div>
          </div>
        </div>
        <button className="btn btn-primary" style={{ padding: '10px 24px', fontSize: 15 }} onClick={openCreditModal}>
          <CreditCard size={16} /> Kredi Yükle
        </button>
      </div>

      {/* Subscription Plans */}
      {subPlans.length > 0 && (
        <div style={{ marginBottom: 32 }}>

          {/* Section header + billing toggle */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Abonelik Planları</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>
              ModulPOS'u kesintisiz kullanmak için bir plan seçin.
            </p>

            {/* Billing toggle — always visible */}
            <div style={{ display: 'inline-flex', alignItems: 'center', background: 'var(--bg-tertiary)', borderRadius: 12, padding: 4, border: '1px solid var(--border-color)', gap: 0 }}>
              <button
                onClick={() => setBillingCycle('monthly')}
                style={{
                  padding: '8px 24px', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  border: 'none', transition: 'all 0.15s',
                  background: billingCycle === 'monthly' ? 'var(--bg-card)' : 'transparent',
                  color: billingCycle === 'monthly' ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: billingCycle === 'monthly' ? '0 1px 6px rgba(0,0,0,0.18)' : 'none'
                }}>
                Aylık
              </button>
              <button
                onClick={() => setBillingCycle('yearly')}
                style={{
                  padding: '8px 24px', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  border: 'none', transition: 'all 0.15s',
                  background: billingCycle === 'yearly' ? 'var(--bg-card)' : 'transparent',
                  color: billingCycle === 'yearly' ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: billingCycle === 'yearly' ? '0 1px 6px rgba(0,0,0,0.18)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 7
                }}>
                Yıllık
                {(() => {
                  const maxPct = Math.max(...subPlans.map(p => getSavings(p)?.pct || 0));
                  return maxPct > 0 ? (
                    <span style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20 }}>
                      %{maxPct}'e kadar tasarruf
                    </span>
                  ) : null;
                })()}
              </button>
            </div>
          </div>

          <div className="grid grid-3" style={{ gap: 20 }}>
            {subPlans.map(plan => {
              const savings = getSavings(plan);
              const planHasYearly = plan.yearlyPrice && extractPrice(plan.yearlyPrice) > 0;
              const showYearly = billingCycle === 'yearly' && planHasYearly;
              const displayPrice = showYearly ? plan.yearlyPrice : plan.price;
              const monthlyNum = extractPrice(plan.price);

              return (
                <div key={plan.id} className="card" style={{ display: 'flex', flexDirection: 'column', border: plan.isHighlighted ? '2px solid var(--accent-primary)' : undefined, position: 'relative' }}>
                  {plan.isHighlighted && (
                    <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: 'var(--accent-gradient)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 14px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                      <Star size={11} /> EN POPÜLER
                    </div>
                  )}

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{plan.name}</div>

                    {/* Price */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)' }}>{displayPrice}</span>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {showYearly ? '/ yıl' : (plan.period || '/ ay')}
                      </span>
                    </div>

                    {/* Yearly mode: aylık eşdeğer + tasarruf */}
                    {showYearly && savings && (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          Aylık eşdeğer:{' '}
                          <s style={{ marginRight: 3 }}>{!isNaN(monthlyNum) ? `₺${monthlyNum.toFixed(0)}` : plan.price}</s>
                          <strong style={{ color: 'var(--text-primary)' }}>
                            ₺{(extractPrice(plan.yearlyPrice) / 12).toFixed(0)}
                          </strong>
                        </span>
                        <span style={{ display: 'inline-flex', width: 'fit-content', alignItems: 'center', gap: 4, background: 'rgba(16,185,129,0.12)', color: '#10b981', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, border: '1px solid rgba(16,185,129,0.3)' }}>
                          ₺{savings.saved.toFixed(0)} tasarruf · %{savings.pct} indirim
                        </span>
                      </div>
                    )}

                    {/* Monthly mode: yıllık tasarruf ipucu */}
                    {!showYearly && savings && (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                        Yıllık ödemede{' '}
                        <button onClick={() => setBillingCycle('yearly')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#10b981', fontWeight: 700, fontSize: 12 }}>
                          %{savings.pct} tasarruf
                        </button>
                      </div>
                    )}

                    {/* Yearly selected but no yearly price for this plan */}
                    {billingCycle === 'yearly' && !planHasYearly && (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Aylık fiyat gösteriliyor
                      </div>
                    )}
                  </div>

                  {planMarkup[plan.name] !== undefined && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
                      borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 600,
                      color: 'var(--accent-primary)', marginBottom: 14, width: 'fit-content'
                    }}>
                      📦 Tedarikçi marjı: %{planMarkup[plan.name]}
                    </div>
                  )}

                  <ul style={{ listStyle: 'none', margin: '0 0 20px', padding: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(Array.isArray(plan.features) ? plan.features : []).map((f, i) => (
                      <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                        <CheckCircle2 size={15} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <button className={`btn ${plan.isHighlighted ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => openSubModal(plan)}
                    style={{ width: '100%' }}>
                    <Zap size={15} /> {plan.ctaText || 'Satın Al'}
                  </button>
                </div>
              );
            })}
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
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: `${typeInfo.color}15`, color: typeInfo.color, border: `1px solid ${typeInfo.color}30` }}>
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

      {/* ── Credit Top-up Modal ── */}
      {creditModal && (
        <PaytrModal
          title="Kredi Yükle"
          icon={<CreditCard size={18} style={{ color: 'var(--accent-primary)' }} />}
          onClose={closeCreditModal}
          iframeToken={iframeToken}
          iframeRef={iframeRef}
        >
          {!iframeToken ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <label className="form-label">Yüklenecek Tutar (TL)</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
                  {QUICK_AMOUNTS.map(a => (
                    <button key={a} type="button"
                      onClick={() => setPurchaseAmount(String(a))}
                      style={{
                        padding: '10px 4px', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer',
                        border: `2px solid ${purchaseAmount === String(a) ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                        background: purchaseAmount === String(a) ? 'rgba(59,130,246,0.12)' : 'var(--bg-tertiary)',
                        color: purchaseAmount === String(a) ? 'var(--accent-primary)' : 'var(--text-primary)',
                        transition: 'all 0.15s'
                      }}>
                      ₺{a}
                    </button>
                  ))}
                </div>
                <div style={{ position: 'relative' }}>
                  <input type="number" className="form-input" min="10" step="10"
                    value={purchaseAmount}
                    onChange={e => setPurchaseAmount(e.target.value)}
                    placeholder="Özel tutar girin..."
                    style={{ fontSize: 18, fontWeight: 600, paddingRight: 44 }} />
                  <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 700, fontSize: 15 }}>TL</span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginTop: 6 }}>
                  1 TL = 1 Kredi · Minimum 10 TL
                </span>
              </div>

              <div style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: 'var(--text-secondary)' }}>
                Yüklenecek: <strong style={{ color: 'var(--success)', fontSize: 15 }}>₺{parseFloat(purchaseAmount) > 0 ? parseFloat(purchaseAmount).toFixed(2) : '0.00'}</strong>
                {' → '}
                <strong style={{ color: 'var(--success)', fontSize: 15 }}>{parseFloat(purchaseAmount) > 0 ? parseFloat(purchaseAmount).toFixed(2) : '0.00'} Kredi</strong>
              </div>

              <button className="btn btn-primary" style={{ width: '100%', padding: '12px', fontSize: 15 }}
                onClick={handleStartCreditPayment} disabled={paymentLoading || !purchaseAmount || parseFloat(purchaseAmount) < 10}>
                {paymentLoading
                  ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, display: 'inline-block', marginRight: 8 }} />Bağlanıyor...</>
                  : <><CreditCard size={16} /> Güvenli Ödeme Yap</>}
              </button>

              <div style={{ marginTop: 20, textAlign: 'center' }}>
                <img src="https://www.paytr.com/img/general/PayTR-Odeme-Altyapisi.svg" alt="PayTR" style={{ height: 28, opacity: 0.7 }} referrerPolicy="no-referrer" />
              </div>
            </>
          ) : null}
        </PaytrModal>
      )}

      {/* ── Subscription Modal ── */}
      {subModal && selectedPlan && (
        <PaytrModal
          title={`${selectedPlan.name} Planı`}
          icon={<Zap size={18} style={{ color: 'var(--accent-primary)' }} />}
          onClose={() => { setSubModal(false); setSubIframeToken(null); }}
          iframeToken={subIframeToken}
          iframeRef={iframeRef}
        >
          {!subIframeToken ? (
            <SubPaymentForm
              plan={selectedPlan}
              cycle={selectedCycle}
              setCycle={setSelectedCycle}
              loading={subPaymentLoading}
              onPay={handleStartSubPayment}
              getSavings={getSavings}
              extractPrice={extractPrice}
            />
          ) : null}
        </PaytrModal>
      )}
    </div>
  );
}

function SubPaymentForm({ plan, cycle, setCycle, loading, onPay, getSavings, extractPrice }) {
  const planHasYearly = plan.yearlyPrice && extractPrice(plan.yearlyPrice) > 0;
  const showYearly = cycle === 'yearly' && planHasYearly;
  const displayPrice = showYearly ? plan.yearlyPrice : plan.price;
  const savings = getSavings(plan);
  const yearlyNum = extractPrice(plan.yearlyPrice);

  return (
    <>
      {/* Billing cycle selector — always visible */}
      <div style={{ marginBottom: 20 }}>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Calendar size={14} /> Faturalandırma Dönemi
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {/* Monthly */}
          <button
            type="button"
            onClick={() => setCycle('monthly')}
            style={{
              padding: '12px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              border: `2px solid ${cycle === 'monthly' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
              background: cycle === 'monthly' ? 'rgba(59,130,246,0.08)' : 'var(--bg-tertiary)',
              transition: 'all 0.15s'
            }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>Aylık</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{plan.price}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>her ay yenilenir</div>
          </button>

          {/* Yearly */}
          <button
            type="button"
            onClick={() => planHasYearly ? setCycle('yearly') : undefined}
            disabled={!planHasYearly}
            style={{
              padding: '12px 14px', borderRadius: 10, textAlign: 'left', position: 'relative',
              cursor: planHasYearly ? 'pointer' : 'default',
              border: `2px solid ${!planHasYearly ? 'var(--border-color)' : cycle === 'yearly' ? '#10b981' : 'var(--border-color)'}`,
              background: !planHasYearly ? 'var(--bg-tertiary)' : cycle === 'yearly' ? 'rgba(16,185,129,0.07)' : 'var(--bg-tertiary)',
              opacity: planHasYearly ? 1 : 0.5,
              transition: 'all 0.15s'
            }}>
            {savings && planHasYearly && (
              <span style={{ position: 'absolute', top: -8, right: 8, background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20 }}>
                %{savings.pct} indirim
              </span>
            )}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>Yıllık</div>
            {planHasYearly ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{plan.yearlyPrice}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {!isNaN(yearlyNum) ? `≈ ₺${(yearlyNum / 12).toFixed(0)}/ay` : 'yılda bir yenilenir'}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>Yıllık plan mevcut değil</div>
            )}
          </button>
        </div>
      </div>

      {/* Summary */}
      <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: showYearly && savings ? 10 : 0 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>Seçilen Plan</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{plan.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {showYearly ? '12 aylık abonelik' : '1 aylık abonelik'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--accent-primary)' }}>{displayPrice}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {showYearly ? '/ yıl' : (plan.period || '/ ay')}
            </div>
          </div>
        </div>

        {/* Yearly savings detail */}
        {showYearly && savings && (
          <div style={{ borderTop: '1px solid rgba(59,130,246,0.15)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Aylık fiyata göre tasarruf
            </span>
            <span style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--success)', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: '1px solid rgba(34,197,94,0.25)' }}>
              ₺{savings.saved.toFixed(0)} tasarruf
            </span>
          </div>
        )}
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
        Ödeme onaylandıktan sonra aboneliğiniz otomatik olarak aktive edilecektir.
      </p>

      <button className="btn btn-primary" style={{ width: '100%', padding: '12px', fontSize: 15 }}
        onClick={onPay} disabled={loading}>
        {loading
          ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, display: 'inline-block', marginRight: 8 }} />Bağlanıyor...</>
          : <><CreditCard size={16} /> Güvenli Ödeme Yap — {displayPrice}</>}
      </button>

      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <img src="https://www.paytr.com/img/general/PayTR-Odeme-Altyapisi.svg" alt="PayTR" style={{ height: 28, opacity: 0.7 }} referrerPolicy="no-referrer" />
      </div>
    </>
  );
}

function PaytrModal({ title, icon, onClose, iframeToken, iframeRef, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{
        width: '100%', maxWidth: iframeToken ? 680 : 480,
        background: 'var(--bg-card)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', maxHeight: '95vh', overflow: 'hidden',
        transition: 'max-width 0.2s ease'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            {icon} {title}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', alignItems: 'center' }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {iframeToken ? (
            <iframe
              ref={iframeRef}
              src={`https://www.paytr.com/odeme/guvenli/${iframeToken}`}
              id="paytriframe"
              style={{ width: '100%', minHeight: 520, display: 'block', border: 'none', overflow: 'hidden' }}
            />
          ) : (
            <div style={{ padding: 24 }}>{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}
