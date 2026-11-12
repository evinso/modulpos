import { useState } from 'react';
import { Sparkles, Wand2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import { chunk, creditText } from './helpers';

const AI_PART = 40;   // products per request of the paid step (the server accepts at most 40)

/**
 * Fills the open required attributes of the products from each product's own title and description.
 *   free  : the attribute's allowed values are searched in the text (careful: only what the text really says)
 *   paid  : the AI reads the text and chooses among the allowed values for what the free step could not fill
 * Values are chosen per product; nothing is guessed - what the text does not say stays empty and is listed.
 */
export default function AttributeAuto({ connId, missingProducts, onDone }) {
  const [busy, setBusy] = useState(null);          // 'text' | 'ai'
  const [replaceRules, setReplaceRules] = useState(false);
  const [report, setReport] = useState(null);
  const [progress, setProgress] = useState(null);  // { done, total } while the AI step runs
  const base = `/marketplace/connections/${connId}/product-categories`;

  const stillMissingText = (list) => (list || []).slice(0, 6).map((m) => `${m.name} (${m.products} ürün)`).join(', ');

  const fromText = async () => {
    setBusy('text'); setReport(null);
    try {
      const { data } = await api.post(`${base}/attributes-from-text`, { includeRuleValues: replaceRules });
      setReport({ kind: 'text', ...data });
      if (data.filledAttributes > 0) toast.success(`${data.filledProducts} üründe ${data.filledAttributes} özellik başlık/açıklamadan seçildi`);
      else toast('Başlık ve açıklamada net yazan bir değer bulunamadı', { duration: 6000 });
      onDone && onDone();
    } catch (err) { toast.error(err.response?.data?.error || 'Özellikler seçilemedi'); }
    finally { setBusy(null); }
  };

  const withAi = async () => {
    setBusy('ai'); setReport(null);
    let ids; let cost;
    try {
      const { data } = await api.get(`${base}/attribute-gaps`);
      ids = data.ids || []; cost = data.aiCostPerProduct || 0;
    } catch (err) { toast.error(err.response?.data?.error || 'Eksik ürünler okunamadı'); setBusy(null); return; }
    if (ids.length === 0) { toast('Eksik zorunlu özelliği olan ürün yok'); setBusy(null); return; }
    const msg = `${ids.length} üründe eksik zorunlu özellik var.\n\nYapay zeka her ürünün başlığını ve açıklamasını okuyup, Trendyol'un izin verdiği değerler arasından seçer. Metinde yazmıyorsa boş bırakır (tahmin etmez).\n\n`
      + (cost > 0 ? `Değer bulunan her ürün için ${creditText(cost)} kredi kesilir (en fazla ${creditText(cost * ids.length)} kredi). Değer bulunamayan ürünlerin kredisi iade edilir.\n\n` : 'Bu işlem ücretsiz.\n\n')
      + 'Devam edilsin mi?';
    if (!window.confirm(msg)) { setBusy(null); return; }

    const sum = { asked: 0, filledProducts: 0, filledAttributes: 0, charged: 0, error: null };
    const parts = chunk(ids, AI_PART);
    try {
      for (let i = 0; i < parts.length; i++) {
        setProgress({ done: i * AI_PART, total: ids.length });
        try {
          const { data } = await api.post(`${base}/attributes-ai`, { productIds: parts[i] });
          sum.asked += data.asked || 0; sum.filledProducts += data.filledProducts || 0; sum.filledAttributes += data.filledAttributes || 0; sum.charged += data.charged || 0;
          if (data.partialError && !sum.error) sum.error = data.partialError;
        } catch (err) { sum.error = err.response?.data?.error || 'Yapay zeka adımı başarısız oldu'; break; }
      }
    } finally { setProgress(null); setBusy(null); }
    setReport({ kind: 'ai', ...sum });
    if (sum.error && sum.filledAttributes === 0) toast.error(sum.error, { duration: 8000 });
    else if (sum.filledAttributes > 0) toast.success(`${sum.filledProducts} üründe ${sum.filledAttributes} özellik seçildi${cost > 0 ? ` · ${creditText(sum.charged)} kredi kullanıldı` : ''}`);
    else toast('Yapay zeka metinlerden net bir değer bulamadı', { duration: 6000 });
    onDone && onDone();
  };

  return (
    <div data-testid="attr-auto" style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
        <Sparkles size={15} style={{ color: 'var(--accent-primary)' }} />
        Eksik zorunlu özellikleri ürün başlığı ve açıklamasından otomatik seç
        <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>· {missingProducts} üründe eksik</span>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Her ürünün kendi başlığına ve açıklamasına bakılır; eksik özelliğin değeri, Trendyol'un izin verdiği değerler arasından seçilir. Metinde açıkça yazmıyorsa boş bırakılır, tahmin edilmez.
        Seçilen değer yalnızca o ürüne yazılır (başka ürünlere yayılmaz). Önce ücretsiz adımı deneyin; kalanları yapay zekayla tamamlayabilirsiniz.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
        <input type="checkbox" aria-label="Varsayılan cevaplarla doldurulanları da güncelle" checked={replaceRules} disabled={!!busy} onChange={(e) => setReplaceRules(e.target.checked)} />
        Varsayılan cevaplarla doldurulmuş özellikleri de, metinde net bir değer varsa onunla değiştir (ör. "Çok Renkli" yerine başlıktaki "Siyah")
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={fromText}>
          {busy === 'text' ? <Loader2 size={14} className="spinning" /> : <Sparkles size={14} />} Başlık ve açıklamadan seç (ücretsiz)
        </button>
        <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={withAi}>
          {busy === 'ai' ? <Loader2 size={14} className="spinning" /> : <Wand2 size={14} />} Yapay zekayla tamamla
        </button>
        {progress && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Yapay zeka çalışıyor: {Math.min(progress.done, progress.total)}/{progress.total} ürün</span>}
      </div>

      {report && report.kind === 'text' && (
        <div data-testid="attr-report" style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          {report.filledAttributes > 0
            ? <><strong>{report.filledProducts}</strong> üründe <strong>{report.filledAttributes}</strong> özellik seçildi (başlıktan {report.byFrom.title}, açıklamadan {report.byFrom.description}).</>
            : <>Başlık ve açıklamada net yazan bir değer bulunamadı.</>}
          {report.stillMissing.length > 0 && <div>Hâlâ boş: {stillMissingText(report.stillMissing)}{report.stillMissing.length > 6 ? ' …' : ''}</div>}
          {report.pending > 0 && <div>{report.pending} kategorinin özellik listesi şimdilik alınamadı; biraz sonra tekrar deneyin.</div>}
        </div>
      )}
      {report && report.kind === 'ai' && (
        <div data-testid="attr-report" style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <strong>{report.filledProducts}</strong> üründe <strong>{report.filledAttributes}</strong> özellik seçildi ({report.asked} ürüne soruldu){report.charged > 0 ? ` · ${creditText(report.charged)} kredi kullanıldı` : ''}.
          {report.error && <div style={{ color: 'var(--danger)' }}>{report.error}</div>}
        </div>
      )}
    </div>
  );
}
