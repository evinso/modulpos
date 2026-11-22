import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { Shuffle } from 'lucide-react';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Check, Empty, Field, Modal, Tabs, useAction, useApp, useLoad } from '../ui.jsx';
import { dt, num, usd } from '../format.js';

const ST = { running: ['Yazılıyor', 'info'], ready: ['Karar bekliyor', 'warn'], picking: ['Seçiliyor', 'info'], picked: ['Seçildi', 'ok'], discarded: ['Hiçbiri seçilmedi', ''], failed: ['Başarısız', 'bad'] };
const RULE = { ok: ['Tamam', 'ok'], warn: ['Uyarı', 'warn'], fail: ['Sorun', 'bad'] };

function Preview({ e }) {
  const clean = useMemo(() => DOMPurify.sanitize(e.fields.contentHtml, { USE_PROFILES: { html: true } }), [e.fields.contentHtml]);
  return (
    <div className="stack">
      <div><small className="faint">SEO başlığı ({e.measured.seoTitleChars} karakter)</small><div>{e.fields.seoTitle}</div></div>
      <div><small className="faint">Meta açıklama ({e.measured.metaChars} karakter)</small><div>{e.fields.metaDescription}</div></div>
      <h2 style={{ margin: 0 }}>{e.fields.h1}</h2>
      <div className="prose" dangerouslySetInnerHTML={{ __html: clean }} />
      {e.fields.faq.length > 0 && <div><strong>Sık sorulan sorular</strong>{e.fields.faq.map((f, i) => <div key={i}><em>{f.q}</em><div>{f.a}</div></div>)}</div>}
    </div>
  );
}

/** the numbers of every draft side by side (what can be measured without a model) */
function Numbers({ entries }) {
  const ok = entries.filter((e) => e.ok);
  const rows = [['Kelime', (m) => num(m.words)], ['H2 başlığı', (m) => m.h2], ['Okunabilirlik (yüksek = kolay)', (m) => (m.readability === null ? '—' : m.readability)], ['Ort. cümle uzunluğu', (m) => (m.avgSentenceWords === null ? '—' : String(m.avgSentenceWords).replace('.', ','))],
    ['Odak kelime (kez / yoğunluk)', (m) => `${m.keywordCount} / %${String(m.keywordDensityPct).replace('.', ',')}`], ['Odak kelime ilk 150 kelimede', (m) => (m.focusInFirst150 ? 'evet' : 'hayır')], ['SSS sayısı', (m) => m.faq], ['Kaynak bağlantısı', (m) => m.links]];
  return (
    <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}><thead><tr><th>Ölçüm (modelsiz, ücretsiz)</th>{ok.map((e) => <th key={e.label} className="num">Taslak {e.label}</th>)}</tr></thead>
      <tbody>{rows.map(([l, f]) => <tr key={l}><td>{l}</td>{ok.map((e) => <td key={e.label} className="num">{f(e.measured)}</td>)}</tr>)}
        <tr><td>Kurallar</td>{ok.map((e) => <td key={e.label} className="num"><Badge kind={RULE[e.measured.rules.status][1]}>{RULE[e.measured.rules.status][0]}</Badge>{e.measured.rules.problems.slice(0, 3).map((p, i) => <div key={i} className="faint" style={{ textAlign: 'right' }}>{p.label}: {p.detail}</div>)}</td>)}</tr>
        <tr><td>Kaynaklarla örtüşme</td>{ok.map((e) => <td key={e.label} className="num faint">{e.measured.copyOverlap || '—'}</td>)}</tr></tbody></table></div>
  );
}

