import React, { useState, useEffect } from 'react';
import { Wallet, ArrowUpRight, ArrowDownRight, Clock, TrendingUp, CreditCard, RefreshCw } from 'lucide-react';
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
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(true);

  // Payment states
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [purchaseAmount, setPurchaseAmount] = useState('50');
  const [iframeToken, setIframeToken] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);

  useEffect(() => {
    fetchData();
    
    // Check URL for payment status
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    if (paymentStatus === 'success') {
      toast.success('Ödemeniz başarıyla alındı ve krediniz hesabınıza yüklendi!');
      // Clean url
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (paymentStatus === 'fail') {
      toast.error('Ödeme işlemi başarısız oldu veya iptal edildi.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const fetchData = async () => {
    try {
      const [balRes, txRes, priceRes] = await Promise.all([
        api.get('/credits/balance'),
        api.get('/credits/transactions'),
        api.get('/credits/prices')
      ]);
      setBalance(balRes.data.balance);
      setTransactions(txRes.data);
      setPrices(priceRes.data);
    } catch (err) {
      toast.error('Kredi bilgileri yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  const handleStartPayment = async () => {
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

  // PayTR Script injection when token is received
  useEffect(() => {
    if (iframeToken) {
      const script = document.createElement('script');
      script.src = `https://www.paytr.com/js/iframeResizer.min.js`;
      script.async = true;
      document.body.appendChild(script);
      
      script.onload = () => {
        if (window.iFrameResize) {
           window.iFrameResize({}, '#paytriframe');
        }
      }

      return () => {
        if (document.body.contains(script)) {
          document.body.removeChild(script);
        }
      }
    }
  }, [iframeToken]);

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Kredi & Bakiye</h1>
          <p>Bakiyenizi görüntüleyin ve işlem geçmişinizi takip edin</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setPaymentModalOpen(true); setIframeToken(null); setPurchaseAmount('50'); }}>
          <Wallet size={16} /> Kredi Satın Al
        </button>
      </div>

      {/* Balance Card */}
      <div className="grid grid-3" style={{ marginBottom: 24 }}>
        <div className="card" style={{
          background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))',
          border: '1px solid rgba(59,130,246,0.25)',
          position: 'relative', overflow: 'hidden'
        }}>
          <div style={{
            position: 'absolute', top: -20, right: -20, width: 100, height: 100,
            borderRadius: '50%', background: 'rgba(59,130,246,0.08)'
          }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Wallet size={22} style={{ color: 'var(--accent-primary)' }} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Mevcut Bakiye</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>
                {balance.toFixed(2)} <span style={{ fontSize: 16, color: 'var(--text-muted)' }}>Kredi</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'rgba(251,146,60,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <CreditCard size={20} style={{ color: '#fb923c' }} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>XML İçe Aktarma</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{prices.xmlImportDefaultCost || 0} Kredi</div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Hazır XML Market'ten her bir içe aktarma işlemi</p>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'rgba(96,165,250,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <RefreshCw size={20} style={{ color: '#60a5fa' }} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>XML Dönüştürme</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{prices.xmlConvertCost || 0} Kredi</div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Her bir XML dönüştürme/önizleme işlemi</p>
        </div>
      </div>

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
                      <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                        {tx.description || '-'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          color: isPositive ? 'var(--success)' : 'var(--danger)'
                        }}>
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

      {/* Payment Modal */}
      {paymentModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 500, padding: 0, background: 'var(--bg-primary)', overflow: 'hidden' }}>
            <div className="table-header" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Wallet size={18} style={{ color: 'var(--accent-primary)' }} />
                Kredi Yükle
              </h3>
              <button className="text-btn" onClick={() => setPaymentModalOpen(false)}>Kapat</button>
            </div>
            
            <div style={{ padding: 20 }}>
              {!iframeToken ? (
                <>
                  <div className="form-group" style={{ marginBottom: 16 }}>
                    <label className="form-label">Yüklenecek Tutar (TL)</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="number"
                        className="form-input"
                        min="10"
                        step="10"
                        value={purchaseAmount}
                        onChange={e => setPurchaseAmount(e.target.value)}
                        placeholder="Örn: 50"
                        style={{ fontSize: 18, fontWeight: 600, paddingRight: 40 }}
                        autoFocus
                      />
                      <span style={{ position: 'absolute', right: 12, top: 12, color: 'var(--text-muted)', fontWeight: 600 }}>TL</span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginTop: 8 }}>
                      1 TL = 1 Kredi olarak hesabınıza yansıyacaktır. Minimum 10 TL yükleyebilirsiniz.
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                    <button className="btn btn-secondary" onClick={() => setPaymentModalOpen(false)}>İptal</button>
                    <button className="btn btn-primary" onClick={handleStartPayment} disabled={paymentLoading}>
                      {paymentLoading ? 'Bağlanıyor...' : 'Güvenli Ödeme Yap'}
                    </button>
                  </div>
                  
                  <div style={{ marginTop: 24, textAlign: 'center' }}>
                    <img src="https://www.paytr.com/img/general/PayTR-Odeme-Altyapisi.svg" alt="PayTR" style={{ height: 30, opacity: 0.8 }} />
                  </div>
                </>
              ) : (
                <div style={{ width: '100%' }}>
                  <iframe 
                    src={`https://www.paytr.com/odeme/guvenli/${iframeToken}`} 
                    id="paytriframe" 
                    frameBorder="0" 
                    scrolling="no" 
                    style={{ width: '100%', minHeight: '550px' }}
                  ></iframe>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
