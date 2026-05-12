import { useState, useEffect } from 'react';
import { MessageSquare, RefreshCw, Send, Plus, Trash2, CheckCircle, Clock, Bot, Settings, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const TABS = ['Sorular', 'Otomatik Yanıt Kuralları', 'AI Ayarları'];

export default function QuestionsPage() {
  const [tab, setTab] = useState(0);
  const [questions, setQuestions] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Manual answer
  const [answerModal, setAnswerModal] = useState(null);
  const [answerText, setAnswerText] = useState('');
  const [answering, setAnswering] = useState(false);

  // Rules
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [ruleForm, setRuleForm] = useState({ name: '', keywords: '', replyTemplate: '', priority: 0 });
  const [editingRule, setEditingRule] = useState(null);
  const [savingRule, setSavingRule] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);

  // AI settings
  const [aiSettings, setAiSettings] = useState({ configured: false, keyPreview: null });
  const [aiKey, setAiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savingAi, setSavingAi] = useState(false);

  useEffect(() => { fetchQuestions(); }, [pagination.page, filterStatus]);
  useEffect(() => { if (tab === 1) fetchRules(); if (tab === 2) fetchAiSettings(); }, [tab]);

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
    } catch (err) {
      toast.error(err.response?.data?.error || 'Yanıt gönderilemedi');
    } finally { setAnswering(false); }
  };

  const fetchRules = async () => {
    setRulesLoading(true);
    try {
      const res = await api.get('/questions/rules');
      setRules(res.data);
    } catch { toast.error('Kurallar yüklenemedi'); }
    finally { setRulesLoading(false); }
  };

  const openRuleForm = (rule = null) => {
    if (rule) {
      setEditingRule(rule);
      setRuleForm({
        name: rule.name,
        keywords: JSON.parse(rule.keywords).join(', '),
        replyTemplate: rule.replyTemplate,
        priority: rule.priority,
      });
    } else {
      setEditingRule(null);
      setRuleForm({ name: '', keywords: '', replyTemplate: '', priority: 0 });
    }
    setShowRuleForm(true);
  };

  const handleSaveRule = async (e) => {
    e.preventDefault();
    const keywords = ruleForm.keywords.split(',').map(k => k.trim()).filter(Boolean);
    if (!ruleForm.name || !keywords.length || !ruleForm.replyTemplate) {
      toast.error('Ad, anahtar kelimeler ve yanıt şablonu zorunludur');
      return;
    }
    setSavingRule(true);
    try {
      const payload = { name: ruleForm.name, keywords, replyTemplate: ruleForm.replyTemplate, priority: parseInt(ruleForm.priority) || 0 };
      if (editingRule) {
        await api.put(`/questions/rules/${editingRule.id}`, payload);
        toast.success('Kural güncellendi');
      } else {
        await api.post('/questions/rules', payload);
        toast.success('Kural eklendi');
      }
      setShowRuleForm(false);
      fetchRules();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Kaydetme hatası');
    } finally { setSavingRule(false); }
  };

  const handleToggleRule = async (rule) => {
    try {
      await api.put(`/questions/rules/${rule.id}`, { isActive: !rule.isActive });
      fetchRules();
    } catch { toast.error('Güncelleme hatası'); }
  };

  const handleDeleteRule = async (id) => {
    if (!confirm('Bu kuralı silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/questions/rules/${id}`);
      toast.success('Kural silindi');
      fetchRules();
    } catch { toast.error('Silme hatası'); }
  };

  const fetchAiSettings = async () => {
    try {
      const res = await api.get('/questions/ai-settings');
      setAiSettings(res.data);
    } catch {}
  };

  const handleSaveAi = async (e) => {
    e.preventDefault();
    setSavingAi(true);
    try {
      await api.put('/questions/ai-settings', { apiKey: aiKey || null });
      toast.success(aiKey ? 'AI API anahtarı kaydedildi' : 'AI API anahtarı kaldırıldı');
      setAiKey('');
      fetchAiSettings();
    } catch { toast.error('Kaydetme hatası'); }
    finally { setSavingAi(false); }
  };

  const pendingCount = questions.filter(q => q.status === 'pending').length;
  const answeredCount = questions.filter(q => q.status === 'answered').length;

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Müşteri Soruları</h1>
          <p>Trendyol'dan gelen soruları yönetin ve otomatik yanıt kuralları tanımlayın</p>
        </div>
        <button className="btn btn-primary" onClick={handleSync} disabled={syncing} style={{ padding: '10px 24px' }}>
          <RefreshCw size={16} className={syncing ? 'spin' : ''} />
          {syncing ? 'Senkronize ediliyor...' : 'Trendyol\'dan Çek'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid var(--border-color)', paddingBottom: 0 }}>
        {TABS.map((t, i) => (
          <button key={i} onClick={() => setTab(i)} style={{ padding: '10px 18px', background: 'none', border: 'none', borderBottom: tab === i ? '2px solid var(--accent-primary)' : '2px solid transparent', color: tab === i ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: tab === i ? 600 : 400, cursor: 'pointer', fontSize: 14, marginBottom: -1 }}>
            {t}
          </button>
        ))}
      </div>

      {/* ── TAB 0: SORULAR ── */}
      {tab === 0 && (
        <>
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
        </>
      )}

      {/* ── TAB 1: KURALLAR ── */}
      {tab === 1 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
              Anahtar kelime eşleşince otomatik yanıt gönderilir. Öncelik büyükten küçüğe kontrol edilir.
            </p>
            <button className="btn btn-primary" onClick={() => openRuleForm()}><Plus size={15} /> Kural Ekle</button>
          </div>

          {showRuleForm && (
            <div className="card" style={{ marginBottom: 20, padding: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{editingRule ? 'Kuralı Düzenle' : 'Yeni Kural'}</h3>
              <form onSubmit={handleSaveRule}>
                <div className="grid grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Kural Adı *</label>
                    <input className="form-input" value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="örn. Kargo Soruları" required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Öncelik</label>
                    <input type="number" className="form-input" value={ruleForm.priority} onChange={e => setRuleForm({ ...ruleForm, priority: e.target.value })} placeholder="0" />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Büyük = önce kontrol edilir</span>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Anahtar Kelimeler * <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(virgülle ayırın)</span></label>
                  <input className="form-input" value={ruleForm.keywords} onChange={e => setRuleForm({ ...ruleForm, keywords: e.target.value })} placeholder="kargo, teslimat, ne zaman gelir" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Yanıt Şablonu * <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(10-2000 karakter)</span></label>
                  <textarea className="form-input" rows={3} value={ruleForm.replyTemplate} onChange={e => setRuleForm({ ...ruleForm, replyTemplate: e.target.value })} placeholder="Kargonuz 1-3 iş günü içinde teslim edilecektir. Takip numaranızı kargo firmasının sitesinden sorgulayabilirsiniz." required />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ruleForm.replyTemplate.length} / 2000</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={savingRule}>{savingRule ? 'Kaydediliyor...' : 'Kaydet'}</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowRuleForm(false)}>İptal</button>
                </div>
              </form>
            </div>
          )}

          {rulesLoading ? <div className="loading-spinner"><div className="spinner"></div></div> : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Kural Adı</th>
                    <th>Anahtar Kelimeler</th>
                    <th>Yanıt Şablonu</th>
                    <th style={{ textAlign: 'center' }}>Öncelik</th>
                    <th style={{ textAlign: 'center' }}>Eşleşme</th>
                    <th style={{ textAlign: 'center' }}>Durum</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Henüz kural yok. "Kural Ekle" butonuna basın.</td></tr>
                  ) : rules.map(r => {
                    let kws = [];
                    try { kws = JSON.parse(r.keywords); } catch {}
                    return (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {kws.map(k => <span key={k} style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--accent-primary)', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontFamily: 'monospace' }}>{k}</span>)}
                          </div>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 260 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.replyTemplate}</div>
                        </td>
                        <td style={{ textAlign: 'center', fontSize: 13 }}>{r.priority}</td>
                        <td style={{ textAlign: 'center', fontSize: 13 }}>{r.matchCount}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button onClick={() => handleToggleRule(r)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                            {r.isActive
                              ? <span className="badge badge-success">Aktif</span>
                              : <span className="badge" style={{ background: 'rgba(148,163,184,0.15)', color: 'var(--text-muted)' }}>Pasif</span>}
                          </button>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => openRuleForm(r)}>Düzenle</button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDeleteRule(r.id)}><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── TAB 2: AI AYARLARI ── */}
      {tab === 2 && (
        <div className="card" style={{ maxWidth: 560, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <Bot size={22} style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>Claude AI ile Otomatik Yanıt</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Kural eşleşmeyen sorular için AI yanıt üretir ve doğrudan Trendyol'a gönderir</p>
            </div>
          </div>

          {aiSettings.configured && (
            <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid var(--success)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={15} style={{ color: 'var(--success)' }} />
              <span>API anahtarı kayıtlı: <strong>{aiSettings.keyPreview}</strong></span>
            </div>
          )}

          <form onSubmit={handleSaveAi}>
            <div className="form-group">
              <label className="form-label">{aiSettings.configured ? 'API Anahtarını Değiştir' : 'Anthropic API Anahtarı'}</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input"
                  type={showKey ? 'text' : 'password'}
                  value={aiKey}
                  onChange={e => setAiKey(e.target.value)}
                  placeholder={aiSettings.configured ? 'Yeni anahtar girin (değiştirmek için)' : 'sk-ant-...'}
                  style={{ paddingRight: 40 }}
                />
                <button type="button" onClick={() => setShowKey(v => !v)} style={{ position: 'absolute', right: 10, top: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
                Anthropic Console'dan alabilirsiniz. Kural eşleşmezse claude-haiku ile yanıt üretilir.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={savingAi || !aiKey}>{savingAi ? 'Kaydediliyor...' : 'Kaydet'}</button>
              {aiSettings.configured && (
                <button type="button" className="btn btn-danger" disabled={savingAi} onClick={async () => { setSavingAi(true); await api.put('/questions/ai-settings', { apiKey: null }); toast.success('AI devre dışı bırakıldı'); fetchAiSettings(); setSavingAi(false); }}>Kaldır</button>
              )}
            </div>
          </form>

          <div style={{ marginTop: 24, padding: '14px 16px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            <strong>Çalışma mantığı:</strong>
            <ol style={{ margin: '8px 0 0 0', paddingLeft: 18, lineHeight: 1.8 }}>
              <li>Kural eşleşirse → şablon yanıt direkt gönderilir</li>
              <li>Kural eşleşmezse + AI aktifse → Claude Haiku yanıt üretir ve gönderir</li>
              <li>Kural yok + AI kapalıysa → soru "bekliyor" olarak kalır, manuel yanıt beklenir</li>
            </ol>
          </div>
        </div>
      )}

      {/* Manual answer modal */}
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
