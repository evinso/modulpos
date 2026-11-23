import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, Empty, Field, Modal, NeedsProject, PageHead, useAction, useApp, useLoad } from '../ui.jsx';
import { dt } from '../format.js';

const ST = { passed: ['Geçti', 'ok'], missing: ['Eksik', 'bad'], warning: ['Uyarı', 'warn'], manual: ['Elle kontrol', 'info'], na: ['Uygulanmaz', ''] };
const VERDICT = { unreachable: ['Site okunamadı', 'bad'], not_ready: ['Eksikler var', 'bad'], almost: ['Büyük eksik yok, uyarılar var', 'warn'], checks_clean: ['Otomatik kontroller temiz', 'ok'] };
const GROUPS = [['pages', 'Gerekli sayfalar'], ['tech', 'Teknik durum'], ['content', 'İçerik'], ['ads', 'Reklam ve onay'], ['manual', 'Elle kontrol (otomatik denetim karar veremez)']];

function Counts({ s }) {
  if (!s) return null;
  return <div className="row" style={{ gap: 6 }}>{['passed', 'missing', 'warning', 'manual', 'na'].filter((k) => s[k] > 0).map((k) => <Badge key={k} kind={ST[k][1]}>{s[k]} {ST[k][0].toLowerCase()}</Badge>)}</div>;
}

function Detail({ id, onClose }) {
  const st = useLoad(() => api.get(`/adsense/audits/${id}`), [id]);
  const [open, setOpen] = useState({});
  return (
    <Modal wide title="AdSense site denetimi" onClose={onClose}>
      <Async state={st}>{(a) => (
        <div className="stack">
          <div className="row"><strong style={{ wordBreak: 'break-all' }}>{a.url}</strong>{a.verdict && <Badge kind={VERDICT[a.verdict][1]}>{a.verdictLabel}</Badge>}<small className="faint">{dt(a.finishedAt || a.startedAt)}{a.durationMs ? ` · ${(a.durationMs / 1000).toFixed(1)} sn` : ''}</small></div>
          <Alert kind={a.verdict === 'checks_clean' ? 'ok' : a.verdict === 'unreachable' || a.verdict === 'not_ready' ? 'bad' : 'warn'}>{a.verdictText}</Alert>
          <Counts s={a.summary} />
          {a.facts && a.facts.changes && a.facts.changes.length > 0 && (
            <Alert kind="info" title="Önceki denetimden bu yana değişenler">{a.facts.changes.map((c) => <div key={c.key}>{c.label}: {ST[c.from][0]} → <strong>{ST[c.to][0]}</strong></div>)}</Alert>)}
          {GROUPS.map(([g, label]) => {
            const rows = (a.items || []).filter((i) => i.group === g); if (!rows.length) return null;
            return (
              <Card flat key={g} title={label}>
                <div className="tbl-wrap"><table className="tbl"><tbody>{rows.map((i) => (
                  <tr key={i.key}>
                    <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}><Badge kind={ST[i.status][1]}>{ST[i.status][0]}</Badge></td>
                    <td><strong>{i.label}</strong>{i.required && <> <Badge kind="info" title="AdSense’in kendi kurallarında gerekli sayılan madde">zorunlu</Badge></>}
                      <div>{i.detail}</div>
                      {i.fix && i.status !== 'passed' && i.status !== 'na' && <div className="faint"><button className="btn sm ghost" onClick={() => setOpen({ ...open, [i.key]: !open[i.key] })}>{open[i.key] ? 'Gizle' : 'Nasıl düzeltilir?'}</button>{open[i.key] && <div style={{ marginTop: 4 }}>{i.fix}</div>}</div>}
                    </td></tr>))}</tbody></table></div>
              </Card>);
          })}
          <small className="faint">Bu denetim yalnızca sitenin herkese açık sayfalarını okur; bir onay değildir ve AdSense onayını garanti etmez. Zorunlu işaretli maddeler AdSense’in kendi kurallarından gelir; diğerleri yaygın beklentilerdir ve metinde öyle yazılıdır.</small>
          <div className="row end"><button className="btn" onClick={onClose}>Kapat</button></div>
        </div>
      )}</Async>
    </Modal>
  );
}

