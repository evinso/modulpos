import { useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Empty, Field, NeedsProject, PageHead, useAction, useApp, useLoad } from '../ui.jsx';
import { dt } from '../format.js';

export const PUB = { pending: ['Sırada', 'info'], sending: ['Gönderiliyor', 'info'], draft: ['Taslak (sitede)', ''], scheduled: ['Zamanlandı', 'info'], published: ['Yayında', 'ok'], failed: ['Başarısız', 'bad'], unknown: ['Sonucu bilinmiyor', 'warn'] };
const MODES = [['draft', 'Taslak olarak gönder (herkese açık değil)'], ['publish_now', 'Hemen yayımla (bugünkü limite kadar)'], ['spread', 'Günlere dağıt (limite ve çalışma saatlerine göre zamanla)']];

/** many articles to one site: pick, see the plan (dry run), send; below, the history of everything that was sent */
export default function Publishing() {
  const { projectId, can, toast } = useApp();
  const sites = useLoad(() => (projectId ? api.get(`/sites?projectId=${projectId}`) : Promise.resolve(null)), [projectId]);
  const [siteId, setSiteId] = useState(''); const [mode, setMode] = useState('draft'); const [startAt, setStartAt] = useState('');
  const [sel, setSel] = useState(new Set()); const [plan, setPlan] = useState(null); const [run, busy] = useAction(); const [rev, setRev] = useState(0);
  const site = siteId || (sites.data && sites.data.sites.find((s) => s.status === 'active') ? sites.data.sites.find((s) => s.status === 'active').id : '');
  const arts = useLoad(() => (projectId ? api.get(`/articles${qs({ projectId, status: mode === 'draft' ? 'ready,needs_review' : 'ready', pageSize: 100 })}`) : Promise.resolve(null)), [projectId, mode, rev]);
  const pubs = useLoad(() => (projectId ? api.get(`/publications${qs({ projectId, siteId: site || undefined, limit: 100 })}`) : Promise.resolve(null)), [projectId, site, rev]);
  if (!projectId) return <NeedsProject />;
  const admin = can('publish.write');
  const sent = new Set(pubs.data ? pubs.data.publications.filter((p) => p.status !== 'failed').map((p) => p.articleId) : []);
  const list = arts.data ? arts.data.items.filter((a) => !sent.has(a.id)) : [];
  const toggle = (id) => { setPlan(null); setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const body = () => ({ siteId: site, articleIds: [...sel], mode, startAt: startAt ? new Date(startAt).toISOString() : undefined });
  const preview = async () => { const r = await run(() => api.post('/publishing/plan', body())); if (r) setPlan(r); };
  const go = async () => { const r = await run(() => api.post('/publishing/bulk', body())); if (r) { toast(`${r.planned} makale kuyruğa alınıyor${r.unplanned.length ? `, ${r.unplanned.length} planlanamadı` : ''}`); setSel(new Set()); setPlan(null); setTimeout(() => setRev((x) => x + 1), 2500); } };
  const act = async (p, what) => { if (await run(() => api.post(`/publications/${p.id}/${what}`, {}), what === 'retry' ? 'Yeniden kuyruğa alındı' : 'Kayıt sıfırlandı')) setRev((x) => x + 1); };
  const sync = async () => { const r = await run(() => api.post('/publications/sync', { projectId })); if (r) { toast(r.checked ? `WordPress’ten ${r.checked} yazı okundu: ${r.published} tanesi yayında${r.scheduled ? `, ${r.scheduled} tanesi zamanlanmış` : ''}${r.errors ? `, ${r.errors} okunamadı` : ''}` : 'WordPress’te beklenen taslak ya da zamanlanmış yazı yok'); setRev((x) => x + 1); } };
  return (
    <div className="page">
      <PageHead title="Toplu Yayınlama" actions={<><button className="btn" disabled={busy} onClick={sync}><RefreshCw size={15} />WordPress’ten durumları oku</button><button className="btn" onClick={() => setRev((x) => x + 1)}>Yenile</button></>}>
        Arşivdeki onaylı makaleleri bir WordPress sitesine gönderin. <strong>Herkese açık yayın için makalenin “Yayına hazır” olması şarttır</strong> (siz onayladınız ve tüm zorunlu kontroller geçti); taslak olarak “inceleme bekleyen” makaleler de gidebilir. Aynı makale aynı siteye bir kez gider; sonra düzenlerseniz aynı yazı güncellenir.
      </PageHead>
      <Async state={sites}>{(d) => d && (d.sites.length === 0 ? <Alert kind="warn" title="Bağlı site yok"><Link to="/sites">Web Sitelerim</Link> sayfasından bir WordPress sitesi bağlayın.</Alert> : (
        <>
          {admin && <Card flat title="Gönderim">
            <div className="grid g3">
              <Field label="Site"><select className="input" value={site} onChange={(e) => { setSiteId(e.target.value); setPlan(null); }}>{d.sites.map((s) => <option key={s.id} value={s.id} disabled={s.status !== 'active'}>{s.name}{s.status !== 'active' ? ' (duraklatıldı)' : ''}</option>)}</select></Field>
              <Field label="Nasıl"><select className="input" value={mode} onChange={(e) => { setMode(e.target.value); setPlan(null); setSel(new Set()); }}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              {mode === 'spread' && <Field label="İlk gün (boş = en yakın uygun an)"><input className="input" type="datetime-local" value={startAt} onChange={(e) => { setStartAt(e.target.value); setPlan(null); }} /></Field>}
            </div>
            <Async state={arts}>{(a) => list.length === 0 ? <Empty title="Gönderilecek makale yok">{mode === 'draft' ? 'İnceleme bekleyen ya da hazır, bu siteye henüz gönderilmemiş makale yok.' : 'Bu siteye henüz gönderilmemiş “Yayına hazır” makale yok: önce Makale Arşivi’nde okuyup onaylayın.'}</Empty> : (
              <div className="tbl-wrap"><table className="tbl"><thead><tr><th style={{ width: 30 }}><input type="checkbox" aria-label="Hepsini seç" checked={list.every((x) => sel.has(x.id))} onChange={(e) => { setPlan(null); setSel(e.target.checked ? new Set(list.map((x) => x.id)) : new Set()); }} /></th><th>Makale</th><th>Durum</th><th className="num">Kalite</th><th>AdSense</th></tr></thead>
                <tbody>{list.map((x) => <tr key={x.id}><td><input type="checkbox" checked={sel.has(x.id)} onChange={() => toggle(x.id)} aria-label={`${x.h1} seç`} /></td><td><Link to={`/articles/${x.id}`}>{x.h1}</Link></td><td>{x.statusLabel}</td><td className="num">{x.qualityScore ?? '—'}</td><td>{x.adsenseRisk || '—'}</td></tr>)}</tbody></table></div>)}</Async>
            <div className="row" style={{ marginTop: 10 }}><button className="btn" disabled={busy || sel.size === 0 || !site} onClick={preview}>Planı göster ({sel.size})</button>
              <button className="btn primary" disabled={busy || !plan || plan.items.length === 0} onClick={go}><Send size={15} />{plan ? `${plan.items.length} makaleyi gönder` : 'Gönder'}</button></div>
            {plan && (
              <div className="stack" style={{ marginTop: 10 }}>
                <Alert kind={plan.items.length ? 'info' : 'warn'} title={`${plan.items.length} makale planlandı, ${plan.unplanned.length} planlanamadı`}>Bu bir <strong>kuru denemedir</strong>: hiçbir şey gönderilmedi, yer ayrılmadı. “Gönder”e basınca her makale yine tek tek kontrol edilir; geçmeyenler sonuçta raporlanır.</Alert>
                {plan.items.length > 0 && <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}><thead><tr><th>Makale</th><th>Ne zaman</th></tr></thead><tbody>{plan.items.map((i) => <tr key={i.articleId}><td>{i.title}</td><td>{i.mode === 'draft' ? 'taslak' : i.scheduledAt ? dt(i.scheduledAt) : 'hemen'}</td></tr>)}</tbody></table></div>}
                {plan.unplanned.length > 0 && <details><summary>Planlanamayan {plan.unplanned.length} makale</summary><ul>{plan.unplanned.map((u) => <li key={u.articleId}>{u.title} — <span className="faint">{u.reason}</span></li>)}</ul></details>}
              </div>)}
          </Card>}
          <Card flat title="Yayın geçmişi">
            <Async state={pubs}>{(p) => p.publications.length === 0 ? <Empty title="Henüz gönderim yok" /> : (
              <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Makale</th><th>Site</th><th>Durum</th><th>Zaman</th><th>Not</th><th /></tr></thead>
                <tbody>{p.publications.map((x) => (
                  <tr key={x.id}><td style={{ maxWidth: 300 }}><Link to={`/articles/${x.articleId}`}>{x.articleTitle}</Link>{x.hasUpdate && <div><Badge kind="warn">sitedeki sürüm eski</Badge></div>}</td><td>{x.siteName}</td>
                    <td><Badge kind={PUB[x.status][1]}>{PUB[x.status][0]}</Badge></td>
                    <td className="faint">{x.status === 'scheduled' ? `yayın: ${dt(x.scheduledAt)}` : x.publishedAt ? dt(x.publishedAt) : dt(x.createdAt)}</td>
                    <td style={{ maxWidth: 340 }} className="faint">{x.lastError || (x.warnings && x.warnings.length ? x.warnings.join(' · ') : '')}{x.wpUrl && <div><a href={x.wpUrl} target="_blank" rel="noopener noreferrer nofollow">yazıyı aç</a></div>}</td>
                    <td className="num">{admin && ['failed', 'unknown'].includes(x.status) && <button className="btn sm" disabled={busy} onClick={() => act(x, 'retry')}>Yeniden dene</button>}{admin && x.status === 'failed' && x.wpPostId && <button className="btn sm ghost" disabled={busy} onClick={() => act(x, 'reset')}>Sıfırla</button>}</td></tr>))}</tbody></table></div>)}</Async>
          </Card>
        </>
      ))}</Async>
    </div>
  );
}
