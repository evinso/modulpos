import { useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Async, Badge, Card, Empty, Field, Modal, NeedsProject, PageHead, Tabs, useAction, useApp, useLoad } from '../ui.jsx';

const ST = { new: ['Yeni', 'info'], accepted: ['Kabul edildi', 'ok'], rejected: ['Reddedildi', ''], later: ['Sonra bakılacak', 'warn'] };

function Decide({ s, categories, onClose, onDone }) {
  const [mode, setMode] = useState('new_category');
  const [f, setF] = useState({ name: s.label, nameEn: s.label, categoryId: categories[0] ? categories[0].id : '' });
  const [run, busy] = useAction();
  const go = async () => { if (await run(() => api.post(`/niche-suggestions/${s.id}/decide`, { action: 'accept', mode, ...f }), 'Öneri kabul edildi')) { onDone(); onClose(); } };
  return (
    <Modal title={`“${s.label}” önerisini kabul et`} onClose={onClose}>
      <div className="stack">
        <div className="row"><label className="check"><input type="radio" checked={mode === 'new_category'} onChange={() => setMode('new_category')} />Yeni kategori oluştur</label><label className="check"><input type="radio" checked={mode === 'link_category'} onChange={() => setMode('link_category')} />Mevcut kategoriye bağla</label></div>
        {mode === 'new_category' ? <><Field label="Kategori adı (Türkçe)"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="İngilizce ad (sitede görünen)"><input className="input" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
          <Alert kind="info">Yeni kategori %0 pay ile başlar; Strateji sayfasından pay verin.</Alert></>
          : <Field label="Kategori" hint="Öneri terimleri bu kategorinin anahtar kelimelerine eklenir; haber filtresi bundan sonra bu konuları da kapsar."><select className="input" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select></Field>}
        <div className="row end"><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy} onClick={go}>Kabul et</button></div>
      </div>
    </Modal>
  );
}

export default function Niche() {
  const { projectId, can } = useApp();
  const [tab, setTab] = useState('new');
  const st = useLoad(() => (projectId ? api.get(`/niche-suggestions?projectId=${projectId}`) : Promise.resolve(null)), [projectId]);
  const cats = useLoad(() => (projectId ? api.get(`/projects/${projectId}/categories`) : Promise.resolve({ categories: [] })), [projectId]);
  const [run, busy] = useAction(); const [dec, setDec] = useState(null);
  if (!projectId) return <NeedsProject />;
  const discover = async () => { const r = await run(() => api.post('/niche-suggestions/discover', { projectId })); if (r) { st.reload(); } };
  const act = async (s, action) => { if (await run(() => api.post(`/niche-suggestions/${s.id}/decide`, { action }), action === 'reject' ? 'Reddedildi' : 'Sonraya bırakıldı')) st.reload(); };
  const categories = cats.data ? cats.data.categories.filter((c) => c.status !== 'archived') : [];
  return (
    <div className="page">
      <PageHead title="Niş Keşif Merkezi" actions={can('research.write') && <button className="btn primary" disabled={busy} onClick={discover}><Search size={15} />Yeni öneri ara</button>}>
        Sitenizin kendi kaynaklarında sık geçen ama hiçbir kategorinin kapsamadığı konular burada önerilir. Hiçbir öneri kendiliğinden siteye eklenmez: kabul edebilir, reddedebilir ya da sonraya bırakabilirsiniz. Yöntem, son 14 günün nişe uymayan haber başlıklarında tekrar eden kelime çiftlerini saymaktır; bir konunun sitenize uyup uymadığına siz karar verirsiniz.
      </PageHead>
      <Tabs tabs={[['new', 'Yeni ve bekleyen'], ['accepted', 'Kabul edilen'], ['rejected', 'Reddedilen']]} value={tab} onChange={setTab} />
      <Async state={st}>{(d) => {
        const list = d.suggestions.filter((s) => (tab === 'new' ? ['new', 'later'].includes(s.status) : s.status === tab));
        return list.length === 0 ? <Card><Empty title="Öneri yok">{tab === 'new' ? '“Yeni öneri ara” ile son haberlerden öneri çıkarın. Öneri çıkması için önce haber taraması yapılmış olmalı.' : 'Bu listede kayıt yok.'}</Empty></Card> : (
          <div className="grid g2" style={{ alignItems: 'start' }}>{list.map((s) => (
            <Card key={s.id} title={s.label} actions={<Badge kind={ST[s.status][1]}>{ST[s.status][0]}</Badge>}>
              <p className="muted">Son {s.evidence.days} günde <strong>{s.evidence.items}</strong> haberde, <strong>{s.evidence.sources}</strong> farklı kaynakta geçti. Terim: <span className="mono">{s.terms.join(', ')}</span></p>
              <ul style={{ margin: '8px 0', paddingLeft: 18 }}>{s.evidence.samples.map((x, i) => <li key={i}><a href={x.url} target="_blank" rel="noopener noreferrer nofollow">{x.title}</a> <span className="faint">— {x.source}</span></li>)}</ul>
              {can('categories.write') && ['new', 'later'].includes(s.status) && <div className="row"><button className="btn primary sm" onClick={() => setDec(s)}>Kabul et…</button><button className="btn sm" onClick={() => act(s, 'later')} disabled={s.status === 'later'}>Sonra bak</button><button className="btn sm danger" onClick={() => act(s, 'reject')}>Reddet</button></div>}
            </Card>))}</div>
        );
      }}</Async>
      {dec && <Decide s={dec} categories={categories} onClose={() => setDec(null)} onDone={st.reload} />}
    </div>
  );
}
