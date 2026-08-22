import { useState, useEffect } from 'react';
import { RefreshCw, Send, CheckCircle, Clock, Bot, Wallet } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function QuestionsPage() {
  const [questions, setQuestions] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [creditBalance, setCreditBalance] = useState(null);
  const [autoReplyCost, setAutoReplyCost] = useState(null);

  const [answerModal, setAnswerModal] = useState(null);
  const [answerText, setAnswerText] = useState('');
  const [answering, setAnswering] = useState(false);

  useEffect(() => {
    fetchQuestions();
    fetchCreditInfo();
  }, []);

  useEffect(() => { fetchQuestions(); }, [pagination.page, filterStatus]);

  const fetchCreditInfo = async () => {
    try {
      const [balRes, priceRes] = await Promise.all([
        api.get('/credits/balance'),
        api.get('/credits/prices')
      ]);
      setCreditBalance(balRes.data.balance);
      setAutoReplyCost(priceRes.data.autoReplyCost ?? null);
    } catch {}
  };

  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const params = { page: pagination.page, limit: 20 };
      if (filterStatus) params.status = filterStatus;
      const res = await api.get('/questions', { params });
      setQuestions(res.data.questions);
      setPagination(p => ({ ...p, total: res.data.pagination.total, totalPages: res.data.pagination.totalPages }));
    } catch { toast.error('Sorular yüklenemedi'); }
    finally { setLoading(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.post('/questions/sync');
      toast.success(`${res.data.synced} yeni soru çekildi, ${res.data.autoAnswered} otomatik yanıtlandı`);
      fetchQuestions();
      fetchCreditInfo();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Senkronizasyon hatası');
    } finally { setSyncing(false); }
  };

  const handleAnswer = async (e) => {
    e.preventDefault();
    if (!answerText.trim()) return;
    setAnswering(true);
    try {
      await api.post(`/questions/${answerModal.id}/answer`, { answerText });
      toast.success('Yanıt gönderildi');
      setAnswerModal(null);
      setAnswerText('');
      fetchQuestions();
      fetchCreditInfo();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Yanıt gönderilemedi');
    } finally { setAnswering(false); }
  };

  const pendingCount = questions.filter(q => q.status === 'pending').length;
  const answeredCount = questions.filter(q => q.status === 'answered').length;

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Müşteri Soruları</h1>
          <p>Trendyol'dan gelen soruları görüntüleyin ve yanıtlayın</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {creditBalance !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 14px', fontSize: 13 }}>
              <Wallet size={14} style={{ color: 'var(--accent-primary)' }} />
              <span style={{ color: 'var(--text-secondary)' }}>Bakiye:</span>
              <strong>{creditBalance.toFixed(1)} kredi</strong>
              {autoReplyCost > 0 && (
                <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 4 }}>· yanıt başı {autoReplyCost} kredi</span>
              )}
            </div>
          )}
        </div>
        <button className="btn btn-primary" onClick={handleSync} disabled={syncing} style={{ padding: '10px 24px' }}>
          <RefreshCw size={16} className={syncing ? 'spin' : ''} />
          {syncing ? 'Senkronize ediliyor...' : 'Trendyol\'dan Çek'}
        </button>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 20, gap: 12 }}>
        <div className="card" style={{ padding: 16, cursor: 'pointer', border: filterStatus === '' ? '2px solid var(--accent-primary)' : undefined }} onClick={() => setFilterStatus('')}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Toplam</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{pagination.total}</div>
        </div>
        <div className="card" style={{ padding: 16, cursor: 'pointer', border: filterStatus === 'pending' ? '2px solid var(--warning)' : undefined }} onClick={() => setFilterStatus('pending')}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Bekleyen</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--warning)' }}>{pendingCount}</div>
        </div>
        <div className="card" style={{ padding: 16, cursor: 'pointer', border: filterStatus === 'answered' ? '2px solid var(--success)' : undefined }} onClick={() => setFilterStatus('answered')}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Yanıtlanan</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{answeredCount}</div>
        </div>
      </div>

      {loading ? <div className="loading-spinner"><div className="spinner"></div></div> : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Soru</th>
                <th>Tarih</th>
                <th style={{ textAlign: 'center' }}>Durum</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {questions.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Soru bulunamadı. "Trendyol'dan Çek" butonuna basın.</td></tr>
              ) : questions.map(q => (
                <tr key={q.id}>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 160 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.productTitle || '—'}</div>
                  </td>
                  <td style={{ maxWidth: 320 }}>
                    <div style={{ fontSize: 13 }}>{q.questionText}</div>
                    {q.answerText && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                        {q.autoAnswered && <Bot size={12} style={{ color: 'var(--accent-primary)', marginTop: 2, flexShrink: 0 }} />}
                        <span style={{ fontStyle: 'italic' }}>{q.answerText}</span>
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {new Date(q.askedAt).toLocaleDateString('tr-TR')}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {q.status === 'answered'
                      ? <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle size={11} /> {q.autoAnswered ? 'Otomatik' : 'Manuel'}</span>
                      : <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={11} /> Bekliyor</span>}
                  </td>
                  <td>
                    {q.status === 'pending' && (
                      <button className="btn btn-primary btn-sm" onClick={() => { setAnswerModal(q); setAnswerText(''); }}>
                        <Send size={13} /> Yanıtla
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagination.totalPages > 1 && (
            <div className="pagination">
              <button disabled={pagination.page <= 1} onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}>Önceki</button>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{pagination.page} / {pagination.totalPages}</span>
              <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}>Sonraki</button>
            </div>
          )}
        </div>
      )}

      {answerModal && (
        <div className="modal-overlay" onClick={() => setAnswerModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3>Soruyu Yanıtla</h3>
              <button className="modal-close" onClick={() => setAnswerModal(null)}>×</button>
            </div>
            <form onSubmit={handleAnswer}>
              <div className="modal-body">
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
                  {answerModal.productTitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{answerModal.productTitle}</div>}
                  <div style={{ fontSize: 14 }}>{answerModal.questionText}</div>
                </div>
                <div className="form-group">
                  <label className="form-label">Yanıtınız *</label>
                  <textarea className="form-input" rows={4} value={answerText} onChange={e => setAnswerText(e.target.value)} placeholder="En az 10 karakter..." required minLength={10} maxLength={2000} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{answerText.length} / 2000</span>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setAnswerModal(null)}>İptal</button>
                <button type="submit" className="btn btn-primary" disabled={answering}>{answering ? 'Gönderiliyor...' : 'Gönder'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
