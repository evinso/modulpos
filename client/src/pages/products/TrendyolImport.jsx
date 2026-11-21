import { useState } from 'react';
import { Link2, Loader2, ClipboardPaste } from 'lucide-react';
import api from '../../services/api';

const muted = { fontSize: 11.5, color: 'var(--text-muted)' };

/**
 * "Trendyol linkinden doldur": the owner pastes a Trendyol product link and the form is filled in (and stays editable).
 * Trendyol blocks servers, so reading the link from here is often refused; then the page asks for the page SOURCE instead
 * (the owner's own browser can open the page: Ctrl+U, copy all, paste here). Nothing is saved by this card.
 */
export default function TrendyolImport({ onImported }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needSource, setNeedSource] = useState(false);
  const [source, setSource] = useState('');
  const [done, setDone] = useState(null);

  const run = async (body) => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/products/trendyol-import', body);
      setDone(data.data); setNeedSource(false); setSource('');
      onImported(data.data);
    } catch (err) {
      const d = err.response && err.response.data;
      if (d && d.blocked) { setNeedSource(true); setError(d.error); }
      else setError((d && d.error) || 'Bilgiler okunamadı');
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="trendyol-import" style={{ background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13, marginBottom: 4 }}><Link2 size={15} style={{ color: '#f97316' }} /> Trendyol linkinden doldur <span style={{ ...muted, fontWeight: 400 }}>(isteğe bağlı)</span></div>
      <div style={{ ...muted, marginBottom: 8, lineHeight: 1.6 }}>
        Bir Trendyol ürün linki yapıştırın; başlık, açıklama, görseller, marka, kategori ve özellikler forma gelir. <strong>Hepsini düzenleyebilirsiniz</strong>; barkod, stok ve net tutarı siz yazarsınız.
        Yalnızca kendi ürünleriniz ya da kullanım izniniz olan ürünler için kullanın (görsel ve metin hakları).
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input className="form-input" data-testid="import-url" aria-label="Trendyol ürün linki" placeholder="https://www.trendyol.com/marka/urun-adi-p-123456789" value={url} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (url.trim() && !busy) run({ url }); } }} style={{ flex: 1, minWidth: 260 }} />
        <button type="button" className="btn btn-secondary" data-testid="import-go" disabled={busy || !url.trim()} onClick={() => run({ url })}>
          {busy && !needSource ? <Loader2 size={14} className="spinning" /> : <Link2 size={14} />} Bilgileri getir
        </button>
      </div>
      {error && <div data-testid="import-error" style={{ marginTop: 8, fontSize: 12.5, color: needSource ? 'var(--warning)' : 'var(--danger)' }}>{error}</div>}
      {needSource && (
        <div data-testid="import-source" style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Sayfa kaynağını yapıştırın</div>
          <ol style={{ ...muted, margin: '0 0 8px 18px', padding: 0, lineHeight: 1.7 }}>
            <li>Ürün sayfasını kendi tarayıcınızda açın</li>
            <li>Sayfada sağ tıklayıp <em>Sayfa kaynağını görüntüle</em> deyin (Windows: Ctrl+U, Mac: ⌥⌘U)</li>
            <li>Açılan sayfada hepsini seçip kopyalayın (Ctrl+A, Ctrl+C) ve aşağıya yapıştırın</li>
          </ol>
          <textarea className="form-textarea" rows={4} data-testid="import-source-text" aria-label="Sayfa kaynağı" placeholder="<!DOCTYPE html> ..." value={source} onChange={(e) => setSource(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 11 }} />
          <button type="button" className="btn btn-secondary" data-testid="import-source-go" style={{ marginTop: 8 }} disabled={busy || !source.trim()} onClick={() => run({ source, url })}>
            {busy ? <Loader2 size={14} className="spinning" /> : <ClipboardPaste size={14} />} Bilgileri oku
          </button>
        </div>
      )}
      {done && !error && (
        <div data-testid="import-done" style={{ marginTop: 8, fontSize: 12.5, color: 'var(--success)' }}>
          Bilgiler getirildi: {done.title ? 'başlık, ' : ''}{done.description ? 'açıklama, ' : ''}{done.images.length} görsel{done.brand ? ', marka' : ''}{done.category ? ', kategori' : ''}{done.attributes.length ? `, ${done.attributes.length} özellik` : ''}. Aşağıdan kontrol edip düzenleyin.
        </div>
      )}
    </div>
  );
}
