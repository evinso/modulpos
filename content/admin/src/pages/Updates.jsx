import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Empty, Modal, NeedsProject, PageHead, ScoreBar, Tabs, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, usd } from '../format.js';
import DiffView from './DiffView.jsx';
import { RISK } from '../format.js';

const KIND = { minor: ['Küçük güncelleme', ''], major: ['Kapsamlı güncelleme', 'warn'], critical: ['Kritik düzeltme', 'bad'] };
const ST = { proposed: ['Onay bekliyor', 'warn'], applied: ['Uygulandı', 'ok'], rejected: ['Reddedildi', ''], stale: ['Eskidi', ''], failed: ['Başarısız', 'bad'] };

function Detail({ id, onClose, onDone }) {
  const { can } = useApp();
  const st = useLoad(() => api.get(`/updates/${id}`), [id]); const [run, busy] = useAction();
  const act = async (what) => { if (await run(() => api.post(`/updates/${id}/${what}`, {}), what === 'apply' ? 'Güncelleme uygulandı' : 'Taslak reddedildi')) { onDone(); onClose(); } };
  return (
    <Modal wide title="Güncelleme taslağı" onClose={onClose}>
      <Async state={st}>{(p) => (
        <div className="stack">
          <div className="row"><strong>{p.articleTitle}</strong><Badge kind={KIND[p.kind][1]}>{KIND[p.kind][0]}</Badge><Badge kind={ST[p.status][1]}>{ST[p.status][0]}</Badge>{p.auto && <Badge kind="info">politika gereği otomatik</Badge>}</div>
          {p.currentVersion !== p.baseVersion && p.status === 'proposed' && <Alert kind="bad" title="Taslak eskidi">Makale bu taslaktan sonra değişti (taslak v{p.baseVersion}, makale v{p.currentVersion}). Yeniden hazırlatın.</Alert>}
          <p>{p.summary}</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{p.reasons.map((r, i) => <li key={i}><Badge>{r.code}</Badge> {r.text}</li>)}</ul>
          {p.checks && (
            <div className="row"><strong>Önerilen metnin kontrolleri:</strong><Badge kind={{ ok: 'ok', warn: 'warn', fail: 'bad' }[p.checks.rules]}>Kurallar: {p.checks.rules}</Badge>{p.checks.fact && <Badge kind={{ ok: 'ok', warn: 'warn', fail: 'bad', error: 'bad' }[p.checks.fact]}>Doğruluk: {p.checks.fact}</Badge>}
              {p.checks.risk && <Badge kind={RISK[p.checks.risk][1]}>AdSense: {RISK[p.checks.risk][0]}</Badge>}{p.checks.quality !== null && <ScoreBar value={p.checks.quality} />}{p.checks.errors.length > 0 && <Badge kind="bad">{p.checks.errors.length} kontrol çalışmadı</Badge>}</div>)}
          <small className="faint">Değişiklik: +{p.diffStats.added} / −{p.diffStats.removed} kelime (%{p.diffStats.changedShare}) · yazan {p.generation.provider} · kontrol {p.generation.checker}{p.generation.independentChecker ? ' (farklı model)' : ''} · maliyet {usd(p.generation.costUsd, 4)}{p.newSources.length > 0 ? ` · ${p.newSources.length} yeni kaynak` : ''}</small>
          {p.fields.length === 0 ? <Alert kind="warn">Alanlarda fark yok.</Alert> : p.fields.map((f) => <DiffView key={f.field} field={f} />)}
          {p.generation.wp && p.generation.wp.length > 0 && <Alert kind={p.generation.wp.every((w) => w.queued) ? 'ok' : 'warn'}>WordPress: {p.generation.wp.map((w) => (w.queued ? 'yazı güncelleme kuyruğa alındı' : `güncellenemedi (${w.error})`)).join('; ')}</Alert>}
          {p.note && <small className="faint">Not: {p.note}</small>}
          <div className="row end"><button className="btn" onClick={onClose}>Kapat</button>
            {can('publish.write') && p.status === 'proposed' && <><button className="btn danger" disabled={busy} onClick={() => act('reject')}>Reddet</button><button className="btn primary" disabled={busy || p.currentVersion !== p.baseVersion} onClick={() => act('apply')}>Onayla ve uygula</button></>}</div>
        </div>
      )}</Async>
    </Modal>
  );
}

/** Güncelleme Merkezi: the drafts the refresh engine prepared, with what exactly changes; a person approves or rejects */
export default function Updates() {
  const { projectId } = useApp();
  const [tab, setTab] = useState('proposed'); const [open, setOpen] = useState(null);
  const st = useLoad(() => (projectId ? api.get(`/updates${qs({ projectId, status: tab })}`) : Promise.resolve(null)), [projectId, tab]);
  if (!projectId) return <NeedsProject />;
  return (
    <div className="page">
      <PageHead title="Güncelleme Merkezi">Yayındaki ya da hazır makaleler için bozuk bağlantı ya da yeni haber gibi <strong>kanıtlara dayanan</strong> güncelleme taslakları. Taslak, siz uygulayana kadar makaleye dokunmaz; uygulanınca <strong>aynı makalenin yeni sürümü</strong> olur (adres değişmez), WordPress’teki yazı da güncellenir ve eski sürüm geri alınabilir. Onay politikası (Ayarlar → Güncelleme): tamamen manuel / küçük düzeltmeler otomatik / düşük riskli küçükler otomatik. Kapsamlı ve kritik değişiklikler her zaman sizin onayınızı bekler.</PageHead>
      <Tabs tabs={[['proposed', 'Onay bekleyen'], ['applied', 'Uygulanan'], ['rejected', 'Reddedilen'], ['stale', 'Eskiyen']]} value={tab} onChange={setTab} />
      <Async state={st}>{(d) => d && (d.proposals.length === 0 ? <Card><Empty title="Bu sekmede taslak yok">Taslaklar, İçerik Sağlığı botu bir kanıt bulduğunda ya da siz “Taslak hazırla”ya bastığınızda oluşur.</Empty></Card> : (
        <Card flat><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Makale</th><th>Tür</th><th>Neden</th><th>Değişiklik</th><th>Durum</th><th>Tarih</th><th /></tr></thead>
          <tbody>{d.proposals.map((p) => (
            <tr key={p.id}><td style={{ maxWidth: 280 }}><Link to={`/articles/${p.articleId}`}>{p.articleTitle}</Link></td><td><Badge kind={KIND[p.kind][1]}>{KIND[p.kind][0]}</Badge></td><td style={{ maxWidth: 320 }} className="muted">{p.summary}</td>
              <td className="faint">+{p.diffStats.added} / −{p.diffStats.removed}</td><td><Badge kind={ST[p.status][1]}>{ST[p.status][0]}</Badge>{p.auto && <div className="faint">otomatik</div>}</td><td className="faint">{dt(p.decidedAt || p.createdAt)}</td>
              <td className="num"><button className="btn sm" onClick={() => setOpen(p.id)}>Ayrıntı</button></td></tr>))}</tbody></table></div></Card>
      ))}</Async>
      {open && <Detail id={open} onClose={() => setOpen(null)} onDone={st.reload} />}
    </div>
  );
}
