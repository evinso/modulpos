import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Package } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Thumb, Pill } from './productsUi';

/**
 * Live list straight from the marketplace account (not our database): shows what is really on Trendyol right now,
 * including listings that were never created from this system.
 */
const STATUSES = [
  { key: 'active', label: 'Satışta', color: 'var(--success)' },
  { key: 'pending', label: 'Onay bekliyor', color: 'var(--warning)' },
  { key: 'rejected', label: 'Reddedildi', color: 'var(--danger)' },
  { key: 'passive', label: 'Kaldırıldı', color: '#f97316' },
];

export default function TrendyolLiveView({ connections }) {
  const trendyol = connections.filter((c) => c.marketplaceType === 'trendyol');
  const [connId, setConnId] = useState(trendyol[0]?.id || '');
  const [status, setStatus] = useState('active');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p = 0) => {
    if (!connId) return;
    setLoading(true);
    try {
      const res = await api.get(`/marketplace/connections/${connId}/trendyol-products`, { params: { status, page: p, size: 50 } });
      setRows(res.data.content || []);
      setMeta({ total: res.data.totalElements || 0, totalPages: res.data.totalPages || 1 });
      setPage(p);
    } catch { toast.error('Trendyol ürünleri yüklenemedi'); }
    finally { setLoading(false); }
  }, [connId, status]);

  useEffect(() => { load(0); }, [load]);

  if (trendyol.length === 0) {
    return <div className="card"><div className="empty-state"><Package size={44} className="empty-icon" /><h3>Trendyol bağlantısı yok</h3><p>Önce Pazaryerleri sayfasından bir Trendyol bağlantısı ekleyin.</p></div></div>;
  }

  return (
    <div className="table-container">
      <div style={{ padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--border-color)' }}>
        {trendyol.length > 1 && (
          <select className="form-select" style={{ width: 200 }} value={connId} onChange={(e) => setConnId(e.target.value)}>
            {trendyol.map((c) => <option key={c.id} value={c.id}>{c.supplierName || 'Trendyol'}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUSES.map((s) => (
            <button key={s.key} onClick={() => setStatus(s.key)} style={{
              padding: '6px 14px', borderRadius: 16, fontSize: 13, cursor: 'pointer', fontWeight: status === s.key ? 700 : 500,
              border: `1px solid ${status === s.key ? s.color : 'var(--border-color)'}`,
              background: status === s.key ? `color-mix(in srgb, ${s.color} 14%, transparent)` : 'transparent',
              color: status === s.key ? s.color : 'var(--text-secondary)',
            }}>{s.label}</button>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => load(page)} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinning' : ''} /> Yenile
        </button>
      </div>
      <div style={{ padding: '8px 16px', fontSize: 12, color: '#f97316', background: 'rgba(249,115,22,0.05)', borderBottom: '1px solid var(--border-color)' }}>
        Trendyol hesabınızdan canlı çekilen veri — {meta.total} ürün. Bu liste sistemdeki ürünlerden bağımsızdır.
      </div>

      {loading ? <div className="loading-spinner"><div className="spinner"></div></div>
        : rows.length === 0 ? <div className="empty-state"><Package size={44} className="empty-icon" /><h3>Bu durumda ürün yok</h3></div> : (
          <table>
            <thead><tr><th></th><th>Barkod</th><th>Ürün</th><th>SKU</th><th>Stok</th><th>Liste</th><th>Satış</th><th>Durum</th></tr></thead>
            <tbody>
              {rows.map((tp, i) => {
                const on = tp.approved && tp.onSale;
                const st = on ? { l: 'Satışta', c: 'var(--success)' } : tp.rejected ? { l: 'Reddedildi', c: 'var(--danger)' } : tp.archived ? { l: 'Kaldırıldı', c: '#f97316' } : { l: 'Onay bekliyor', c: 'var(--warning)' };
                return (
                  <tr key={tp.barcode || i}>
                    <td><Thumb src={tp.images?.[0]?.url} size={36} radius={6} /></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{tp.barcode}</td>
                    <td style={{ maxWidth: 280 }}>
                      <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tp.title}</div>
                      {tp.rejectionReasonDetails?.length > 0 && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>{tp.rejectionReasonDetails[0]?.reason}</div>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tp.stockCode}</td>
                    <td>{tp.quantity ?? '—'}</td>
                    <td>{tp.listPrice != null ? `₺${tp.listPrice.toLocaleString('tr-TR')}` : '—'}</td>
                    <td style={{ fontWeight: 600 }}>{tp.salePrice != null ? `₺${tp.salePrice.toLocaleString('tr-TR')}` : '—'}</td>
                    <td><Pill color={st.c}>{st.l}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      {meta.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 16 }}>
          <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => load(page - 1)}>← Önceki</button>
          <span style={{ lineHeight: '32px', fontSize: 13 }}>{page + 1} / {meta.totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page + 1 >= meta.totalPages} onClick={() => load(page + 1)}>Sonraki →</button>
        </div>
      )}
    </div>
  );
}
