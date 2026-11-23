import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Send } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, Field, useAction, useApp, useLoad } from '../ui.jsx';
import { dt } from '../format.js';
import { PUB } from './Publishing.jsx';

/** The article's WordPress side: where it was sent, with what result, and the send form (admin). */
export default function ArticleWordPress({ art, onChanged }) {
  const { can, toast } = useApp();
  const pubs = useLoad(() => api.get(`/articles/${art.id}/publications`), [art.id, art.currentVersion, art.status]);
  const sites = useLoad(() => api.get(`/sites?projectId=${art.projectId}`), [art.projectId]);
  const [f, setF] = useState({ siteId: '', mode: 'draft', at: '' }); const [run, busy] = useAction(); const [again, setAgain] = useState(0);
  useEffect(() => { if (!pubs.data || !pubs.data.publications.some((p) => ['pending', 'sending'].includes(p.status))) return undefined; const t = setTimeout(() => { pubs.reload(); setAgain((x) => x + 1); }, 2500); return () => clearTimeout(t); }, [pubs.data, again]); // eslint-disable-line react-hooks/exhaustive-deps
  const admin = can('publish.write');
  const active = sites.data ? sites.data.sites.filter((s) => s.status === 'active') : [];
  const siteId = f.siteId || (active[0] && active[0].id) || '';
  const sent = pubs.data ? pubs.data.publications.find((p) => p.siteId === siteId) : null;
  const send = async () => {
    const body = { siteId, mode: f.mode, scheduledAt: f.mode === 'schedule' && f.at ? new Date(f.at).toISOString() : undefined };
    if (await run(() => api.post(`/articles/${art.id}/publish`, body), 'Gönderim kuyruğa alındı')) setTimeout(pubs.reload, 1500);
  };
  const waiting = pubs.data ? pubs.data.publications.filter((p) => ['draft', 'scheduled'].includes(p.status)) : [];
  const readBack = async () => {
    const r = await run(() => api.post('/publications/sync', { projectId: art.projectId, articleId: art.id }));
    if (!r) return;
    toast(r.published ? 'WordPress’te yayımlanmış: durum güncellendi' : r.scheduled ? 'WordPress’te zamanlanmış: durum güncellendi' : r.errors ? 'WordPress’e ulaşılamadı ya da yazı okunamadı: site bağlantısını Web Sitelerim’den sınayın' : 'WordPress’te hâlâ taslak ya da zamanlanmış: değişiklik yok');
    pubs.reload(); if (onChanged) onChanged();
  };
  return (
    <Card title="WordPress">
      <Async state={sites}>{(s) => (
        <div className="stack">
          {s.sites.length === 0 && <small className="faint">Bağlı site yok. <Link to="/sites">Web Sitelerim</Link> sayfasından bir WordPress sitesi bağlayın.</small>}
          <Async state={pubs}>{(d) => d.publications.length > 0 && (
            <div className="stack">{d.publications.map((p) => (
              <div key={p.id}><div className="row between"><strong>{p.siteName}</strong><Badge kind={PUB[p.status][1]}>{PUB[p.status][0]}</Badge></div>
                <small className="faint">{p.status === 'scheduled' ? `yayın: ${dt(p.scheduledAt)}` : p.publishedAt ? `yayın: ${dt(p.publishedAt)}` : dt(p.createdAt)}{p.wpUrl && <> · <a href={p.wpUrl} target="_blank" rel="noopener noreferrer nofollow">yazıyı aç</a></>}</small>
                {p.hasUpdate && <div><Badge kind="warn">sitedeki sürüm eski (v{p.articleVersion}, güncel v{p.articleCurrentVersion})</Badge></div>}
                {p.lastError && <div className="faint" style={{ color: 'var(--bad)' }}>{p.lastError}</div>}{p.warnings && p.warnings.length > 0 && <small className="faint">{p.warnings.join(' · ')}</small>}</div>))}</div>)}</Async>
          {admin && waiting.length > 0 && (
            <div className="stack"><button className="btn" disabled={busy} onClick={readBack}><RefreshCw size={15} />Durumu WordPress’ten oku</button>
              <small className="faint">Yazıyı WordPress’te elle yayımladıysanız ya da zamanladıysanız buraya yansıması için basın (WordPress yayını botu açıksa saatte bir kendiliğinden okunur). Hiçbir şey gönderilmez, yalnızca okunur.</small></div>)}
          {admin && active.length > 0 && (
            <div className="stack">
              <Field label="Site"><select className="input" value={siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}>{active.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
              <Field label={sent && sent.wpPostId ? 'Sitedeki yazıya uygula' : 'Nasıl'}><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="draft">Taslak olarak</option><option value="publish">Hemen yayımla</option><option value="schedule">Zamanla</option></select></Field>
              {f.mode === 'schedule' && <Field label="Yayın zamanı"><input className="input" type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>}
              {f.mode !== 'draft' && art.status !== 'ready' && art.status !== 'published' && art.status !== 'scheduled' && <Alert kind="warn">Herkese açık yayın için makale “Yayına hazır” olmalı.</Alert>}
              <button className="btn primary" disabled={busy || !siteId || (f.mode === 'schedule' && !f.at)} onClick={send}><Send size={15} />{sent && sent.wpPostId ? 'Sitede güncelle / uygula' : 'Gönder'}</button>
              <small className="faint">Aynı makale aynı siteye bir kez gider; düzenledikten sonra tekrar göndermek AYNI yazıyı günceller.</small>
            </div>)}
          {!admin && <small className="faint">Siteye gönderme yalnızca yöneticide.</small>}
        </div>
      )}</Async>
    </Card>
  );
}
