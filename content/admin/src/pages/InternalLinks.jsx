import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Search } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, Empty, NeedsProject, PageHead, Tabs, useAction, useApp, useLoad } from '../ui.jsx';

const TABS = [['suggested', 'Bekleyen'], ['applied', 'Uygulanan'], ['rejected', 'Reddedilen'], ['stale', 'Eskiyen']];
const DIR = { new_to_old: ['Yeni → eski', 'info'], old_to_new: ['Eski → yeni', 'warn'] };

/** the sentence with the anchor words marked, so the person sees exactly where the link would go */
function Marked({ text, anchor }) {
  const i = String(text || '').toLowerCase().indexOf(anchor.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + anchor.length)}</mark>{text.slice(i + anchor.length)}</>;
}

/** İç Bağlantılar: link suggestions between the project's own articles, from words the articles already contain; a person decides */
export default function InternalLinks() {
  const { projectId, can, confirm, toast } = useApp();
  const [tab, setTab] = useState('suggested');
  const st = useLoad(() => (projectId ? api.get(`/internal-links?projectId=${projectId}&status=${tab}`) : Promise.resolve(null)), [projectId, tab]);
  const [run, busy] = useAction();
  if (!projectId) return <NeedsProject />;
  const find = async () => { const r = await run(() => api.post('/internal-links/find', { projectId })); if (r) { toast(r.created ? `${r.created} yeni öneri bulundu` : 'Yeni öneri bulunamadı'); st.reload(); } };
  const apply = async (l) => {
    if (!(await confirm({ title: `“${l.anchor}” sözcüklerine bağlantı eklensin mi?`, body: `“${l.fromTitle}” makalesinde bu sözcükler “${l.toTitle}” makalesine bağlanır. Makale yeni bir sürüm olur (metin değişmez, kontroller geçerli kalır) ve sitedeki yazı güncellenir.`, confirmText: 'Bağlantıyı ekle' }))) return;
    await run(() => api.post(`/internal-links/${l.id}/apply`, {}), 'Bağlantı eklendi');
    st.reload();                                                         // a refused one (stale / target not public) changes its state too: always show the truth
  };
  const reject = async (l) => { if (await run(() => api.post(`/internal-links/${l.id}/reject`, {}), 'Öneri reddedildi; aynı öneri bir daha sunulmaz')) st.reload(); };
  return (
    <div className="page">
      <PageHead title="İç Bağlantılar" actions={can('research.write') && <button className="btn primary" disabled={busy} onClick={find}><Search size={15} />Yeni öneri ara</button>}>
        Makalelerinizin birbirine bağlanacağı yerler. Öneriler <strong>yapay zekâsız ve ücretsizdir</strong>: bir makale, başka bir makalenin odak ifadesini <em>zaten yazıyorsa</em> o sözcükler bağlantıya dönüşür; hiçbir cümle yeniden yazılmaz, başlıklara ve zaten bağlantı olan yerlere dokunulmaz. Bir makaleye en çok 3 öneri çıkar. Hedef makale yayında değilse öneri taslak kalır; bağlantıyı <strong>yalnızca yönetici</strong> uygular.
      </PageHead>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <Async state={st}>{(d) => d && (d.links.length === 0 ? <Card><Empty title={tab === 'suggested' ? 'Bekleyen öneri yok' : 'Kayıt yok'}>{tab === 'suggested' ? 'Makaleler arasında henüz uygun bir yer bulunamadı. Yeni makaleler yazıldıkça ya da “Yeni öneri ara”ya basınca yeniden aranır (her gün kendiliğinden de bakılır).' : 'Bu durumda öneri bulunmuyor.'}</Empty></Card> : (
        <div className="stack">
          {tab === 'suggested' && d.links.some((l) => l.draft) && <Alert kind="info">“Taslak” etiketli önerilerin hedef makalesi henüz herkese açık değil; hedef yayımlanınca uygulanabilir.</Alert>}
          {d.links.map((l) => (
            <Card key={l.id} flat>
              <div className="stack">
                <div className="row"><Link2 size={14} /><Link to={`/articles/${l.fromArticleId}`}><strong>{l.fromTitle}</strong></Link><span className="faint">→</span><Link to={`/articles/${l.toArticleId}`}><strong>{l.toTitle}</strong></Link>
                  <Badge kind={DIR[l.direction][1]}>{DIR[l.direction][0]}</Badge>{l.draft && <Badge kind="warn" title="Hedef makalenin herkese açık adresi yok">Taslak</Badge>}<Badge title="Öneri puanı: ifadenin uzunluğu ve aynı kategoriden olma">puan {l.score}</Badge></div>
                <div>Bağlantı olacak sözcükler: <strong>“{l.anchor}”</strong></div>
                <blockquote className="faint" style={{ margin: 0, paddingLeft: 10, borderLeft: '3px solid var(--line)' }}><Marked text={l.context} anchor={l.anchor} /></blockquote>
                {l.toUrl && <small className="faint">Gidecek adres: {l.toUrl}</small>}
                {l.status === 'applied' && <small className="faint">Makalenin v{l.appliedVersion} sürümünde uygulandı.</small>}
                <div className="row end">
                  {tab === 'suggested' && can('articles.write') && <button className="btn sm" disabled={busy} onClick={() => reject(l)}>Reddet</button>}
                  {tab === 'suggested' && can('publish.write') && <button className="btn sm primary" disabled={busy || l.draft} title={l.draft ? 'Hedef makale henüz yayında değil' : undefined} onClick={() => apply(l)}>Bağlantıyı ekle</button>}
                </div>
              </div>
            </Card>))}
        </div>
      ))}</Async>
    </div>
  );
}
