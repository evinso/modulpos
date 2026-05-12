import { useState, useEffect } from 'react';
import { Plus, Trash2, CheckCircle, Bot, Eye, EyeOff } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const TABS = ['Otomatik Yanıt Kuralları', 'AI Ayarları'];

export default function QuestionsAdminPage() {
  const [tab, setTab] = useState(0);

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

  useEffect(() => { if (tab === 0) fetchRules(); else fetchAiSettings(); }, [tab]);

  const fetchRules = async () => {
    setRulesLoading(true);
    try {
      const res = await api.get('/questions/admin/rules');
      setRules(res.data);
    } catch { toast.error('Kurallar yüklenemedi'); }
    finally { setRulesLoading(false); }
  };

  const openRuleForm = (rule = null) => {
    if (rule) {
      setEditingRule(rule);
      setRuleForm({ name: rule.name, keywords: JSON.parse(rule.keywords).join(', '), replyTemplate: rule.replyTemplate, priority: rule.priority });
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
        await api.put(`/questions/admin/rules/${editingRule.id}`, payload);
        toast.success('Kural güncellendi');
      } else {
        await api.post('/questions/admin/rules', payload);
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
      await api.put(`/questions/admin/rules/${rule.id}`, { isActive: !rule.isActive });
      fetchRules();
    } catch { toast.error('Güncelleme hatası'); }
  };

  const handleDeleteRule = async (id) => {
    if (!confirm('Bu kuralı silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/questions/admin/rules/${id}`);
      toast.success('Kural silindi');
      fetchRules();
    } catch { toast.error('Silme hatası'); }
  };

  const fetchAiSettings = async () => {
    try {
      const res = await api.get('/questions/admin/ai-settings');
      setAiSettings(res.data);
    } catch {}
  };

  const handleSaveAi = async (e) => {
    e.preventDefault();
    setSavingAi(true);
    try {
      await api.put('/questions/admin/ai-settings', { apiKey: aiKey || null });
      toast.success(aiKey ? 'AI API anahtarı kaydedildi' : 'AI API anahtarı kaldırıldı');
      setAiKey('');
      fetchAiSettings();
    } catch { toast.error('Kaydetme hatası'); }
    finally { setSavingAi(false); }
  };

  return (
    <div>
      <div className="page-title">
        <h1>Müşteri Soru Yönetimi (Admin)</h1>
        <p>Otomatik yanıt kuralları ve AI ayarlarını yönetin. Verilen her yanıt krediden düşülür.</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid var(--border-color)', paddingBottom: 0 }}>
        {TABS.map((t, i) => (
          <button key={i} onClick={() => setTab(i)} style={{ padding: '10px 18px', background: 'none', border: 'none', borderBottom: tab === i ? '2px solid var(--accent-primary)' : '2px solid transparent', color: tab === i ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: tab === i ? 600 : 400, cursor: 'pointer', fontSize: 14, marginBottom: -1 }}>
            {t}
          </button>
        ))}
      </div>

      {/* TAB 0: KURALLAR */}
      {tab === 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
              Global kurallar — tüm mağazalara uygulanır. Anahtar kelime eşleşince şablon yanıt gönderilir.
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
                  <textarea className="form-input" rows={3} value={ruleForm.replyTemplate} onChange={e => setRuleForm({ ...ruleForm, replyTemplate: e.target.value })} placeholder="Kargonuz 1-3 iş günü içinde teslim edilecektir..." required />
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

      {/* TAB 1: AI AYARLARI */}
      {tab === 1 && (
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
                <button type="button" className="btn btn-danger" disabled={savingAi} onClick={async () => { setSavingAi(true); await api.put('/questions/admin/ai-settings', { apiKey: null }); toast.success('AI devre dışı bırakıldı'); fetchAiSettings(); setSavingAi(false); }}>Kaldır</button>
              )}
            </div>
          </form>

          <div style={{ marginTop: 24, padding: '14px 16px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            <strong>Çalışma mantığı:</strong>
            <ol style={{ margin: '8px 0 0 0', paddingLeft: 18, lineHeight: 1.8 }}>
              <li>Kural eşleşirse → şablon yanıt direkt gönderilir (1 kredi)</li>
              <li>Kural eşleşmezse + AI aktifse → Claude Haiku yanıt üretir ve gönderir (1 kredi)</li>
              <li>Kural yok + AI kapalıysa → soru "bekliyor" olarak kalır, manuel yanıt beklenir</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
