import { useEffect, useState } from 'react';
import { Plus, X, Wand2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../services/api';

/**
 * Default answers for the required Trendyol attributes, so they are not asked category by category:
 * "Menşei" -> TR, "Renk, Web Color" -> Çok Renkli, every other required attribute -> Belirtilmemiş.
 * They are saved on the connection and written into the products of every chosen category.
 */
export default function AttributeDefaults({ connId, missing, onApplied }) {
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(true);
  const [rules, setRules] = useState([]);
  const [fallback, setFallback] = useState({ enabled: false, value: '' });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/marketplace/connections/${connId}/product-categories/attribute-defaults`)
      .then((r) => {
        if (!alive) return;
        setSaved(!!r.data.saved);
        setRules((r.data.rules || []).map((x) => ({ ...x })));
        setFallback({ enabled: !!r.data.fallback?.enabled, value: r.data.fallback?.value || '' });
        setOpen(!r.data.saved);
        setLoaded(true);
      })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [connId]);

  const setRule = (i, patch) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRule = (name = '', value = '') => { setRules((rs) => [...rs, { name, value }]); setOpen(true); };

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put(`/marketplace/connections/${connId}/product-categories/attribute-defaults`, { rules, fallback });
      setSaved(true);
      setResult(r.data);
      toast.success(`Kaydedildi: ${r.data.products} ürüne uygulandı`);
      onApplied && onApplied();
    } catch (err) { toast.error(err.response?.data?.error || 'Kaydedilemedi'); }
    finally { setBusy(false); }
  };

  if (!loaded) return null;
  const ruleNames = new Set(rules.flatMap((r) => r.name.split(',').map((n) => n.trim().toLowerCase())));
  const suggestions = (missing || []).filter((m) => !ruleNames.has(m.name.toLowerCase()));

  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: 14, marginBottom: 14, background: 'var(--bg-tertiary)' }} data-testid="attr-defaults">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <strong style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Wand2 size={14} /> Varsayılan cevaplar</strong>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {saved ? `${rules.length} kural${fallback.enabled ? ` · diğer hepsi: ${fallback.value}` : ''} · yeni atanan her kategoriye otomatik uygulanır` : 'Henüz kaydedilmedi — aşağıdaki öneriyi düzenleyip kaydedin'}
          </div>
        </div>
        <button className="btn btn-secondary" onClick={() => setOpen(!open)}>{open ? 'Kapat' : 'Düzenle'}</button>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Bir kategori Trendyol’da bu özelliği zorunlu tutuyorsa değer otomatik yazılır; kategori kategori sorulmaz.
            Değer yalnızca Trendyol’un listesinde varsa (ya da özellik serbest yazıya izin veriyorsa) uygulanır; elle girdiğiniz değerler asla değiştirilmez.
            Birden fazla özellik adını virgülle (<em>Renk, Web Color</em>), alternatif değerleri <em>|</em> ile (<em>Belirtilmemiş | Diğer</em>) yazabilirsiniz.
          </p>
          {rules.map((r, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr 32px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input className="form-input" aria-label={`Kural ${i + 1} özellik adı`} placeholder="Özellik adı (ör. Menşei)" value={r.name} onChange={(e) => setRule(i, { name: e.target.value })} />
              <span style={{ textAlign: 'center' }}>→</span>
              <input className="form-input" aria-label={`Kural ${i + 1} değer`} placeholder="Değer (ör. TR)" value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} />
              <button className="btn btn-secondary" aria-label={`Kural ${i + 1} sil`} style={{ padding: '4px 6px' }} onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}><X size={13} /></button>
            </div>
          ))}
          <button className="btn btn-secondary" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginBottom: 12 }} onClick={() => addRule()}><Plus size={13} /> Kural ekle</button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" aria-label="Diğer tüm zorunlu özellikler" checked={fallback.enabled} onChange={(e) => setFallback({ ...fallback, enabled: e.target.checked })} />
              Yukarıdakiler dışında kalan tüm zorunlu özellikler
            </label>
            <span style={{ textAlign: 'center' }}>→</span>
            <input className="form-input" aria-label="Diğer özellikler için değer" placeholder="Belirtilmemiş" disabled={!fallback.enabled} value={fallback.value} onChange={(e) => setFallback({ ...fallback, value: e.target.value })} />
          </div>

          {suggestions.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Şu an boş kalan zorunlu özellikler — tıklayarak kural ekleyin (Trendyol’daki örnek değerler):</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {suggestions.slice(0, 12).map((m) => (
                  <span key={m.name} style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: '3px 8px', fontSize: 12 }}>
                    <strong>{m.name}</strong> <span style={{ color: 'var(--text-muted)' }}>({m.categories} kategori)</span>{' '}
                    {m.examples.slice(0, 3).map((ex) => (
                      <button key={ex} type="button" className="btn btn-secondary" data-testid="attr-example" style={{ padding: '0 6px', fontSize: 11, marginLeft: 3 }} onClick={() => addRule(m.name, ex)}>{ex}</button>
                    ))}
                    {m.examples.length === 0 && <button type="button" className="btn btn-secondary" style={{ padding: '0 6px', fontSize: 11 }} onClick={() => addRule(m.name, '')}>kural ekle</button>}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn-primary" disabled={busy} onClick={save} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {busy ? <><Loader2 size={14} className="spinning" /> Uygulanıyor…</> : 'Kaydet ve tüm ürünlere uygula'}
          </button>
          {result && (
            <div role="status" data-testid="attr-defaults-result" style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
              {result.categories} kategoride {result.products} ürüne uygulandı.
              {result.pending > 0 && <> {result.pending} kategorinin Trendyol bilgisi şimdilik alınamadı; biraz sonra “Kaydet ve uygula”ya tekrar basın.</>}
              {result.unresolved && result.unresolved.length > 0 && <> Listede uygun değer olmadığı için boş kalanlar: {result.unresolved.slice(0, 8).map((u) => `${u.name} (${u.categories})`).join(', ')}.</>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
