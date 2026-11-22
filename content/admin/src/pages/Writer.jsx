import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Alert, Async, Badge, Card, Empty, NeedsProject, PageHead, useApp, useLoad } from '../ui.jsx';
import { dt, num, usd } from '../format.js';

const RUN = { ok: ['Tamam', 'ok'], partial: ['Kısmen', 'warn'], error: ['Başarısız', 'bad'], running: ['Çalışıyor', 'info'] };

/** The writer's overview: which model vendors are ready, who writes and who checks, and the history of every writing run with its cost. Writing itself starts from an idea. */
export default function Writer() {
  const { projectId } = useApp();
  const st = useLoad(() => (projectId ? api.get(`/writer/status${qs({ projectId })}`) : Promise.resolve(null)), [projectId]);
  const runs = useLoad(() => (projectId ? api.get(`/runs${qs({ bot: 'article_writer', projectId, limit: 30 })}`) : Promise.resolve(null)), [projectId]);
  if (!projectId) return <NeedsProject />;
  return (
    <div className="page">
      <PageHead title="AI Makale Üretimi">Makale yazmak için <Link to="/opportunities">İçerik Fırsatları</Link> sayfasında uygun bir fikrin yanındaki <strong>“Makale yaz”</strong> düğmesine basın. Model, habere ait kaynak sayfaları okuyup özgün bir taslak yazar; ardından doğruluk kontrolü, AdSense/editoryal inceleme ve kalite puanı çıkarılır. Taslak <strong>asla kendiliğinden yayımlanmaz</strong>: Makale Arşivi’nde “Onay bekliyor” olarak sizi bekler.</PageHead>
      <Async state={st}>{(d) => d && (
        <Card title="Yapay zekâ sağlayıcıları" actions={<Link className="btn sm" to="/api-usage">Anahtarlar</Link>}>
          <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}><thead><tr><th>Sağlayıcı</th><th>Model</th><th>Durum</th><th>Rol</th></tr></thead>
            <tbody>{d.vendors.map((v) => <tr key={v.key}><td>{v.label}</td><td>{v.model || '—'}</td><td>{v.ready ? <Badge kind="ok">Hazır</Badge> : <Badge>{v.reason}</Badge>}{v.ready && !v.pricesKnown && <div className="faint">fiyat girilmedi: maliyet “Bilinmiyor” görünür</div>}</td>
              <td>{d.picks && d.picks.writer === v.key ? <Badge kind="info">yazar</Badge> : null} {d.picks && d.picks.checker === v.key ? <Badge kind="info">kontrol</Badge> : null}</td></tr>)}</tbody></table></div>
          {!d.ready ? <Alert kind="warn" title="Henüz makale yazılamaz">En az bir sağlayıcının anahtarını (OpenAI ve Gemini için model adıyla birlikte) API Kullanımı sayfasına girip bağlantıyı test edin.</Alert>
            : <small className="faint">{d.picks.independent ? 'Kontrolleri yazandan FARKLI bir model yapar (bir model kendi yazdığını değerlendirirken yanlı olabilir).' : 'Tek sağlayıcı hazır olduğu için kontrolü yazan modelin kendisi yapar; ikinci bir sağlayıcı bağlarsanız kontrol otomatik olarak ona geçer.'} Seçimi Sistem Ayarları → Kalite bölümünden değiştirebilirsiniz.</small>}
        </Card>)}</Async>
      <Card title="Yazım geçmişi">
        <Async state={runs}>{(d) => d && (d.runs.length === 0 ? <Empty title="Henüz makale yazılmadı" /> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Fikir</th><th>Yazan / kontrol</th><th>Durum</th><th className="num">Çağrı</th><th className="num">Maliyet</th><th>Zaman</th><th /></tr></thead>
            <tbody>{d.runs.map((r) => { const s = r.stats || {}; return (
              <tr key={r.id}><td style={{ maxWidth: 320 }}><strong>{s.idea || '—'}</strong><div className="faint">{s.keyword}{s.sources ? ` · ${s.sourcesRead}/${s.sources} kaynak sayfası okundu` : ''}</div>{r.error && <div className="faint" style={{ color: 'var(--bad)' }}>{r.error}</div>}</td>
                <td>{s.writer}{s.checker && s.checker !== s.writer ? ` / ${s.checker}` : ''}</td><td><Badge kind={RUN[r.status][1]}>{RUN[r.status][0]}</Badge>{r.status === 'running' && s.step && <div className="faint">{s.step}</div>}{s.quality !== undefined && s.quality !== null && <div className="faint">kalite {s.quality}</div>}</td>
                <td className="num">{num(s.calls)}</td><td className="num">{s.calls ? <>{usd(s.costUsd, 4)}{s.unknownCost > 0 && <div className="faint">+{s.unknownCost} çağrı bilinmiyor</div>}</> : '—'}</td><td className="faint">{dt(r.startedAt)}{r.seconds !== null && ` · ${r.seconds} sn`}</td>
                <td className="num">{s.articleId && <Link className="btn sm" to={`/articles/${s.articleId}`}>Makale</Link>}</td></tr>); })}</tbody></table></div>))}</Async>
      </Card>
    </div>
  );
}
