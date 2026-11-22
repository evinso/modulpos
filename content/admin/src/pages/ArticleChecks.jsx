import { useState } from 'react';
import { ShieldCheck, Wand2 } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, ScoreBar, useAction, useApp, useLoad } from '../ui.jsx';
import { RISK, dt, num, usd } from '../format.js';

const ST = { ok: ['Tamam', 'ok'], warn: ['Uyarı', 'warn'], fail: ['Sorun', 'bad'], error: ['Çalışmadı', 'bad'], pass: ['Geçti', 'ok'] };
const VERDICT = { supported: ['Destekleniyor', 'ok'], partly_supported: ['Kısmen', 'warn'], unsupported: ['Kaynakta yok', 'bad'], contradicted: ['Çelişiyor', 'bad'], unverifiable: ['Doğrulanamadı', 'warn'] };
const PARTS = [['originality', 'Özgünlük ve ek değer'], ['accuracy', 'Doğruluk ve kaynak kalitesi'], ['usefulness', 'Okuyucuya fayda'], ['seo', 'SEO ve okunabilirlik'], ['editorial', 'Editoryal kalite']];
const Stale = ({ c }) => (c && c.stale ? <Badge kind="warn" title="Bu sonuç makalenin eski metnine ait">eski metne ait</Badge> : null);

/** The results of the mandatory checks of one article (free rules, fact check, AdSense/editorial review, quality score) and the buttons that run them again. */
export default function ArticleChecks({ art, onChanged }) {
  const { can, confirm, toast } = useApp();
  const st = useLoad(() => api.get(`/articles/${art.id}/checks`), [art.id, art.currentVersion, art.factCheckedAt, art.qualityScore, art.adsenseRisk]);
  const [run, busy] = useAction();
  const free = async () => { const r = await run(() => api.post(`/articles/${art.id}/checks/free`), 'Ücretsiz kontroller çalıştı'); if (r) { st.reload(); onChanged(); } };
  const all = async () => {
    if (!(await confirm({ title: 'Tüm kontroller yapay zekâ ile çalıştırılsın mı?', body: 'Doğruluk kontrolü ve AdSense/editoryal inceleme için seçili yapay zekâ servisine 2 istek gider; servisin kredisinden/bakiyesinden harcar (maliyet API Kullanımı sayfasına yazılır).', confirmText: 'Çalıştır' }))) return;
    const r = await run(() => api.post(`/articles/${art.id}/checks/run`));
    if (r) { if (r.errors && r.errors.length) toast(`${r.errors[0].check === 'fact' ? 'Doğruluk' : 'İnceleme'} kontrolü çalışmadı: ${r.errors[0].message}`, 'bad'); st.reload(); onChanged(); }
  };
  const g = art.generation && art.generation.provider ? art.generation : null;
  return (
    <Card title="Kontroller ve kalite" actions={<div className="row">{can('articles.write') && <button className="btn sm" disabled={busy} onClick={free}><ShieldCheck size={14} />Ücretsiz kontroller</button>}
      {can('research.paid') && <button className="btn sm primary" disabled={busy} onClick={all}><Wand2 size={14} />Tüm kontroller (yapay zekâ)</button>}</div>}>
      <Async state={st}>{(d) => {
        const q = d.quality && d.quality.result; const rules = d.rules && d.rules.result; const fact = d.fact && d.fact.result; const rev = d.review && d.review.result;
        return (
          <div className="stack">
            {g && <small className="faint">Yazan: <strong>{g.provider}</strong> ({g.model}) · {num(g.inputTokens)} + {num(g.outputTokens)} token · maliyet {usd(g.costUsd, 4)} · kontrol: {g.checker}{g.independentChecker ? ' (yazandan bağımsız model)' : ' (yazanla aynı model)'}</small>}
            {!q && <Alert kind="warn">Henüz kalite puanı yok: tüm kontroller çalışmadı.</Alert>}
            {q && (q.score === null
              ? <Alert kind="warn" title="Kalite puanı verilmedi">{q.note}</Alert>
              : <div className="stack"><div className="row"><strong>Kalite puanı</strong><ScoreBar value={q.score} /><Stale c={d.quality} /><span className="faint">(yayına hazır olması için Ayarlar’daki en düşük kalite puanı gerekir)</span></div>
                {PARTS.map(([k, l]) => <div key={k} className="row between"><span>{l} <span className="faint">(%{q.weights[k]})</span></span><ScoreBar value={q.parts[k]} /></div>)}</div>)}
            {rev && <div className="row"><strong>AdSense risk tahmini</strong>{RISK[rev.risk] && <Badge kind={RISK[rev.risk][1]}>{RISK[rev.risk][0]}</Badge>}<Stale c={d.review} /><small className="faint">{rev.disclaimer}</small></div>}
            {!rev && d.review && d.review.status === 'error' && <Alert kind="bad" title="AdSense/editoryal inceleme çalışmadı">{d.review.result.error}</Alert>}

            {rules && (
              <details open><summary><strong>Ücretsiz kurallar</strong> <Badge kind={ST[d.rules.status][1]}>{ST[d.rules.status][0]}</Badge> <Stale c={d.rules} /> <small className="faint">{dt(d.rules.createdAt)}</small></summary>
                <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}><tbody>{rules.items.map((i) => <tr key={i.key}><td>{i.label}</td><td><Badge kind={ST[i.status][1]}>{ST[i.status][0]}</Badge></td><td className="faint">{i.detail}</td></tr>)}</tbody></table></div></details>)}

            {d.fact && (
              <details open><summary><strong>Doğruluk kontrolü</strong> <Badge kind={ST[d.fact.status][1]}>{ST[d.fact.status][0]}</Badge> <Stale c={d.fact} /> {d.fact.provider && <small className="faint">{d.fact.provider}</small>}</summary>
                {d.fact.status === 'error' ? <Alert kind="bad">{fact.error}</Alert> : (
                  <div className="stack">
                    <small className="faint">{fact.counts.total} iddia · {fact.counts.majorProblems} önemli iddia doğrulanamadı/çelişkili · {fact.scope}{fact.note ? ` · ${fact.note}` : ''}</small>
                    <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}><thead><tr><th>İddia</th><th>Önem</th><th>Sonuç</th><th>Kaynaktan kanıt</th></tr></thead>
                      <tbody>{fact.claims.map((c, i) => <tr key={i}><td>{c.claim}</td><td>{c.importance === 'major' ? 'önemli' : 'küçük'}</td><td><Badge kind={VERDICT[c.verdict][1]}>{VERDICT[c.verdict][0]}</Badge></td><td className="faint">{c.evidenceVerified ? `“${c.evidence}”` : c.note || '—'}</td></tr>)}</tbody></table></div>
                  </div>)}</details>)}

            {rev && (
              <details><summary><strong>AdSense / editoryal inceleme (13 kategori)</strong> <Badge kind={ST[d.review.status][1]}>{ST[d.review.status][0]}</Badge></summary>
                <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}><tbody>{Object.entries(rev.categories).map(([k, c]) => <tr key={k}><td>{c.label}</td><td><Badge kind={ST[c.status][1]}>{ST[c.status][0]}</Badge></td><td className="faint">{c.note}</td></tr>)}</tbody></table></div>
                {rev.summary && <p className="muted">{rev.summary}</p>}
                {rev.improvements.length > 0 && <><strong>Önerilen düzeltmeler</strong><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{rev.improvements.map((x, i) => <li key={i}>{x}</li>)}</ul></>}</details>)}
          </div>
        );
      }}</Async>
    </Card>
  );
}
