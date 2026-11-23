import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ImagePlus, Trash2, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, Field, Spinner, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, usd } from '../format.js';

const QUALITY = { low: 'Düşük (en ucuz)', medium: 'Orta', high: 'Yüksek (en pahalı)' };

/** Fetches the picture with the session (an <img> cannot send the CSRF header) and shows it from memory; the object address is released when it changes or the card closes */
function Picture({ articleId, imageId, alt }) {
  const [url, setUrl] = useState(null); const [err, setErr] = useState(false); const last = useRef(null);
  useEffect(() => {
    let dead = false; setUrl(null); setErr(false);
    api.blob(`/articles/${articleId}/image/file`).then((blob) => { if (dead) return; const u = URL.createObjectURL(blob); last.current = u; setUrl(u); }).catch(() => { if (!dead) setErr(true); });
    return () => { dead = true; if (last.current) URL.revokeObjectURL(last.current); };
  }, [articleId, imageId]);
  if (err) return <small className="faint">Görsel gösterilemedi.</small>;
  if (!url) return <Spinner />;
  return <img src={url} alt={alt} style={{ width: '100%', borderRadius: 8, display: 'block' }} />;
}

/** The article's cover picture: what it looks like, its alt text, who drew it and at what cost; a new one on request (admin, costs money) */
export default function ArticleImage({ art }) {
  const { can, confirm } = useApp();
  const st = useLoad(() => api.get(`/articles/${art.id}/image`), [art.id]);
  const [alt, setAlt] = useState(''); const [scene, setScene] = useState(''); const [quality, setQuality] = useState('');
  const [run, busy] = useAction();
  useEffect(() => { if (st.data && st.data.image) setAlt(st.data.image.alt); }, [st.data]);
  const generate = async () => {
    const had = st.data && st.data.image;
    if (had && !(await confirm({ title: 'Yeni görsel çizilsin mi?', body: 'Bu makalenin görseli yenisiyle DEĞİŞTİRİLİR ve görsel başına OpenAI ücreti tekrar alınır. WordPress’e gönderilmiş bir yazının görseli, yazıyı yeniden gönderince güncellenir.', confirmText: 'Yeni görsel çiz' }))) return;
    if (await run(() => api.post(`/articles/${art.id}/image/generate`, { prompt: scene || undefined, quality: quality || undefined, alt: had && !scene ? alt : undefined }), 'Görsel hazır')) { setScene(''); st.reload(); }
  };
  const saveAlt = async () => { if (await run(() => api.put(`/articles/${art.id}/image`, { alt }), 'Alt metin kaydedildi')) st.reload(); };
  const remove = async () => { if (await confirm({ title: 'Görsel silinsin mi?', body: 'Kapak görseli kaldırılır. Yazı WordPress’e gönderilmişse sitedeki görsel, yazıyı yeniden gönderene kadar durur.', confirmText: 'Sil', danger: true }) && await run(() => api.del(`/articles/${art.id}/image`), 'Görsel silindi')) st.reload(); };
  return (
    <Card title="Kapak görseli">
      <Async state={st}>{(d) => (
        <div className="stack">
          {d.image ? (
            <>
              <Picture articleId={art.id} imageId={d.image.id} alt={d.image.alt} />
              <Field label="Alt metin" hint="Resmi görmeyenler (ekran okuyucu) ve arama motorları için resmi anlatır; anahtar kelime listesi değildir."><input className="input" value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} disabled={!can('articles.write')} aria-label="Görsel alt metni" /></Field>
              {can('articles.write') && alt !== d.image.alt && <div className="row"><button className="btn sm primary" disabled={busy || !alt.trim()} onClick={saveAlt}>Alt metni kaydet</button></div>}
              <small className="faint">{d.image.provider === 'openai' ? 'OpenAI' : d.image.provider} · {d.image.model} · {QUALITY[d.image.quality] || d.image.quality} · {d.image.width}×{d.image.height} · {Math.round(d.image.byteSize / 1024)} KB · maliyet {usd(d.image.costUsd)} · {dt(d.image.createdAt)}</small>
              <details><summary className="faint">Çizilen tarif</summary><p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{d.image.prompt}</p></details>
            </>
          ) : (
            <p className="muted">Bu makalenin kapak görseli yok.{d.typedUrl ? ' Yan taraftaki “Öne çıkan görsel” adresi kullanılır (adres yazılıysa, çizilen görselin önüne geçer).' : ''}{d.auto ? ' Yeni makalelere görsel kendiliğinden eklenir; bu makalede çizilememiş olabilir (son çalışma kaydına bakın).' : ''}</p>
          )}
          {d.typedUrl && d.image && <Alert kind="info">“Öne çıkan görsel” alanına bir adres yazılı: WordPress’e <strong>o adres</strong> gönderilir, çizilen görsel kullanılmaz.</Alert>}
          {can('research.paid') && (
            d.openaiConfigured ? (
              <div className="stack">
                <Field label="Ne çizilsin? (isteğe bağlı)" hint="Boşsa yazıcının önerdiği sahne ya da başlıktan türeyen bir sahne kullanılır. Görselde yazı, logo ve gerçek kişi olmaz."><textarea className="input" rows={2} maxLength={700} value={scene} onChange={(e) => setScene(e.target.value)} placeholder="ör. Karanlık bir masada açık laptopun üstünde süzülen parlak bir fiyat etiketi" /></Field>
                <div className="row"><select className="input" style={{ width: 'auto' }} value={quality} onChange={(e) => setQuality(e.target.value)} aria-label="Görsel kalitesi"><option value="">Kalite: ayarlardaki ({QUALITY[d.quality] || d.quality})</option>{Object.entries(QUALITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <button className="btn primary" disabled={busy} onClick={generate}>{d.image ? <RefreshCw size={15} /> : <ImagePlus size={15} />}{d.image ? 'Yeni görsel çiz' : 'Görsel çiz'}</button>
                  {d.image && can('articles.write') && <button className="btn danger" disabled={busy} onClick={remove}><Trash2 size={15} />Sil</button>}</div>
                <small className="faint">Görsel başına OpenAI ücreti alınır{d.image && d.image.costUsd !== null ? '' : ' (fiyatı API Kullanımı → OpenAI kartına yazarsanız maliyet burada görünür)'}.</small>
              </div>
            ) : <small className="faint">Görsel çizmek için OpenAI anahtarı gerekir: <Link to="/api-usage">API Kullanımı</Link>.</small>
          )}
          {!can('research.paid') && d.image && can('articles.write') && <div className="row"><button className="btn danger sm" disabled={busy} onClick={remove}><Trash2 size={14} />Görseli sil</button></div>}
        </div>
      )}</Async>
    </Card>
  );
}
