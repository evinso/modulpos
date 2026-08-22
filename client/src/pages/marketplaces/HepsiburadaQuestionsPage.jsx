import { useState, useEffect } from 'react';
import { RefreshCw, Send, AlertTriangle, MessageSquare, CheckCircle, Clock, XCircle, Package } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const TABS = [
  { key: 'pending',  label: 'Bekleyen',          status: undefined, color: 'var(--warning)' },
  { key: 'answered', label: 'Cevaplanan',         status: 2,         color: 'var(--success)' },
  { key: 'closed',   label: 'Süresi Dolan',       status: 4,         color: 'var(--text-muted)' },
  { key: 'rejected', label: 'Sorun Bildirilmiş',  status: 3,         color: 'var(--danger, #ef4444)' },
];

function formatExpire(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  const diffH = Math.round((d - now) / 36e5);
  if (diffH < 0) return { label: 'Süresi doldu', urgent: true };
  if (diffH < 24) return { label: `${diffH} saat kaldı`, urgent: true };
  const diffD = Math.floor(diffH / 24);
  return { label: `${diffD} gün kaldı`, urgent: false };
}

export default function HepsiburadaQuestionsPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [counts, setCounts] = useState({});
  const [activeTab, setActiveTab] = useState('pending');
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState(0);
  const [answerModal, setAnswerModal] = useState(null);
  const [answerText, setAnswerText] = useState('');
  const [answering, setAnswering] = useState(false);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => { fetchConnections(); }, []);
  useEffect(() => {
    if (selectedConn) { fetchQuestions(); fetchCounts(); }
  }, [selectedConn, activeTab, page, sortBy]);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const hb = res.data.filter(c => c.marketplaceType === 'hepsiburada');
      setConnections(hb);
      if (hb.length > 0) setSelectedConn(hb[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const fetchQuestions = async () => {
    if (!selectedConn) return;
    setFetching(true);
    try {
      const tab = TABS.find(t => t.key === activeTab);
      const params = { sortBy, page, size: 20 };
      if (tab.status !== undefined) params.status = tab.status;
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/hepsiburada-questions`, { params });
      const data = res.data;
      const items = data?.items || data?.data || data?.issues || (Array.isArray(data) ? data : []);
      setQuestions(items);
      const total = data?.totalCount || data?.total || items.length;
      setTotalPages(Math.max(1, Math.ceil(total / 20)));
    } catch (err) {
      toast.error('Sorular yüklenemedi: ' + (err.response?.data?.error || err.message));
    } finally { setFetching(false); }
  };

  const fetchCounts = async () => {
    if (!selectedConn) return;
    try {
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/hepsiburada-questions/count`);
      setCounts(res.data || {});
    } catch {}
  };

  const switchTab = (key) => {
    setActiveTab(key);
    setPage(0);
  };

  const handleAnswer = async (e) => {
    e.preventDefault();
    if (!answerText.trim()) return;
    setAnswering(true);
    try {
      const num = answerModal.issueNumber || answerModal.number || answerModal.id;
      await api.post(`/marketplace/connections/${selectedConn.id}/hepsiburada-questions/${num}/answer`, { answerText });
      toast.success('Yanıt gönderildi');
      setAnswerModal(null);
      setAnswerText('');
      fetchQuestions();
      fetchCounts();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Yanıt gönderilemedi');
    } finally { setAnswering(false); }
  };

  const handleReject = async (e) => {
    e.preventDefault();
    if (!rejectReason.trim()) return;
    setRejecting(true);
    try {
      const num = rejectModal.issueNumber || rejectModal.number || rejectModal.id;
      await api.post(`/marketplace/connections/${selectedConn.id}/hepsiburada-questions/${num}/reject`, { rejectReason });
      toast.success('Sorun bildirildi');
      setRejectModal(null);
      setRejectReason('');
      fetchQuestions();
      fetchCounts();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Sorun bildirilemedi');
    } finally { setRejecting(false); }
  };

  const getCountForTab = (tabKey) => {
    const map = {
      pending:  counts.waitingForAnswer ?? counts.waiting ?? counts.WaitingForAnswer,
      answered: counts.answered ?? counts.Answered,
      closed:   counts.autoClosed ?? counts.AutoClosed,
      rejected: counts.rejected ?? counts.Rejected,
    };
    return map[tabKey] ?? '—';
  };

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  if (connections.length === 0) {
    return (
      <div>
        <div className="page-title"><h1>Hepsiburada — Müşteri Soruları</h1></div>
        <div className="card">
          <div className="empty-state">
            <Package size={48} className="empty-icon" />
            <h3>Hepsiburada bağlantısı bulunamadı</h3>
            <p>Lütfen önce <a href="/marketplace" style={{ color: '#ff6000' }}>Pazaryeri Bağlantıları</a> sayfasından Hepsiburada hesabınızı ekleyin.</p>
          </div>
        </div>
      </div>
    );
  }

  const isPending = activeTab === 'pending';

  return (
    <div>
      {/* Header */}
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Hepsiburada — Müşteri Soruları</h1>
          <p>Müşterilerin sorularını görüntüleyin, yanıtlayın veya sorun bildirin</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {connections.length > 1 && (
            <select className="form-select" style={{ width: 200 }} value={selectedConn?.id || ''}
              onChange={e => { setSelectedConn(connections.find(c => c.id === e.target.value)); setPage(0); }}>
              {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
            </select>
          )}
          <select className="form-select" style={{ width: 180 }} value={sortBy} onChange={e => setSortBy(parseInt(e.target.value))}>
            <option value={0}>Soru Tarihine Göre</option>
            <option value={1}>Son Güncellemeye Göre</option>
          </select>
          <button className="btn btn-secondary" onClick={() => { fetchQuestions(); fetchCounts(); }} disabled={fetching}>
            <RefreshCw size={15} className={fetching ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {/* Info box */}
      <div style={{ background: 'rgba(255,96,0,0.08)', border: '1px solid rgba(255,96,0,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <AlertTriangle size={14} style={{ color: '#ff6000', flexShrink: 0, marginTop: 1 }} />
        <span>Bekleyen sorular <strong>2 iş günü</strong> içinde cevaplanmalıdır. Süre dolan sorular otomatik kapatılır.</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid var(--border-color)' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            style={{
              padding: '10px 18px', fontSize: 13, fontWeight: activeTab === tab.key ? 600 : 400,
              border: 'none', background: 'none', cursor: 'pointer',
              color: activeTab === tab.key ? tab.color : 'var(--text-secondary)',
              borderBottom: activeTab === tab.key ? `2px solid ${tab.color}` : '2px solid transparent',
              marginBottom: -1,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {tab.label}
            <span style={{ fontSize: 11, background: activeTab === tab.key ? tab.color : 'var(--bg-tertiary)', color: activeTab === tab.key ? '#fff' : 'var(--text-muted)', borderRadius: 10, padding: '1px 7px', fontWeight: 600 }}>
              {getCountForTab(tab.key)}
            </span>
          </button>
        ))}
      </div>

      {/* Questions list */}
      {fetching ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : questions.length === 0 ? (
        <div className="card">
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <MessageSquare size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div>Bu kategoride soru bulunmuyor</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {questions.map((q, i) => {
            const num = q.issueNumber || q.number || q.id || i;
            const questionText = q.question || q.questionText || q.text || '—';
            const answerTextVal = q.answer || q.answerText || null;
            const productName = q.productName || q.product?.name || q.sku || null;
            const askedAt = q.createdAt || q.questionDate || q.date || null;
            const expireDate = q.expireDate || q.expiredDate || null;
            const expireInfo = formatExpire(expireDate);

            return (
              <div key={num} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    {productName && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                        {productName}
                      </div>
                    )}
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: answerTextVal ? 8 : 0 }}>{questionText}</div>
                    {answerTextVal && (
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, borderLeft: '3px solid #ff6000', marginTop: 6 }}>
                        {answerTextVal}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    {askedAt && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(askedAt).toLocaleDateString('tr-TR')}
                      </div>
                    )}
                    {isPending && expireInfo && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: expireInfo.urgent ? 'var(--danger, #ef4444)' : 'var(--warning)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={11} /> {expireInfo.label}
                      </div>
                    )}
                    {!isPending && (
                      <div style={{ fontSize: 11, color: TABS.find(t => t.key === activeTab)?.color }}>
                        {activeTab === 'answered' && <><CheckCircle size={12} style={{ marginRight: 3 }} />Cevaplandı</>}
                        {activeTab === 'closed' && <><Clock size={12} style={{ marginRight: 3 }} />Süresi Doldu</>}
                        {activeTab === 'rejected' && <><XCircle size={12} style={{ marginRight: 3 }} />Sorun Bildirildi</>}
                      </div>
                    )}
                  </div>
                </div>

                {isPending && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
                    <button className="btn btn-primary btn-sm" onClick={() => { setAnswerModal(q); setAnswerText(''); }}>
                      <Send size={13} /> Yanıtla
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setRejectModal(q); setRejectReason(''); }}
                      style={{ color: 'var(--danger, #ef4444)', borderColor: 'var(--danger, #ef4444)' }}
                    >
                      <XCircle size={13} /> Sorun Bildir
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" disabled={page <= 0} onClick={() => setPage(p => p - 1)}>Önceki</button>
          <span style={{ padding: '6px 12px', fontSize: 13, color: 'var(--text-secondary)' }}>{page + 1} / {totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Sonraki</button>
        </div>
      )}

      {/* Answer Modal */}
      {answerModal && (
        <div className="modal-overlay" onClick={() => setAnswerModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3>Soruyu Yanıtla</h3>
              <button className="modal-close" onClick={() => setAnswerModal(null)}>×</button>
            </div>
            <form onSubmit={handleAnswer}>
              <div className="modal-body">
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 14 }}>
                  {(answerModal.productName || answerModal.product?.name) && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{answerModal.productName || answerModal.product?.name}</div>
                  )}
                  {answerModal.question || answerModal.questionText || answerModal.text}
                </div>
                <div className="form-group">
                  <label className="form-label">Yanıtınız *</label>
                  <textarea className="form-input" rows={4} value={answerText} onChange={e => setAnswerText(e.target.value)}
                    placeholder="Müşteriye gösterilecek yanıt..." required minLength={5} maxLength={2000} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{answerText.length} / 2000</span>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setAnswerModal(null)}>İptal</button>
                <button type="submit" className="btn btn-primary" disabled={answering}>
                  {answering ? <><RefreshCw size={14} className="spinning" /> Gönderiliyor...</> : <><Send size={14} /> Gönder</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <div className="modal-overlay" onClick={() => setRejectModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3>Sorun Bildir</h3>
              <button className="modal-close" onClick={() => setRejectModal(null)}>×</button>
            </div>
            <form onSubmit={handleReject}>
              <div className="modal-body">
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 8 }}>
                  <AlertTriangle size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
                  <span>Sorun bildirme sebebi <strong>Hepsiburada'ya</strong> iletilir, müşteriye gösterilmez.</span>
                </div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
                  {rejectModal.question || rejectModal.questionText || rejectModal.text}
                </div>
                <div className="form-group">
                  <label className="form-label">Sorun Sebebi *</label>
                  <textarea className="form-input" rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                    placeholder="Neden sorun bildiriyorsunuz? (Hepsiburada için)" required minLength={5} maxLength={500} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setRejectModal(null)}>İptal</button>
                <button type="submit" className="btn btn-danger" disabled={rejecting}
                  style={{ background: '#ef4444', color: '#fff', border: 'none' }}>
                  {rejecting ? 'Bildiriliyor...' : 'Sorun Bildir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