function Detail({ id, onClose, onChanged }) {
  const { can, confirm } = useApp(); const admin = can('research.paid');
  const st = useLoad(() => api.get(`/comparisons/${id}`), [id]); const [tab, setTab] = useState(null); const [note, setNote] = useState(''); const [run, busy] = useAction();
  const c = st.data;
  useEffect(() => { if (c && c.status === 'running') { const t = setTimeout(() => st.reload(), 3000); return () => clearTimeout(t); } return undefined; }, [c]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = async (label) => {
    if (!(await confirm({ title: `Taslak ${label} makale yapılsın mı?`, body: 'Seçtiğiniz taslak arşive eklenir ve zorunlu kontroller (doğruluk, AdSense, kalite) çalışır; kendiliğinden yayımlanmaz. Seçtikten sonra hangi sağlayıcının yazdığı gösterilir. Diğer taslaklar atılır.', confirmText: 'Bunu seç' }))) return;
    if (await run(() => api.post(`/comparisons/${id}/pick`, { label }), 'Seçildi: makale taslağı oluşturuldu, kontroller arka planda çalışıyor')) { st.reload(); onChanged(); }
  };
  const discard = async () => {
    if (!(await confirm({ title: 'Hiçbiri seçilmesin mi?', body: 'Hiçbir taslak makale olmaz; fikir eski durumuna döner ve günün “yeni makale” yeri geri verilir. Çağrılar zaten yapıldığı için ücret geri gelmez. Sağlayıcılar gösterilir.', confirmText: 'Hiçbirini seçme' }))) return;
    if (await run(() => api.post(`/comparisons/${id}/discard`, { note }), 'Karar kaydedildi')) { st.reload(); onChanged(); }
  };
  return (
    <Modal wide title="Kör karşılaştırma" onClose={onClose}>
      <Async state={st}>{(d) => { const ok = d.entries.filter((e) => e.ok); const cur = tab && ok.find((e) => e.label === tab) ? tab : (ok[0] && ok[0].label); const e = ok.find((x) => x.label === cur); return (
        <div className="stack">
          <div className="row"><strong>{d.idea}</strong><Badge kind={ST[d.status][1]}>{ST[d.status][0]}</Badge><small className="faint">{dt(d.createdAt)}</small></div>
          {d.status === 'running' && <Alert kind="info">Taslaklar yazılıyor ({d.askedCount} sağlayıcıya soruldu). Bu birkaç dakika sürebilir; sayfa kendiliğinden yenilenir. Hangi sağlayıcının hangi harfe yazdığı karara kadar gizlidir.</Alert>}
          {d.status === 'failed' && <Alert kind="bad" title="Karşılaştırma tamamlanamadı">{d.error || 'Hiçbir sağlayıcı taslak veremedi.'}</Alert>}
          {d.status === 'ready' && <Alert kind="info" title="Kör okuma">Taslakları <strong>kim yazdığını bilmeden</strong> okuyun: harfler rastgele dağıtıldı. Ölçümler modelsizdir ve ücretsizdir; doğruluk ve AdSense kontrolleri yalnızca seçtiğiniz taslakta çalışır.{!d.comparable && <> <strong>Yalnızca bir taslak yazılabildi: bu bir karşılaştırma değil.</strong></>}</Alert>}
          {ok.length > 0 && <Numbers entries={d.entries} />}
          {d.entries.filter((x) => !x.ok).map((x) => <Alert key={x.label} kind="warn" title={`Taslak ${x.label} yazılamadı`}>{x.error}{!d.blind && x.provider ? ` (${x.provider})` : ''}</Alert>)}
          {ok.length > 0 && <Tabs tabs={ok.map((x) => [x.label, `Taslak ${x.label}${d.pickedLabel === x.label ? ' ✓' : ''}`])} value={cur} onChange={setTab} />}
          {e && <Card flat><Preview e={e} /></Card>}
          {d.status === 'ready' && admin && (
            <div className="stack">
              <Field label="Not (isteğe bağlı, yalnızca “hiçbiri” için)"><input className="input" value={note} onChange={(x) => setNote(x.target.value)} placeholder="ör. ikisi de basın bülteni gibi" /></Field>
              <div className="row end"><button className="btn" disabled={busy} onClick={discard}>Hiçbirini seçme</button>{e && <button className="btn primary" disabled={busy} onClick={() => pick(e.label)}>Taslak {e.label} bunu seç</button>}</div>
            </div>)}
          {d.status === 'ready' && !admin && <small className="faint">Seçimi yalnızca yönetici yapar.</small>}
          {!d.blind && d.entries.length > 0 && (
            <Card flat title="Kim yazmış?">
              <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}><thead><tr><th>Taslak</th><th>Sağlayıcı</th><th>Model</th><th className="num">Maliyet</th><th className="num">Token (giriş / çıkış)</th><th className="num">Süre</th><th className="num">Kelime</th><th /></tr></thead>
                <tbody>{d.entries.map((x) => <tr key={x.label}><td><strong>{x.label}</strong></td><td>{x.provider}</td><td>{x.model || '—'}</td><td className="num">{x.costUsd === null ? <Badge>Bilinmiyor</Badge> : usd(x.costUsd, 4)}</td><td className="num">{x.inputTokens === null || x.inputTokens === undefined ? '—' : `${num(x.inputTokens)} / ${num(x.outputTokens)}`}</td>
                  <td className="num">{x.durationMs === undefined ? '—' : `${(x.durationMs / 1000).toFixed(1)} sn`}</td><td className="num">{x.measured ? num(x.measured.words) : '—'}</td><td>{x.ok ? (d.pickedLabel === x.label ? <Badge kind="ok">seçildi</Badge> : null) : <Badge kind="bad">yazılamadı</Badge>}</td></tr>)}</tbody></table></div>
              {d.pickedArticleId && <div className="row" style={{ marginTop: 8 }}><Link className="btn sm primary" to={`/articles/${d.pickedArticleId}`}>Seçilen makaleyi aç</Link><small className="faint">Kontroller (doğruluk, AdSense, kalite) arka planda çalışır; sonuç makale sayfasında.</small></div>}
              {d.note && <div className="faint" style={{ marginTop: 6 }}>Notunuz: {d.note}</div>}
            </Card>)}
          <div className="row end"><button className="btn" onClick={onClose}>Kapat</button></div>
        </div>); }}</Async>
    </Modal>
  );
}

