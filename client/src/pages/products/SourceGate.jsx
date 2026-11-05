import { useEffect, useState } from 'react';
import { Store, FileCode2, Check, PackagePlus } from 'lucide-react';
import api from '../../services/api';

/**
 * The products screen starts here: first the marketplace, then the XML source that belongs to it.
 * Nothing is loaded until both are chosen. "none" stands for products added by hand (no XML source).
 */
const card = (active) => ({
  textAlign: 'left', padding: '14px 16px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)',
  border: active ? '2px solid var(--accent-primary)' : '2px solid var(--border-color)',
  background: active ? 'rgba(99,102,241,0.08)' : 'var(--bg-secondary)', display: 'flex', gap: 12, alignItems: 'flex-start',
});

function Step({ n, title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ width: 24, height: 24, borderRadius: 12, background: 'var(--accent-primary)', color: '#fff', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
        <strong style={{ fontSize: 15 }}>{title}</strong>
      </div>
      {children}
    </div>
  );
}

export default function SourceGate({ connections, xmlSources, connId, xmlId, onPickConn, onPickXml }) {
  const [mapCounts, setMapCounts] = useState(null);   // category mappings per XML source for the chosen marketplace
  const [manualCount, setManualCount] = useState(0);  // products added by hand

  useEffect(() => {
    api.get('/products/summary', { params: { xmlSourceId: 'none' } }).then((r) => setManualCount(r.data.total || 0)).catch(() => {});
  }, []);

  useEffect(() => {
    setMapCounts(null);
    if (!connId) return undefined;
    let alive = true;
    api.get(`/marketplace/connections/${connId}/category-mappings`)
      .then((r) => {
        if (!alive) return;
        const m = {};
        for (const x of r.data || []) { const k = x.xmlSourceId || '_shared'; m[k] = (m[k] || 0) + 1; }
        setMapCounts(m);
      })
      .catch(() => { if (alive) setMapCounts({}); });
    return () => { alive = false; };
  }, [connId]);

  const noConnections = connections.length === 0;
  const showXml = noConnections || !!connId;
  const conn = connections.find((c) => c.id === connId);
  // sources that already have category mappings for this marketplace come first
  const sources = [...xmlSources].sort((a, b) => ((mapCounts?.[b.id] || 0) > 0) - ((mapCounts?.[a.id] || 0) > 0));

  return (
    <div className="card" data-testid="gate" style={{ padding: 22, marginBottom: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18, lineHeight: 1.55 }}>
        Ürünleri görmek için önce hangi pazaryeri için çalışacağınızı, sonra o pazaryerine göndereceğiniz XML kaynağını seçin.
        Satış fiyatları ve gönderim durumu seçtiğiniz pazaryerine göre gösterilir.
      </div>

      {!noConnections && (
        <Step n={1} title="Pazaryeri seçin">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
            {connections.map((c) => (
              <button key={c.id} type="button" data-testid={`gate-conn-${c.id}`} aria-pressed={c.id === connId} onClick={() => onPickConn(c.id)} style={card(c.id === connId)}>
                <Store size={20} style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent-primary)' }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{c.supplierName || c.marketplaceType}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{c.marketplaceType}{c.sellerId ? ` · ${c.sellerId}` : ''}</div>
                </div>
                {c.id === connId && <Check size={16} style={{ marginLeft: 'auto', color: 'var(--accent-primary)' }} />}
              </button>
            ))}
          </div>
        </Step>
      )}
      {noConnections && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>
          Henüz bağlı pazaryeriniz yok; fiyat ve gönderim durumu görünmez. <a href="/marketplace" style={{ color: 'var(--accent-primary)' }}>Pazaryeri bağla →</a>
        </div>
      )}

      {showXml && (
        <Step n={noConnections ? 1 : 2} title={`XML kaynağı seçin${conn ? ` — ${conn.supplierName || conn.marketplaceType}` : ''}`}>
          {sources.length === 0 && manualCount === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Henüz XML kaynağınız yok. <a href="/xml-sources" style={{ color: 'var(--accent-primary)' }}>XML kaynağı ekle →</a></div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {sources.map((x) => {
                const n = mapCounts ? (mapCounts[x.id] || 0) : null;
                return (
                  <button key={x.id} type="button" data-testid={`gate-xml-${x.id}`} aria-pressed={x.id === xmlId} onClick={() => onPickXml(x.id)} style={card(x.id === xmlId)}>
                    <FileCode2 size={20} style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent-primary)' }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, wordBreak: 'break-word' }}>{x.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{x.totalProducts != null ? `${x.totalProducts} ürün` : 'XML kaynağı'}</div>
                      {conn && n !== null && (
                        <div style={{ fontSize: 11, marginTop: 3, color: n > 0 ? 'var(--success)' : 'var(--warning)' }}>
                          {n > 0 ? `${n} kategori eşleşmiş` : 'Bu pazaryeri için kategori eşleşmesi yok'}
                        </div>
                      )}
                    </div>
                    {x.id === xmlId && <Check size={16} style={{ marginLeft: 'auto', color: 'var(--accent-primary)' }} />}
                  </button>
                );
              })}
              {manualCount > 0 && (
                <button type="button" data-testid="gate-xml-none" aria-pressed={xmlId === 'none'} onClick={() => onPickXml('none')} style={card(xmlId === 'none')}>
                  <PackagePlus size={20} style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent-primary)' }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Elle eklenen ürünler</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{manualCount} ürün · XML kaynağı yok</div>
                  </div>
                  {xmlId === 'none' && <Check size={16} style={{ marginLeft: 'auto', color: 'var(--accent-primary)' }} />}
                </button>
              )}
            </div>
          )}
        </Step>
      )}
    </div>
  );
}
