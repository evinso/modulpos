import { useState, useEffect } from 'react';
import { Plus, Trash2, Ban, ToggleLeft, ToggleRight, Edit2, FlaskConical, Wand2 } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

/**
 * Yasaklı kelime / metin kuralları.
 * Kurallar XML'den ürün çekilirken başlık ve açıklamaya uygulanır; ‘Engelle’ kuralı
 * ürünü değiştirmez ama pazaryerine gönderilmesini engeller.
 */

const ACTIONS = [
  { key: 'replace', label: 'Başka kelimeyle değiştir' },
  { key: 'remove', label: 'Sil' },
  { key: 'block', label: 'Ürünü engelle (gönderme)' },
];
const FIELDS = [{ key: 'both', label: 'Başlık + açıklama' }, { key: 'title', label: 'Yalnızca başlık' }, { key: 'description', label: 'Yalnızca açıklama' }];
const MATCH = [{ key: 'word', label: 'Tam kelime' }, { key: 'contains', label: 'Kelimenin içinde geçsin' }];

const EMPTY = { pattern: '', replacement: '', action: 'replace', field: 'both', matchType: 'word', caseSensitive: false, note: '', isGlobal: false };

const actionLabel = (k) => ACTIONS.find((a) => a.key === k)?.label || k;
const fieldLabel = (k) => FIELDS.find((a) => a.key === k)?.label || k;

