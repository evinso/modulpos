import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, Link2, Loader2, Search } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { readXmlFile } from './xmlFile';
import { storeBrandOf } from './storeBrand';

const PAGE = 50; const BATCH = 200;
const muted = { fontSize: 11.5, color: 'var(--text-muted)' };
const LABELS = { title: 'Ürün adı', description: 'Açıklama', images: 'Fotoğraflar', sku: 'Stok kodu (SKU)', barcode: 'Barkod', category: 'Kategori yazısı' };
const REASON = { exists: 'zaten ekli (aynı SKU)', barcode: 'aynı barkod zaten var', limit: 'plan ürün limiti', unknown: 'bulunamadı' };
const errText = (e, fallback) => (e && e.response && e.response.data && e.response.data.error) || fallback;

/**
 * "XML'den ürün ekle": products ADDED BY HAND from an XML file or address. Only the name, the description, the pictures (as addresses), the barcode / stock code and the category text come from the file; the XML's price,
 * brand, stock and VAT are never used (the owner's own brand comes from the store settings, price and stock are typed later). Reading writes nothing: the page shows what would happen and the owner chooses.
 */
export default function XmlHandImportModal({ connection, onClose, onDone }) {
  const storeBrand = storeBrandOf(connection);
  const [mode, setMode] = useState('file');
  const [file, setFile] = useState(null); const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [rd, setRd] = useState(null);                         // what the last reading answered
  const [map, setMap] = useState({});                          // the field choices of the person (re-reading applies them)
  const [sel, setSel] = useState(new Set()); const [q, setQ] = useState(''); const [page, setPage] = useState(0);
  const [opts, setOpts] = useState({ vatRate: '20', stock: '0', brand: storeBrand ? storeBrand.name : '', useBarcode: true });
  const [progress, setProgress] = useState(null);              // { done, total } while writing
  const [result, setResult] = useState(null);                  // what writing did
  const [text, setText] = useState('');                         // the decoded file, kept to read it again with other field choices

  const read = async (mapping) => {
    setBusy(true); setError('');
    try {
      let r;
      if (mode === 'file') {
        const body = text && mapping ? text : await readXmlFile(file); setText(body);
        r = await api.post(`/products/xml-import/read${mapping ? `?mapping=${encodeURIComponent(JSON.stringify(mapping))}` : ''}`, body, { headers: { 'Content-Type': 'text/xml' }, timeout: 300000 });
      } else r = await api.post('/products/xml-import/read', { url: url.trim(), mapping }, { timeout: 300000 });
      const d = r.data; setRd(d); setMap(d.mapping || {}); setPage(0);
      setSel(new Set(d.items.filter((i) => !i.exists && i.imageCount > 0).map((i) => i.ref)));
    } catch (e) { setError(e.response ? errText(e, 'XML okunamadı') : (e.message || 'XML okunamadı')); }
    finally { setBusy(false); }
  };

  const rows = useMemo(() => {
    if (!rd) return [];
    const k = q.trim().toLocaleLowerCase('tr');
    return k ? rd.items.filter((i) => `${i.title} ${i.sku} ${i.barcode} ${i.category}`.toLocaleLowerCase('tr').includes(k)) : rd.items;
  }, [rd, q]);
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const counts = useMemo(() => rd ? { exists: rd.items.filter((i) => i.exists).length, noImage: rd.items.filter((i) => !i.imageCount).length, generated: rd.items.filter((i) => i.skuGenerated).length } : null, [rd]);
  const toggle = (ref) => setSel((s) => { const n = new Set(s); if (n.has(ref)) n.delete(ref); else n.add(ref); return n; });
  const addable = (i) => !i.exists;
  const brandOk = !!opts.brand.trim();

  const write = async () => {
    const refs = [...sel].sort((a, b) => a - b); const total = refs.length;
    if (!total) return;
    setBusy(true); setError(''); setProgress({ done: 0, total });
    const sum = { created: 0, skipped: [], limitMessage: '' };
    try {
      for (let i = 0; i < refs.length; i += BATCH) {
        const r = await api.post('/products/xml-import', { token: rd.token, refs: refs.slice(i, i + BATCH), options: { vatRate: Number(opts.vatRate), stock: Number(opts.stock || 0), brand: opts.brand.trim(), useBarcode: opts.useBarcode } }, { timeout: 300000 });
        sum.created += r.data.created; sum.skipped.push(...r.data.skipped); if (r.data.limitMessage) sum.limitMessage = r.data.limitMessage;
        setProgress({ done: Math.min(total, i + BATCH), total });
        if (r.data.limitReached) break;
      }
      setResult(sum);
      if (sum.created) toast.success(`${sum.created} ürün eklendi`);
    } catch (e) {
      setError(errText(e, 'Ürünler eklenemedi') + (e.response && e.response.status === 410 ? '' : ` (Eklenen: ${sum.created})`));
      if (sum.created) setResult(sum);
    } finally { setBusy(false); setProgress(null); }
  };

  const reasons = result ? result.skipped.reduce((m, s) => { m[s.reason] = (m[s.reason] || 0) + 1; return m; }, {}) : {};
  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()} style={{ zIndex: 1100 }}>
      <div className="modal" data-testid="xml-import" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
        <div className="modal-header"><h3>XML’den ürün ekle (elle eklenen ürün olarak)</h3><button className="modal-close" onClick={() => !busy && onClose()}>×</button></div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
            XML’den yalnızca <strong>ürün adı, açıklama, fotoğraflar (adres olarak), barkod / stok kodu ve kategori yazısı</strong> alınır. XML’deki <strong>fiyat, marka ve stok alınmaz</strong>: markanız mağaza ayarınızdan gelir, satış tutarını ve stoğu ürünler eklendikten sonra kendiniz girersiniz.
            Ürünler “Elle eklenen ürünler” grubunda görünür; XML eşitlemesi onlara dokunmaz, güncellemeyi elle yaparsınız.
          </div>

          {!result && !rd && (
            <div className="stack" style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'inline-flex', background: 'var(--bg-tertiary)', borderRadius: 10, padding: 3, width: 'fit-content' }}>
                {[['file', 'Dosya yükle', FileUp], ['url', 'XML adresi', Link2]].map(([k, label, Icon]) => (
                  <button key={k} type="button" className={`btn ${mode === k ? 'btn-primary' : 'btn-secondary'}`} style={{ boxShadow: 'none' }} onClick={() => { setMode(k); setError(''); }}><Icon size={14} /> {label}</button>))}
              </div>
              {mode === 'file' ? (
                <div className="form-group" key="xml-from-file"><label className="form-label">XML dosyası (en çok 30 MB)</label>
                  <input type="file" data-testid="xml-file" accept=".xml,text/xml,application/xml" onChange={(e) => { setFile(e.target.files && e.target.files[0] || null); setError(''); }} />
                  {file && <small style={muted}>{file.name} · {(file.size / 1048576).toFixed(1)} MB</small>}</div>
              ) : (
                <div className="form-group" key="xml-from-url"><label className="form-label">XML adresi</label>
                  <input className="form-input" data-testid="xml-url" placeholder="https://tedarikci.com/urunler.xml" value={url} onChange={(e) => { setUrl(e.target.value); setError(''); }} />
                  <small style={muted}>Adres tek seferlik okunur; kaynak olarak kaydedilmez ve düzenli çekilmez.</small></div>
              )}
              <div><button type="button" className="btn btn-primary" data-testid="xml-read" disabled={busy || (mode === 'file' ? !file : !url.trim())} onClick={() => read(null)}>{busy ? <><Loader2 size={14} className="spinning" /> Okunuyor…</> : 'XML’i oku'}</button>
                <small style={{ ...muted, marginLeft: 10 }}>Okumak hiçbir şey eklemez; ürünleri görüp seçeceksiniz.</small></div>
            </div>
          )}

          {error && <div data-testid="xml-error" style={{ color: 'var(--danger)', fontSize: 13, margin: '10px 0' }}>{error}</div>}

          {rd && !result && (
            <div className="stack" style={{ display: 'grid', gap: 12 }}>
              <div data-testid="xml-summary" style={{ fontSize: 13 }}>
                <strong>{rd.items.length}</strong> ürün okundu{rd.truncated ? ` (dosyada ${rd.total} ürün var; ilk ${rd.max} okundu: kalanı için dosyayı bölün)` : ''}
                {' · '}<strong>{rd.items.length - counts.exists}</strong> eklenebilir
                {counts.exists > 0 && <> · <span style={{ color: 'var(--warning)' }}>{counts.exists} zaten ekli (atlanır)</span></>}
                {counts.noImage > 0 && <> · <span style={{ color: 'var(--warning)' }}>{counts.noImage} ürünün fotoğrafı yok</span> <small style={muted}>(Trendyol fotoğrafsız ürün kabul etmez; varsayılan olarak seçili gelmez)</small></>}
                {counts.generated > 0 && <> · {counts.generated} ürünün kodu yok (adından üretilir)</>}
                {rd.noName > 0 && <> · {rd.noName} satırın adı yok (alınmaz)</>}{rd.duplicatesInFile > 0 && <> · {rd.duplicatesInFile} tekrar eden kod (ilki alınır)</>}
              </div>

              <details><summary style={{ cursor: 'pointer', fontSize: 13 }}>Alanlar yanlış mı? XML’deki hangi alanın neye karşılık geldiğini değiştirin</summary>
                <div className="grid grid-2" style={{ marginTop: 8 }}>
                  {Object.keys(LABELS).map((k) => (
                    <div className="form-group" key={k}><label className="form-label">{LABELS[k]}</label>
                      {k === 'images'
                        ? <input className="form-input" value={map.images || ''} onChange={(e) => setMap({ ...map, images: e.target.value })} placeholder="alan1,alan2" />
                        : <select className="form-input" value={map[k] || ''} onChange={(e) => setMap({ ...map, [k]: e.target.value })}><option value="">(bulunamadı)</option>{rd.fields.map((f) => <option key={f.path} value={f.path}>{f.path}{f.sample ? ` — ${f.sample.slice(0, 40)}` : ''}</option>)}</select>}
                    </div>))}
                </div>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => read(map)}>Bu alanlarla yeniden oku</button>
              </details>

              <div className="grid grid-2">
                <div className="form-group"><label className="form-label">Marka *</label>
                  <input className="form-input" data-testid="xml-brand" value={opts.brand} readOnly={!!storeBrand && storeBrand.strategy === 'override'} onChange={(e) => setOpts({ ...opts, brand: e.target.value })} />
                  <small style={muted}>{storeBrand ? (storeBrand.strategy === 'override' ? 'Mağaza ayarınızdaki “Kendi markam” kullanılır (XML’deki marka alınmaz).' : 'Mağaza ayarınızdaki yedek marka yazıldı; değiştirebilirsiniz (XML’deki marka alınmaz).') : 'Mağaza ayarında marka yok: Trendyol’daki marka adıyla yazın (XML’deki marka alınmaz).'}</small></div>
                <div className="form-group"><label className="form-label">Satış KDV oranı (%)</label>
                  <select className="form-input" value={opts.vatRate} onChange={(e) => setOpts({ ...opts, vatRate: e.target.value })}>{[0, 1, 8, 10, 18, 20].map((v) => <option key={v} value={v}>%{v}</option>)}</select>
                  <small style={muted}>Hepsine uygulanır; ürün başına sonradan değiştirebilirsiniz.</small></div>
                <div className="form-group"><label className="form-label">Başlangıç stoğu</label>
                  <input type="number" min="0" step="1" className="form-input" value={opts.stock} onChange={(e) => setOpts({ ...opts, stock: e.target.value })} />
                  <small style={muted}>XML’deki stok alınmaz; gerçek stoğunuzu sonradan girersiniz.</small></div>
                <div className="form-group"><label className="form-label">Barkod</label>
                  <label className="check" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={opts.useBarcode} onChange={(e) => setOpts({ ...opts, useBarcode: e.target.checked })} /> XML’deki barkodu kullan</label>
                  <small style={muted}>Kapalıysa ürünler barkodsuz eklenir; Trendyol barkodsuz ürün kabul etmez, sonradan yazarsınız.</small></div>
              </div>

              <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 8, top: 9, color: 'var(--text-muted)' }} /><input className="form-input" style={{ paddingLeft: 28 }} placeholder="Ürün, kod ya da kategori ara" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} /></div>
                <button type="button" className="btn btn-secondary" onClick={() => setSel(new Set(rows.filter((i) => addable(i)).map((i) => i.ref)))}>Eklenebilenlerin hepsini seç</button>
                <button type="button" className="btn btn-secondary" onClick={() => setSel(new Set(rows.filter((i) => addable(i) && i.imageCount > 0).map((i) => i.ref)))}>Yalnızca fotoğraflılar</button>
                <button type="button" className="btn btn-secondary" onClick={() => setSel(new Set())}>Hiçbiri</button>
              </div>
              <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table className="table" style={{ width: '100%', fontSize: 12.5 }}>
                  <thead><tr><th style={{ width: 30 }} /><th style={{ width: 46 }} /><th>Ürün</th><th>Kod / barkod</th><th>Foto</th><th>Durum</th></tr></thead>
                  <tbody>{shown.map((i) => (
                    <tr key={i.ref} data-testid="xml-row" style={i.exists ? { opacity: 0.55 } : undefined}>
                      <td><input type="checkbox" aria-label={`${i.title} seç`} checked={sel.has(i.ref)} disabled={!!i.exists} onChange={() => toggle(i.ref)} /></td>
                      <td>{i.firstImage ? <img src={i.firstImage} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 4 }} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : null}</td>
                      <td><strong style={{ display: 'block', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</strong><small style={muted}>{i.category || '—'}{i.descriptionLength ? ` · açıklama ${i.descriptionLength} krk` : ' · açıklama yok'}</small></td>
                      <td><span className="mono">{i.sku}</span>{i.barcode && <small style={{ display: 'block', ...muted }}>{i.barcode}</small>}</td>
                      <td>{i.imageCount || <span style={{ color: 'var(--warning)' }}>yok</span>}</td>
                      <td>{i.exists ? <span style={{ color: 'var(--warning)' }}>zaten ekli ({i.exists === 'sku' ? 'SKU' : 'barkod'})</span> : i.skuGenerated ? <span style={muted}>kod üretilecek</span> : <span style={{ color: 'var(--success, #16a34a)' }}>eklenebilir</span>}</td>
                    </tr>))}</tbody>
                </table>
              </div>
              {rows.length > PAGE && <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" className="btn btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Önceki</button>
                <small style={muted}>{page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} / {rows.length}</small>
                <button type="button" className="btn btn-secondary" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>Sonraki</button></div>}
            </div>
          )}

          {result && (
            <div data-testid="xml-result" className="stack" style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 14 }}><strong>{result.created}</strong> ürün eklendi.</div>
              {result.skipped.length > 0 && <div style={{ fontSize: 13, color: 'var(--warning)' }}>Atlananlar ({result.skipped.length}): {Object.entries(reasons).map(([r, n]) => `${n} × ${REASON[r] || r}`).join(', ')}.{result.limitMessage ? ` ${result.limitMessage}` : ''}</div>}
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                Sıradaki adımlar: ürünler <strong>“Elle eklenen ürünler”</strong> grubunda. Her ürün için <strong>“Elime kalacak net tutar”</strong>ı ve gerçek stoğu girin (şimdilik 0), Trendyol kategorisini <Link to="/category-mapping?tab=products" onClick={onClose}>Ürün bazlı kategori</Link> sekmesinden seçin.
                Fiyatın hesaplanması için “Elle eklenen ürünler” kapsamlı bir <Link to="/pricing" onClick={onClose}>fiyat şablonu</Link> gerekir.
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {progress && <small style={{ ...muted, marginRight: 'auto' }} data-testid="xml-progress">Ekleniyor: {progress.done} / {progress.total}</small>}
          {!result && <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>}
          {rd && !result && <button type="button" className="btn btn-primary" data-testid="xml-import-go" disabled={busy || sel.size === 0 || !brandOk} onClick={write} title={brandOk ? '' : 'Önce bir marka yazın'}>{busy ? <><Loader2 size={14} className="spinning" /> Ekleniyor…</> : `Seçili ${sel.size} ürünü ekle`}</button>}
          {result && <button type="button" className="btn btn-primary" data-testid="xml-done" onClick={() => onDone(result.created)}>Elle eklenen ürünlere git</button>}
        </div>
      </div>
    </div>
  );
}