/** AdSense Denetimi: is a WordPress site ready for an AdSense application? A checklist from the public pages, never an approval */
export default function AdsenseAudit() {
  const { projectId, can } = useApp();
  const st = useLoad(() => (projectId ? api.get(`/adsense/overview?projectId=${projectId}`) : Promise.resolve(null)), [projectId]);
  const [url, setUrl] = useState(''); const [detail, setDetail] = useState(null); const [run, busy] = useAction();
  const busyNow = !!(st.data && (st.data.pending.length || st.data.running.length));
  const tries = useRef(0);
  useEffect(() => {                                                                    // while an audit is queued or running, look again every 3 seconds (for up to 3 minutes)
    if (!busyNow) { tries.current = 0; return undefined; }
    const t = setInterval(() => { tries.current += 1; if (tries.current > 60) clearInterval(t); else st.reload(); }, 3000);
    return () => clearInterval(t);
  }, [busyNow]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!projectId) return <NeedsProject />;
  const start = async (body) => { if (await run(() => api.post('/adsense/audits', { projectId, ...body }), 'Denetim kuyruğa alındı; birkaç saniye içinde sonuç görünür')) { setUrl(''); st.reload(); } };
  return (
    <div className="page">
      <PageHead title="AdSense Denetimi">Bir WordPress sitesinin AdSense başvurusuna ne kadar hazır olduğunu, sitenin <strong>herkese açık sayfalarını</strong> okuyarak denetler: gerekli sayfalar (Hakkımızda, İletişim, Gizlilik Politikası), çerez/reklam açıklaması, SSL, site haritası, robots.txt, canonical, kırık bağlantılar, içerik, yazar bilgisi, ads.txt, AdSense kodu ve çerez onay aracı. Ücretsizdir, hiçbir şey yazmaz. <strong>Sonuç bir onay değildir:</strong> AdSense’in kararını, hesap durumunu ve içeriğin değerini bu platform bilemez; onlar “elle kontrol” olarak listelenir.</PageHead>
      <Async state={st}>{(d) => d && (
        <div className="stack">
          {can('research.write') && (
            <Card flat title="Denetle">
              <div className="stack">
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <Field label="Site adresi" hint="Henüz WordPress bağlantısı kurmadıysanız da bir adres yazıp denetleyebilirsiniz."><input className="input" style={{ minWidth: 300 }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://siteniz.com" aria-label="Denetlenecek adres" /></Field>
                  <button className="btn primary" disabled={busy || !url.trim()} onClick={() => start({ url: url.trim() })}><ShieldCheck size={15} />Denetle</button>
                </div>
                {d.sites.length > 0 && <div className="row"><small className="faint">Bağlı siteler:</small>{d.sites.map((s) => <button key={s.id} className="btn sm" disabled={busy} onClick={() => start({ siteId: s.id })}>{s.name} <span className="faint">({s.url.replace(/^https?:\/\//, '')})</span>{s.adsensePubId ? '' : ' · yayıncı no yok'}</button>)}</div>}
                {busyNow && <Alert kind="info">Bir denetim çalışıyor ({[...d.pending.map((p) => p.url), ...d.running].filter((v, i, a) => a.indexOf(v) === i).join(', ')}). Sayfa kendiliğinden yenilenir.</Alert>}
              </div>
            </Card>)}
          {d.latest.length === 0 ? <Card><Empty title="Henüz denetim yapılmadı">Yukarıya sitenizin adresini yazıp “Denetle”ye basın. Bağlı siteler her hafta kendiliğinden denetlenir (Otomasyon ve Ayarlar → Botlar → AdSense Compliance Bot).</Empty></Card> : (
            <div className="stack">{d.latest.map((a) => (
              <Card key={a.id} flat title={a.url} actions={<>{a.verdict ? <Badge kind={VERDICT[a.verdict][1]}>{a.verdictLabel}</Badge> : <Badge kind="bad">Başarısız</Badge>}{a.trigger === 'schedule' && <Badge>haftalık</Badge>}</>}>
                <div className="stack">
                  {a.status === 'failed' ? <Alert kind="bad" title="Denetim tamamlanamadı">{a.error}</Alert> : <p>{a.verdictText}</p>}
                  <Counts s={a.summary} />
                  {a.summary && a.summary.requiredMissing.length > 0 && <small>Zorunlu eksikler: <strong>{a.summary.requiredMissing.length}</strong></small>}
                  <small className="faint">{dt(a.finishedAt || a.startedAt)}{a.facts && a.facts.changes && a.facts.changes.length > 0 ? ` · öncekine göre ${a.facts.changes.length} değişiklik` : ''}</small>
                  <div className="row">
                    <button className="btn sm primary" onClick={() => setDetail(a.id)}>Ayrıntı</button>
                    {can('research.write') && <button className="btn sm" disabled={busy || busyNow} onClick={() => start({ url: a.url })}><RefreshCw size={14} />Yeniden denetle</button>}
                  </div>
                </div>
              </Card>))}</div>)}
          <small className="faint">AdSense yayıncı numaranız oluşunca “<Link to="/sites">Web Sitelerim</Link> → Ayarlar”a yazın: o zaman AdSense kodu ve ads.txt satırı da denetlenir.</small>
        </div>
      )}</Async>
      {detail && <Detail id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