export default function ContentRulesPage() {
  const [own, setOwn] = useState([]);
  const [globalRules, setGlobalRules] = useState([]);
  const [canEditGlobal, setCanEditGlobal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const [testTitle, setTestTitle] = useState('');
  const [testDesc, setTestDesc] = useState('');
  const [testOut, setTestOut] = useState(null);

  const [applyInfo, setApplyInfo] = useState(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const res = await api.get('/content-rules');
      setOwn(res.data.own);
      setGlobalRules(res.data.global);
      setCanEditGlobal(res.data.canEditGlobal);
    } catch { toast.error('Kurallar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const reset = () => { setForm({ ...EMPTY }); setEditingId(null); };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/content-rules/${editingId}`, form);
        toast.success('Kural güncellendi');
      } else {
        // several words at once: one per line
        const words = form.pattern.split('\n').map((w) => w.trim()).filter(Boolean);
        if (words.length === 0) { toast.error('Kelime girin'); return; }
        for (const w of words) await api.post('/content-rules', { ...form, pattern: w });
        toast.success(words.length > 1 ? `${words.length} kural eklendi` : 'Kural eklendi');
      }
      reset();
      setApplyInfo(null);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Kaydedilemedi'); }
    finally { setSaving(false); }
  };

  const edit = (r) => {
    setEditingId(r.id);
    setForm({ pattern: r.pattern, replacement: r.replacement || '', action: r.action, field: r.field, matchType: r.matchType, caseSensitive: r.caseSensitive, note: r.note || '', isGlobal: r.storeId === null });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggle = async (r) => {
    try { await api.put(`/content-rules/${r.id}`, { isActive: !r.isActive }); setApplyInfo(null); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Güncellenemedi'); }
  };

  const remove = async (r) => {
    if (!window.confirm(`“${r.pattern}” kuralı silinsin mi?`)) return;
    try { await api.delete(`/content-rules/${r.id}`); setApplyInfo(null); load(); toast.success('Silindi'); }
    catch (err) { toast.error(err.response?.data?.error || 'Silinemedi'); }
  };

  const runTest = async () => {
    try { const res = await api.post('/content-rules/test', { title: testTitle, description: testDesc }); setTestOut(res.data); }
    catch { toast.error('Test yapılamadı'); }
  };

  const preview = async () => {
    setApplying(true);
    try { const res = await api.post('/content-rules/apply', { dryRun: true }); setApplyInfo(res.data); }
    catch { toast.error('Önizleme alınamadı'); }
    finally { setApplying(false); }
  };

  const applyNow = async () => {
    if (!window.confirm(`${applyInfo.willChange} ürünün başlık/açıklaması güncellenecek. Orijinal metinler korunur, kuralları silerek geri alabilirsiniz. Devam edilsin mi?`)) return;
    setApplying(true);
    try {
      const res = await api.post('/content-rules/apply', { dryRun: false });
      toast.success(`${res.data.willChange} ürün güncellendi`);
      setApplyInfo(null);
    } catch { toast.error('Uygulanamadı'); }
    finally { setApplying(false); }
  };

  const RuleTable = ({ rules, editable }) => (
    rules.length === 0 ? <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>Kural yok.</p> : (
      <div className="table-container">
        <table>
          <thead><tr><th>Kelime</th><th>Eylem</th><th>Alan</th><th>Eşleşme</th><th>Not</th><th>Durum</th>{editable && <th>İşlem</th>}</tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} style={{ opacity: r.isActive ? 1 : 0.5 }}>
                <td style={{ fontWeight: 600 }}>{r.pattern}{r.action === 'replace' && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> → {r.replacement || '(boş)'}</span>}</td>
                <td><span className={`badge ${r.action === 'block' ? 'badge-danger' : 'badge-primary'}`} style={{ fontSize: 11 }}>{actionLabel(r.action)}</span></td>
                <td style={{ fontSize: 12 }}>{fieldLabel(r.field)}</td>
                <td style={{ fontSize: 12 }}>{r.matchType === 'word' ? 'Tam kelime' : 'İçinde geçen'}{r.caseSensitive ? ' · büyük/küçük duyarlı' : ''}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.note || '—'}</td>
                <td>
                  {editable ? (
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: r.isActive ? 'var(--success)' : 'var(--text-muted)' }} onClick={() => toggle(r)}>
                      {r.isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                    </button>
                  ) : (r.isActive ? 'Aktif' : 'Pasif')}
                </td>
                {editable && (
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => edit(r)}><Edit2 size={14} /></button>
                    <button className="btn btn-danger btn-sm" onClick={() => remove(r)}><Trash2 size={14} /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  return (
    <div>
      <div className="page-title">
        <h1>Yasaklı Kelimeler</h1>
        <p>Pazaryerinin kabul etmediği kelimeleri ürün başlığı ve açıklamasında otomatik değiştirin, silin veya o ürünün gönderimini engelleyin.</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Ban size={18} /> {editingId ? 'Kuralı düzenle' : 'Yeni kural'}</h3>
        <form onSubmit={submit}>
          <div className="grid grid-2">
            <div className="form-group">
              <label className="form-label">{editingId ? 'Kelime *' : 'Kelime(ler) * — her satıra bir kelime'}</label>
              {editingId ? (
                <input className="form-input" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} required />
              ) : (
                <textarea className="form-input" rows={3} placeholder={'orijinal\nreplika\nücretsiz kargo'} value={form.pattern}
                  onChange={(e) => setForm({ ...form, pattern: e.target.value })} required />
              )}
            </div>
            <div>
              <div className="form-group">
                <label className="form-label">Ne yapılsın?</label>
                <select className="form-select" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
                  {ACTIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
              </div>
              {form.action === 'replace' && (
                <div className="form-group">
                  <label className="form-label">Yerine yazılacak</label>
                  <input className="form-input" placeholder="boş bırakırsanız kelime silinir" value={form.replacement}
                    onChange={(e) => setForm({ ...form, replacement: e.target.value })} />
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Nerede uygulansın?</label>
              <select className="form-select" value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })}>
                {FIELDS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Eşleşme türü</label>
              <select className="form-select" value={form.matchType} onChange={(e) => setForm({ ...form, matchType: e.target.value })}>
                {MATCH.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Not (isteğe bağlı)</label>
              <input className="form-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={form.caseSensitive} onChange={(e) => setForm({ ...form, caseSensitive: e.target.checked })} /> Büyük/küçük harfe duyarlı
              </label>
              {canEditGlobal && !editingId && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={form.isGlobal} onChange={(e) => setForm({ ...form, isGlobal: e.target.checked })} /> Genel kural (tüm kullanıcılara uygulanır)
                </label>
              )}
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 12px' }}>
            Türkçe karakterler (İ/ı, ş, ğ…) ve büyük/küçük harf farkı otomatik yönetilir. “Tam kelime” seçilirse “orijinal” kuralı “orijinalite” kelimesine dokunmaz.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={saving}><Plus size={16} /> {editingId ? 'Güncelle' : 'Kural Ekle'}</button>
            {editingId && <button className="btn btn-secondary" type="button" onClick={reset}>Vazgeç</button>}
          </div>
        </form>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Kurallarım ({own.length})</h3>
        {loading ? <div className="loading-spinner"><div className="spinner"></div></div> : <RuleTable rules={own} editable />}
      </div>

      {globalRules.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Genel kurallar ({globalRules.length})</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4 }}>Yönetici tarafından tanımlanır, tüm mağazalara uygulanır{canEditGlobal ? ' (düzenleyebilirsiniz).' : '.'}</p>
          <RuleTable rules={globalRules} editable={canEditGlobal} />
        </div>
      )}

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><FlaskConical size={18} /> Kuralları dene</h3>
          <div className="form-group"><label className="form-label">Örnek başlık</label>
            <input className="form-input" value={testTitle} onChange={(e) => setTestTitle(e.target.value)} placeholder="Orijinal Gümüş Kolye" /></div>
          <div className="form-group"><label className="form-label">Örnek açıklama</label>
            <textarea className="form-input" rows={3} value={testDesc} onChange={(e) => setTestDesc(e.target.value)} /></div>
          <button className="btn btn-secondary" onClick={runTest}>Dene</button>
          {testOut && (
            <div style={{ marginTop: 14, fontSize: 13, background: 'var(--bg-secondary)', borderRadius: 8, padding: 12 }}>
              <div><strong>Başlık:</strong> {testOut.title || '—'}</div>
              <div style={{ marginTop: 4 }}><strong>Açıklama:</strong> {testOut.description || '—'}</div>
              {testOut.blocked && <div style={{ marginTop: 8, color: 'var(--danger)' }}>⛔ Bu ürün engellenir: {testOut.blockedBy.join(', ')}</div>}
              {!testOut.changed && !testOut.blocked && <div style={{ marginTop: 8, color: 'var(--text-muted)' }}>Hiçbir kural eşleşmedi.</div>}
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Wand2 size={18} /> Mevcut ürünlere uygula</h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Yeni çekilen ürünlere kurallar otomatik uygulanır. Zaten içerideki ürünleri güncellemek için önce önizleyin.
            Metinler XML’deki orijinalinden yeniden üretilir; bir kuralı silip tekrar uygularsanız eski metin geri gelir.
          </p>
          <button className="btn btn-secondary" onClick={preview} disabled={applying}>{applying ? 'Hesaplanıyor…' : 'Önizle'}</button>
          {applyInfo && (
            <div style={{ marginTop: 14, fontSize: 13 }}>
              <div><strong>{applyInfo.scanned}</strong> ürün tarandı · <strong>{applyInfo.willChange}</strong> ürün değişecek · <strong>{applyInfo.blocked}</strong> ürün engellenecek</div>
              {applyInfo.samples.length > 0 && (
                <div style={{ marginTop: 8, background: 'var(--bg-secondary)', borderRadius: 8, padding: 10 }}>
                  {applyInfo.samples.map((s, i) => (
                    <div key={i} style={{ padding: '4px 0', borderBottom: i < applyInfo.samples.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                      <div style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{s.before}</div>
                      <div>{s.after}</div>
                    </div>
                  ))}
                </div>
              )}
              {applyInfo.willChange > 0 && (
                <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={applyNow} disabled={applying}>{applyInfo.willChange} ürüne uygula</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