/** Karşılaştır: the same idea written by 2-3 vendors, read blind, one picked, then revealed */
export default function Compare() {
  const { projectId, can, confirm } = useApp(); const admin = can('research.paid');
  const ideas = useLoad(() => (projectId ? api.get(`/opportunities${qs({ projectId, eligible: 1 })}`) : Promise.resolve(null)), [projectId]);
  const status = useLoad(() => (projectId ? api.get(`/writer/status${qs({ projectId })}`) : Promise.resolve(null)), [projectId]);
  const list = useLoad(() => (projectId ? api.get(`/comparisons${qs({ projectId })}`) : Promise.resolve(null)), [projectId]);
  const stats = useLoad(() => api.get(`/comparisons/stats${qs({ projectId })}`), [projectId]);
  const [idea, setIdea] = useState(''); const [use, setUse] = useState({}); const [open, setOpen] = useState(null); const [run, busy] = useAction();
  const ready = status.data ? status.data.vendors.filter((v) => v.ready) : [];
  useEffect(() => { setUse((u) => { const n = { ...u }; ready.slice(0, 3).forEach((v) => { if (n[v.key] === undefined) n[v.key] = true; }); return n; }); }, [status.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (idea === '' && ideas.data && ideas.data.items.length) setIdea(ideas.data.items[0].id); }, [ideas.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const anyRunning = !!(list.data && list.data.comparisons.some((c) => c.status === 'running'));
  useEffect(() => { if (!anyRunning) return undefined; const t = setInterval(() => list.reload(), 3000); return () => clearInterval(t); }, [anyRunning]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!projectId) return null;
  const chosen = ready.filter((v) => use[v.key]).map((v) => v.key);
  const refresh = () => { list.reload(); stats.reload(); ideas.reload(); };
  const start = async () => {
    if (!(await confirm({ title: `${chosen.length} sağlayıcıya yazdırılsın mı?`, body: `Seçili fikir ${chosen.length} sağlayıcıya yazdırılır; her biri bir makale tutarında ücret alır (fiyatı girilmeyen sağlayıcının tutarı “Bilinmiyor” görünür). Günün “yeni makale” limitinden TEK yer alınır; hiçbirini seçmezseniz geri verilir. Taslakların kimin olduğu siz karar verene kadar gizli kalır.`, confirmText: 'Başlat' }))) return;
    const r = await run(() => api.post('/comparisons', { opportunityId: idea, providers: chosen }), 'Karşılaştırma başladı; taslaklar birkaç dakikada hazır olur');
    if (r && r.id) { refresh(); setOpen(r.id); }
  };
  return (
    <div className="stack">
      <Alert kind="info" title="Kör karşılaştırma nedir?">Aynı fikir, aynı kaynak metin ve aynı yönergeyle <strong>2-3 yapay zekâ sağlayıcısına</strong> yazdırılır. Taslakları A / B / C olarak, <strong>hangisini kimin yazdığını bilmeden</strong> okur ve en iyisini seçersiniz; ancak ondan sonra sağlayıcı, model ve maliyet gösterilir. Böylece marka önyargısı olmadan hangisinin sizin sitenize daha uygun yazdığını görürsünüz. Seçtiğiniz taslak normal makale gibi zorunlu kontrollerden geçer; seçilmeyenler atılır, <strong>makale olmaz</strong>.</Alert>
      <Card flat title="Yeni karşılaştırma">
        <Async state={status}>{(s) => (ready.length < 2 ? <Alert kind="warn" title="En az 2 hazır sağlayıcı gerekir">Şu an {ready.length} sağlayıcı hazır. <Link to="/api-usage">API Kullanımı</Link> sayfasında Claude, OpenAI ya da Gemini’den en az ikisinin anahtarını (OpenAI ve Gemini için model adıyla) girip bağlantıyı test edin.</Alert> : (
          <div className="stack">
            <Async state={ideas}>{(d) => (d.items.length === 0 ? <Empty title="Yazılmaya uygun fikir yok">İçerik Fırsatları sayfasında üretime uygun bir fikir olunca burada seçilir.</Empty> : (
              <Field label="Fikir"><select className="input" value={idea} onChange={(e) => setIdea(e.target.value)} aria-label="Karşılaştırılacak fikir">{d.items.map((i) => <option key={i.id} value={i.id}>{i.keyword || i.title}{i.categoryName ? ` — ${i.categoryName}` : ''}</option>)}</select></Field>))}</Async>
            <div><strong>Sağlayıcılar</strong><div className="stack" style={{ marginTop: 6 }}>{ready.map((v) => <Check key={v.key} checked={!!use[v.key]} onChange={(x) => setUse({ ...use, [v.key]: x })}>{v.label} <span className="faint">({v.model}{v.pricesKnown ? '' : ', fiyat girilmemiş: maliyeti bilinmez'})</span></Check>)}</div></div>
            {admin ? <div className="row"><button className="btn primary" disabled={busy || !idea || chosen.length < 2 || chosen.length > 3} onClick={start}><Shuffle size={15} />Kör karşılaştırmayı başlat</button>{(chosen.length < 2 || chosen.length > 3) && <small className="faint">2 ya da 3 sağlayıcı seçin.</small>}</div> : <small className="faint">Karşılaştırmayı yalnızca yönetici başlatır (ücretli işlem).</small>}
          </div>))}</Async>
      </Card>
      <Card flat title="Karşılaştırmalar">
        <Async state={list}>{(d) => (d.comparisons.length === 0 ? <Empty title="Henüz karşılaştırma yapılmadı" /> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Fikir</th><th>Durum</th><th>Zaman</th><th /></tr></thead>
            <tbody>{d.comparisons.map((c) => <tr key={c.id}><td style={{ maxWidth: 360 }}><strong>{c.idea}</strong></td><td><Badge kind={ST[c.status][1]}>{ST[c.status][0]}</Badge>{c.status === 'ready' && !c.comparable && <div className="faint">tek taslak</div>}</td><td className="faint">{dt(c.createdAt)}</td><td className="num"><button className="btn sm" onClick={() => setOpen(c.id)}>{c.status === 'ready' ? 'Oku ve seç' : 'Aç'}</button></td></tr>)}</tbody></table></div>))}</Async>
      </Card>
      <Async state={stats}>{(s) => s && s.decisions > 0 && (
        <Card flat title={`Seçimleriniz (${s.decisions} karar)`}>
          <div className="stack">
            <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}><thead><tr><th>Sağlayıcı</th><th className="num">Gösterilen taslak</th><th className="num">Seçilen</th><th className="num">Seçilme oranı</th><th className="num">Ort. maliyet</th><th className="num">Ort. kelime</th></tr></thead>
              <tbody>{s.providers.map((p) => <tr key={p.provider}><td>{p.provider}{s.leader === p.provider && <> <Badge kind="info">şimdilik önde</Badge></>}</td><td className="num">{p.shown}</td><td className="num">{p.picked}</td><td className="num">{p.pickRate === null ? '—' : `%${p.pickRate}`}</td><td className="num">{p.avgCostUsd === null ? <Badge title={`${p.unknownCostDrafts} taslağın maliyeti bilinmiyor`}>Bilinmiyor</Badge> : usd(p.avgCostUsd, 4)}</td><td className="num">{p.avgWords === null ? '—' : num(p.avgWords)}</td></tr>)}</tbody></table></div>
            <small className="faint">{s.note} Yazar sağlayıcıyı Ayarlar → Makale kalitesi’nden siz değiştirirsiniz; bu sayfa hiçbir ayarı kendiliğinden değiştirmez.</small>
            <small className="faint">Not: bir yazının üslubu sağlayıcıyı ele verebilir; “kör” olması ad, model, maliyet ve süre gibi üst bilgilerin gizlenmesi demektir.</small>
          </div>
        </Card>)}</Async>
      {open && <Detail id={open} onClose={() => setOpen(null)} onChanged={refresh} />}
    </div>
  );
}
