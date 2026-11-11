import { useState, useEffect, useRef, useCallback } from 'react';
import { Wand2, Loader2, Search, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import CategoryPicker from './CategoryPicker';
import AttributeGroups from './AttributeGroups';
import { SOURCE_LABEL, STATUS_OPTIONS, chunk, shortPath, creditText } from './helpers';

const PAGE_SIZE = 50;

/**
 * "Ürün bazlı kategori" tab of the category mapping page. For feeds whose XML categories are too broad to map as a whole
 * ("Ev ve Yaşam": 800 different kinds of products) every product gets its own Trendyol category: free rule-based
 * suggestions, a manual picker, and a paid AI step that chooses among the suggestions.
 * The connection and the XML source come from the page; it is mounted with a key, so changing either starts it afresh.
 */
export default function ProductCategoriesSection({ connId, srcId, reloadToken = 0 }) {
  const [overview, setOverview] = useState(null);
  const [filters, setFilters] = useState({ status: 'missing', category: '', q: '' });
  const [qInput, setQInput] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ products: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [picker, setPicker] = useState(null);
  const [busy, setBusy] = useState('');
  const [ai, setAi] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const stopRef = useRef(false);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // search box -> filter, with a short pause while typing
  useEffect(() => {
    const t = setTimeout(() => { setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput })); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const base = `/marketplace/connections/${connId}/product-categories`;

  useEffect(() => {
    let alive = true;
    api.get(`${base}/overview`, { params: { xmlSourceId: srcId } }).then((r) => { if (alive) setOverview(r.data); }).catch(() => { if (alive) setOverview(null); });
    return () => { alive = false; };
  }, [base, srcId, reloadKey, reloadToken]);

  useEffect(() => {
    let alive = true;
    api.get(`${base}/products`, { params: { xmlSourceId: srcId, ...filters, page, limit: PAGE_SIZE } })
      .then((r) => { if (alive) setList(r.data); })
      .catch(() => { if (alive) { setList({ products: [], total: 0 }); toast.error('Ürünler yüklenemedi'); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [base, srcId, filters, page, reloadKey, reloadToken]);

  const changeFilter = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); setSelected(new Set()); setLoading(true); };

  const ids = () => [...selected];
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pageIds = list.products.map((p) => p.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const togglePage = () => setSelected((s) => { const n = new Set(s); if (allOnPage) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; });

  const selectAllFiltered = async () => {
    setBusy('select');
    try {
      const r = await api.get(`${base}/ids`, { params: { xmlSourceId: srcId, ...filters } });
      setSelected(new Set(r.data.ids));
      if (r.data.truncated) toast(`İlk ${r.data.ids.length} ürün seçildi`);
    } catch { toast.error('Ürünler seçilemedi'); }
    finally { setBusy(''); }
  };

  const assign = async (productIds, leaf, source = 'manual') => {
    setBusy('assign');
    try {
      let saved = 0;
      for (const part of chunk(productIds, 500)) {
        const r = await api.put(base, { assignments: part.map((productId) => ({ productId, categoryId: leaf.id, source })) });
        saved += r.data.saved;
      }
      toast.success(`${saved} ürüne “${shortPath(leaf.path || leaf.name, 1)}” kategorisi atandı`);
      setSelected((s) => { const n = new Set(s); productIds.forEach((id) => n.delete(id)); return n; });
      refresh();
    } catch (err) { toast.error(err.response?.data?.error || 'Kaydedilemedi'); }
    finally { setBusy(''); }
  };

  const applySuggestions = async () => {
    if (!window.confirm(`${selected.size} ürüne ilk öneri uygulanacak.\n\nÖneriler kelime eşleştirmesiyle bulunur ve yanlış olabilir; özellikle “Ev ve Yaşam” gibi karışık kategorilerde. Emin değilseniz önce listeden kontrol edin ya da yapay zekayı kullanın. Yanlış atamaları “Kategorileri sıfırla” ile geri alabilirsiniz.\n\nDevam edilsin mi?`)) return;
    setBusy('rule');
    try {
      let applied = 0; let skipped = 0;
      for (const part of chunk(ids(), 500)) {
        const r = await api.post(`${base}/apply-suggestions`, { productIds: part });
        applied += r.data.applied; skipped += r.data.skipped;
      }
      toast.success(`${applied} ürüne ilk öneri uygulandı${skipped ? `, ${skipped} ürün için öneri bulunamadı` : ''}`);
      setSelected(new Set());
      refresh();
    } catch (err) { toast.error(err.response?.data?.error || 'Uygulanamadı'); }
    finally { setBusy(''); }
  };

  const remove = async (productIds) => {
    if (!window.confirm(`${productIds.length} ürünün ürüne özel kategorisi kaldırılsın mı? Ürünler XML kategorisinin eşleştirmesine geri döner.`)) return;
    setBusy('remove');
    try {
      let removed = 0;
      for (const part of chunk(productIds, 500)) { const r = await api.delete(base, { data: { productIds: part } }); removed += r.data.removed || 0; }
      toast.success(`${removed} ürünün özel kategorisi kaldırıldı`);
      setSelected(new Set());
      refresh();
    } catch (err) { toast.error(err.response?.data?.error || 'Kaldırılamadı'); }
    finally { setBusy(''); }
  };

  const runAi = async () => {
    const all = ids();
    const cost = overview?.aiCostPerProduct || 0;
    const msg = `${all.length} ürün için yapay zeka kategori eşleştirmesi yapılacak.\n\n`
      + (cost > 0 ? `Sonuç alınan her ürün için ${creditText(cost)} kredi kesilir (en fazla ${creditText(cost * all.length)} kredi). Sonuç alınamayan ürünlerin kredisi iade edilir.\n\n` : 'Bu işlem ücretsiz.\n\n')
      + 'Devam edilsin mi?';
    if (!window.confirm(msg)) return;
    stopRef.current = false;
    const st = { total: all.length, done: 0, matched: 0, unmatched: 0, charged: 0, error: null, running: true };
    setAi({ ...st });
    for (const part of chunk(all, 100)) {
      if (stopRef.current) break;
      try {
        const r = await api.post(`${base}/ai-match`, { productIds: part });
        st.matched += r.data.matched; st.unmatched += r.data.unmatched; st.charged += r.data.charged || 0;
        if (r.data.partialError) st.error = r.data.partialError;
      } catch (err) {
        st.error = err.response?.data?.error || 'Yapay zeka eşleştirmesi başarısız oldu';
        break;
      }
      st.done += part.length;
      setAi({ ...st });
    }
    st.running = false;
    setAi({ ...st });
    setSelected(new Set());
    refresh();
  };

  const totalPages = Math.max(1, Math.ceil((list.total || 0) / PAGE_SIZE));
  const cost = overview?.aiCostPerProduct || 0;
  const hasSel = selected.size > 0;

  return (
    <div>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          Normalde bir XML kategorisi tek bir Trendyol kategorisine eşleşir. “Ev ve Yaşam” gibi karışık kategorilerde bu yanlış ürünlere yol açar.
          Burada seçtiğiniz kategori <strong>o ürün için</strong> geçerlidir ve XML kategorisinin eşleştirmesinden önce gelir.
          Öneriler kelime eşleştirmesiyle bulunur ve her zaman doğru olmayabilir; yapay zeka bu önerilerin arasından seçer.
        </p>
      </div>

      {overview && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }} data-testid="overview">
          {[['Toplam ürün', overview.total], ['Ürüne özel kategori', overview.assigned], ['Kategori eşleştirmesiyle', overview.mapped], ['Kategorisi olmayan', overview.missing]].map(([label, n]) => (
            <div key={label} className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{n}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <select className="form-select" style={{ width: 240 }} aria-label="Durum" value={filters.status} onChange={(e) => changeFilter({ status: e.target.value })}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="form-select" style={{ width: 280 }} aria-label="XML kategorisi" value={filters.category} onChange={(e) => changeFilter({ category: e.target.value })}>
            <option value="">Tüm XML kategorileri</option>
            {(overview?.categories || []).map((c) => <option key={c.category} value={c.category}>{(c.category || '(boş)').replace(/&amp;/g, '&')} — {c.missing}/{c.total} eksik</option>)}
          </select>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--text-muted)' }} />
            <input className="form-input" aria-label="Ürün ara" style={{ paddingLeft: 32 }} placeholder="Ürün adında ara…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <button className="btn btn-secondary" disabled={busy === 'select' || list.total === 0} onClick={selectAllFiltered}>
            {busy === 'select' ? 'Seçiliyor…' : `Filtrelenen ${list.total} ürünün hepsini seç`}
          </button>
          {hasSel && <span style={{ fontSize: 13 }}><strong>{selected.size}</strong> ürün seçili <button className="btn btn-secondary" style={{ padding: '2px 8px', marginLeft: 6 }} onClick={() => setSelected(new Set())}>Temizle</button></span>}
        </div>

        {hasSel && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: 12, background: 'var(--bg-tertiary)', borderRadius: 8, marginBottom: 12 }}>
            <button className="btn btn-secondary" disabled={!!busy} onClick={applySuggestions}>Seçilenlere ilk öneriyi uygula (ücretsiz)</button>
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => setPicker({ ids: ids(), title: `${selected.size} ürüne aynı kategoriyi ata` })}>Seçilenlere tek kategori ata…</button>
            <button className="btn btn-primary" disabled={!!busy || !!(ai && ai.running)} onClick={runAi} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Wand2 size={14} /> Yapay zekayla eşleştir{cost > 0 ? ` (${creditText(cost)} kredi/ürün)` : ''}
            </button>
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => remove(ids())}>Seçilenlerin özel kategorisini kaldır</button>
          </div>
        )}

        {ai && (
          <div role="status" data-testid="ai-result" style={{ padding: 12, borderRadius: 8, marginBottom: 12, border: `1px solid ${ai.error ? 'rgba(239,68,68,0.5)' : 'rgba(16,185,129,0.4)'}`, background: ai.error ? 'rgba(239,68,68,0.06)' : 'rgba(16,185,129,0.06)', fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <div>
                {ai.running ? <><Loader2 size={14} className="spinning" /> Yapay zeka çalışıyor: {ai.done}/{ai.total} ürün</> : <>Yapay zeka bitti: {ai.done}/{ai.total} ürün işlendi</>}
                {(ai.done > 0 || !ai.error) && <>{' · '}<strong>{ai.matched}</strong> ürüne kategori bulundu, {ai.unmatched} ürün için sonuç yok
                {cost > 0 && <> · {creditText(ai.charged)} kredi kullanıldı</>}</>}
              </div>
              {ai.running ? <button className="btn btn-secondary" style={{ padding: '2px 10px' }} onClick={() => { stopRef.current = true; }}>Durdur</button>
                : <button className="btn btn-secondary" aria-label="Kapat" style={{ padding: '2px 8px' }} onClick={() => setAi(null)}><X size={12} /></button>}
            </div>
            {ai.error && <div style={{ marginTop: 6, color: 'var(--danger)' }}>{ai.error}</div>}
          </div>
        )}

        {loading ? <div style={{ padding: 30, textAlign: 'center' }}><Loader2 className="spinning" /></div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 12 }}>
                  <th style={{ padding: '6px 8px', width: 28 }}><input type="checkbox" aria-label="Sayfadakilerin hepsini seç" checked={allOnPage} onChange={togglePage} /></th>
                  <th style={{ padding: '6px 8px' }}>Ürün</th>
                  <th style={{ padding: '6px 8px' }}>XML kategorisi</th>
                  <th style={{ padding: '6px 8px', minWidth: 340 }}>Trendyol kategorisi</th>
                </tr>
              </thead>
              <tbody>
                {list.products.map((p) => (
                  <tr key={p.id} data-testid="row" style={{ borderTop: '1px solid var(--border-color)', verticalAlign: 'top' }}>
                    <td style={{ padding: '8px' }}><input type="checkbox" aria-label={`Seç ${p.title}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                    <td style={{ padding: '8px', maxWidth: 320 }}>{p.title}</td>
                    <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>{(p.category || '—').replace(/&amp;/g, '&')}</td>
                    <td style={{ padding: '8px' }}>
                      {p.current ? (
                        <div>
                          <div title={p.current.name} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <Check size={13} style={{ color: 'var(--success)' }} />
                            <span>{shortPath(p.current.name, 2)}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {p.current.productLevel ? (SOURCE_LABEL[p.current.source] || 'Ürüne özel') : 'XML kategorisi eşleştirmesi'}
                            {' · '}<button type="button" className="btn btn-secondary" style={{ padding: '0 6px', fontSize: 11 }} onClick={() => setPicker({ ids: [p.id], title: p.title })}>Değiştir</button>
                            {p.current.productLevel && <> <button type="button" className="btn btn-secondary" style={{ padding: '0 6px', fontSize: 11 }} onClick={() => remove([p.id])}>Kaldır</button></>}
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {p.suggestions.map((s) => (
                            <button key={s.id} type="button" className="btn btn-secondary" data-testid="suggestion" title={`${s.path} (uyum ${Math.round(s.coverage * 100)}%)`} disabled={!!busy}
                              style={{ padding: '3px 8px', fontSize: 12, borderColor: s.coverage === 1 ? 'rgba(16,185,129,0.6)' : undefined }}
                              onClick={() => assign([p.id], s, 'rule')}>{shortPath(s.path, 2)}</button>
                          ))}
                          {p.suggestions.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Öneri bulunamadı</span>}
                          <button type="button" className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => setPicker({ ids: [p.id], title: p.title })}>Ara…</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {list.products.length === 0 && <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Bu filtreyle ürün yok.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 14 }}>
            <button className="btn btn-secondary" disabled={page <= 1} onClick={() => { setPage(page - 1); setLoading(true); }}>Önceki</button>
            <span style={{ fontSize: 13 }}>Sayfa {page} / {totalPages}</span>
            <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => { setPage(page + 1); setLoading(true); }}>Sonraki</button>
          </div>
        )}
      </div>

      <AttributeGroups connId={connId} reloadKey={reloadKey + reloadToken} onChanged={refresh} />

      {picker && (
        <CategoryPicker connId={connId} title={picker.title} onClose={() => setPicker(null)}
          onPick={(leaf) => { const target = picker.ids; setPicker(null); assign(target, leaf, 'manual'); }} />
      )}
    </div>
  );
}
