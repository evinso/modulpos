import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { BookOpen, Search, X, Rocket, Wallet, Store, FileCode2, Tags, Package, FolderTree, Send, TrendingUp, MessageSquare, ShoppingCart, Activity, LifeBuoy, ListTree } from 'lucide-react';
import { SECTIONS, GUIDE_UPDATED } from './content';
import { filterSections } from './guideText';
import { Block } from './GuideBlocks';

const ICONS = { rocket: Rocket, wallet: Wallet, store: Store, file: FileCode2, tags: Tags, package: Package, folder: FolderTree, send: Send, trend: TrendingUp, message: MessageSquare, cart: ShoppingCart, activity: Activity, help: LifeBuoy, book: BookOpen };

const CSS = `
  .guide-layout { display: grid; grid-template-columns: 1fr; gap: 24px; }
  .guide-toc { display: none; }
  .guide-toc-mobile { display: block; }
  @media (min-width: 980px) {
    .guide-layout { grid-template-columns: 250px minmax(0, 1fr); }
    .guide-toc { display: block; position: sticky; top: 16px; align-self: start; max-height: calc(100vh - 40px); overflow-y: auto; }
    .guide-toc-mobile { display: none; }
  }
  .guide-toc a { display: block; padding: 4px 10px; border-radius: 6px; font-size: 13px; color: var(--text-secondary); text-decoration: none; }
  .guide-toc a:hover { background: var(--bg-tertiary); }
  .guide-toc a.on { background: rgba(99,102,241,0.12); color: var(--accent-primary); font-weight: 600; }
  .guide-toc .sec { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted); padding: 12px 10px 4px; }
  .guide-topic { scroll-margin-top: 16px; padding: 18px 0; border-top: 1px solid var(--border-color); font-size: 14px; }
  .guide-topic:first-of-type { border-top: none; }
`;

function Toc({ sections, active, onJump }) {
  return (
    <nav aria-label="İçindekiler">
      {sections.map((s) => (
        <div key={s.id}>
          <div className="sec">{s.title}</div>
          {s.topics.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={active === t.id ? 'on' : ''} onClick={(e) => { e.preventDefault(); onJump(t.id); }}>{t.title}</a>
          ))}
        </div>
      ))}
    </nav>
  );
}

export default function GuidePage() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(SECTIONS[0].topics[0].id);
  const pending = useRef(null);

  const shown = useMemo(() => filterSections(SECTIONS, query), [query]);
  const count = useMemo(() => shown.reduce((n, s) => n + s.topics.length, 0), [shown]);

  const scrollTo = useCallback((id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try { window.history.replaceState(null, '', `#${id}`); } catch { /* ignore */ }
    setActive(id);
    return true;
  }, []);

  // A link to a topic the current search has hidden: clear the search first, then go there once it is shown again
  const jump = useCallback((id) => {
    if (scrollTo(id)) return;
    pending.current = id;
    setQuery('');
  }, [scrollTo]);
  useEffect(() => { if (pending.current && !query) { const id = pending.current; pending.current = null; setTimeout(() => scrollTo(id), 0); } }, [query, shown, scrollTo]);

  // Deep link: /guide#sablon-vergi
  useEffect(() => {
    const id = window.location.hash.replace('#', '');
    if (id) setTimeout(() => scrollTo(id), 50);
  }, [scrollTo]);

  // Highlight the topic being read in the table of contents
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: '0px 0px -70% 0px' });
    document.querySelectorAll('.guide-topic').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [shown]);

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 16px' }}>
      <style>{CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <BookOpen size={20} style={{ color: 'var(--accent-primary)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Kullanma Kılavuzu</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>Kurulumdan kâr hesabına kadar adım adım rehber · son güncelleme {GUIDE_UPDATED}</p>
        </div>
        <div style={{ position: 'relative', width: 'min(100%, 340px)' }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--text-muted)' }} />
          <input className="form-input" aria-label="Rehberde ara" placeholder="Rehberde ara (ör. stopaj, kargo, kategori)…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: 34, paddingRight: 32 }} />
          {query && <button type="button" aria-label="Aramayı temizle" onClick={() => setQuery('')} style={{ position: 'absolute', right: 6, top: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={16} /></button>}
        </div>
      </div>

      <div className="guide-layout">
        <aside className="guide-toc card" style={{ padding: 8 }} data-testid="toc">
          <Toc sections={shown} active={active} onJump={jump} />
        </aside>

        <main>
          <details className="guide-toc-mobile card" style={{ padding: '8px 12px', marginBottom: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}><ListTree size={16} style={{ verticalAlign: -3 }} /> İçindekiler</summary>
            <div className="guide-toc" style={{ display: 'block', position: 'static' }}><Toc sections={shown} active={active} onJump={jump} /></div>
          </details>

          {query && (
            <div role="status" data-testid="search-count" style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {count > 0 ? `“${query}” için ${count} konu bulundu.` : `“${query}” için sonuç bulunamadı. Başka bir kelime deneyin (ör. fiyat, kategori, kargo, stopaj, komisyon).`}
            </div>
          )}

          {shown.map((s) => {
            const Icon = ICONS[s.icon] || BookOpen;
            return (
              <section key={s.id} className="card" style={{ padding: '18px 22px', marginBottom: 16 }} aria-labelledby={`sec-${s.id}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
                  <Icon size={19} style={{ color: 'var(--accent-primary)' }} />
                  <h2 id={`sec-${s.id}`} style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{s.title}</h2>
                </div>
                <p style={{ margin: '2px 0 4px 29px', fontSize: 13, color: 'var(--text-muted)' }}>{s.intro}</p>
                {s.topics.map((t) => (
                  <article key={t.id} id={t.id} className="guide-topic" data-testid="topic">
                    <h3 style={{ margin: '0 0 4px', fontSize: 15.5, fontWeight: 700 }}>{t.title}</h3>
                    {t.blocks.map((b, i) => <Block key={i} b={b} onJump={jump} />)}
                  </article>
                ))}
              </section>
            );
          })}
        </main>
      </div>
    </div>
  );
}
