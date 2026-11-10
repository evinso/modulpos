import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Settings, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Info } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { tl, approx, SOURCE_LABEL } from './profitFormat';

const STATUS = { new: 'Yeni', processing: 'Hazırlanıyor', shipped: 'Kargoda', delivered: 'Teslim Edildi', cancelled: 'İptal', returned: 'İade' };
const STATUS_CLASS = { new: 'badge-info', processing: 'badge-warning', shipped: 'badge-primary', delivered: 'badge-success', cancelled: 'badge-danger', returned: 'badge-danger' };
const RANGES = [['7', 'Son 7 gün'], ['30', 'Son 30 gün'], ['90', 'Son 90 gün'], ['all', 'Tümü']];

function isoDay(d) { return new Date(d.getTime() + 3 * 3600000).toISOString().slice(0, 10); }   // Turkey time

function Card({ label, value, sub, color }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function CostEditor({ line, onSaved }) {
  const [value, setValue] = useState(line.unitCost ? String(line.unitCost) : '');
  const [saving, setSaving] = useState(false);
  const save = async (clear) => {
    setSaving(true);
    try {
      await api.put('/orders/profit/cost', { barcode: line.barcode, unitCost: clear ? null : value });
      toast.success(clear ? 'Elle girilen maliyet kaldırıldı' : 'Maliyet kaydedildi');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Kaydedilemedi'); }
    finally { setSaving(false); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input type="number" min="0" step="0.01" className="form-input" aria-label={`Birim alış maliyeti ${line.barcode}`} style={{ width: 110, padding: '4px 8px', fontSize: 13 }}
        value={value} placeholder="Birim ₺" onChange={(e) => setValue(e.target.value)} />
      <button className="btn btn-primary btn-sm" disabled={saving || !(Number(value) > 0)} onClick={() => save(false)}>Kaydet</button>
      {line.costSource === 'manual' && <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => save(true)}>Kaldır</button>}
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {line.unitCost ? SOURCE_LABEL[line.costSource] || '' : 'Bu ürün maliyet listenizde bulunamadı; bu barkoddaki tüm siparişlere uygulanır'}
      </span>
    </div>
  );
}

function Breakdown({ row, onSaved }) {
  const line = (label, value, hint, bold) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '3px 0', fontWeight: bold ? 700 : 400, borderTop: bold ? '1px solid var(--border-color)' : undefined, marginTop: bold ? 4 : 0 }}>
      <span style={{ color: bold ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}{hint && <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>{hint}</span>}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 380px) 1fr', gap: 28, padding: '12px 8px', fontSize: 13 }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Kâr hesabı</div>
        {line('İndirimli satış (KDV dahil)', tl(row.discounted), row.sellerDiscount ? `liste ${tl(row.gross)} − satıcı indirimi ${tl(row.sellerDiscount)}` : '')}
        {line('Satış KDV\'si', `− ${tl(row.vat)}`)}
        {line('Komisyon', `− ${tl(row.commission)}`, row.commissionSource === 'trendyol' ? 'Trendyol\'dan' : `tahmini (%${row.commissionRate})`)}
        {line('Platform hizmet bedeli', `− ${tl(row.serviceFee)}`, 'tahmini (ayarlardan)')}
        {row.supplierFee > 0 && line('Tedarikçi hizmet bedeli', `− ${tl(row.supplierFee)}`, 'XML kaynağı ayarı, ürün başına')}
        {line('Kargo', row.cargo === null ? '—' : `− ${tl(row.cargo)}`, row.cargoSource === 'trendyol' ? 'Trendyol faturasından' : row.cargoSource === 'estimate' ? 'tahmini' : 'bilinmiyor')}
        {line('Alış maliyeti', row.cost === null ? '—' : `− ${tl(row.cost)}`)}
        {line('Net kâr', row.profit === null ? 'hesaplanamadı' : tl(row.profit), row.profitPct !== null ? `net satışın %${row.profitPct}'i` : '', true)}
        {row.tyDiscount > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Trendyol'un karşıladığı indirim ({tl(row.tyDiscount)}) size ödenir; müşteri {tl(row.customerPaid)} ödedi.</div>}
        {row.mismatch && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 6 }}>Satır toplamı siparişin tutarıyla uyuşmuyor; kargo/ek ücret farkı olabilir.</div>}
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Ürünler ve alış maliyeti</div>
        {row.lines.map((l) => (
          <div key={l.barcode} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ fontWeight: 500 }}>{l.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: 6 }}>{l.barcode} · {l.qty} adet · satış {tl(l.revenue)} · KDV %{l.vatRate} · komisyon %{l.commissionRate}{l.unitFee > 0 ? ` · tedarikçi hizmeti ${tl(l.unitFee)}/adet` : ''}</div>
            <CostEditor line={l} onSaved={onSaved} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProfitTab() {
  const [range, setRange] = useState('30');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [form, setForm] = useState({ serviceFee: '', cargoEstimate: '' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 350); return () => clearTimeout(t); }, [q]);

  const load = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    const params = { page, limit: 25, status };
    if (debouncedQ) params.q = debouncedQ;
    if (range !== 'all') { const now = new Date(); params.from = isoDay(new Date(now.getTime() - Number(range) * 86400000)); params.to = isoDay(now); }
    api.get('/orders/profit', { params })
      .then((res) => { if (alive) { setData(res.data); setLoading(false); } })
      .catch(() => { if (alive) { toast.error('Kârlılık verisi yüklenemedi'); setLoading(false); } });
    return () => { alive = false; };
  }, [range, status, debouncedQ, page, reloadKey]);

  const openSettings = () => {
    if (data) setForm({ serviceFee: String(data.settings.serviceFee), cargoEstimate: data.settings.cargoEstimateSaved === null ? '' : String(data.settings.cargoEstimateSaved) });
    setShowSettings((v) => !v);
  };
  const saveSettings = async () => {
    try {
      await api.put('/orders/profit/settings', { serviceFee: form.serviceFee, cargoEstimate: form.cargoEstimate === '' ? null : form.cargoEstimate });
      toast.success('Ayarlar kaydedildi'); setShowSettings(false); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Kaydedilemedi'); }
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await api.post('/orders/profit/refresh');
      toast.success(res.data.message, { duration: 7000 }); load();
    } catch { toast.error('Trendyol\'dan veri alınamadı'); }
    finally { setRefreshing(false); }
  };

  if (loading && !data) return <div className="loading-spinner"><div className="spinner"></div></div>;
  const s = data?.summary; const rows = data?.rows || []; const pg = data?.pagination;
  const showSupplier = !!(s && s.supplierFee > 0) || rows.some((r) => r.supplierFee > 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select className="form-select" style={{ width: 150 }} value={range} onChange={(e) => { setRange(e.target.value); setPage(1); }} aria-label="Tarih aralığı">
          {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="form-select" style={{ width: 170 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Durum">
          <option value="all">Tüm durumlar</option>
          {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="search" className="form-input" style={{ width: 220 }} placeholder="Sipariş no veya müşteri ara" aria-label="Sipariş ara" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={openSettings}><Settings size={15} /> Tahmin ayarları</button>
          <button className="btn btn-primary" onClick={refresh} disabled={refreshing} title="Teslim edilmiş siparişlerin gerçek komisyonunu ve kargo faturasını Trendyol'dan alır">
            <RefreshCw size={15} className={refreshing ? 'spinning' : ''} /> {refreshing ? 'Alınıyor…' : 'Trendyol\'dan kesin verileri al'}
          </button>
        </div>
      </div>

      {showSettings && data && (
        <div className="card" style={{ padding: 16, marginBottom: 14, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">Platform hizmet bedeli (₺ / sipariş)</label>
            <input type="number" min="0" step="0.01" className="form-input" style={{ width: 150 }} aria-label="Platform hizmet bedeli" value={form.serviceFee} onChange={(e) => setForm((f) => ({ ...f, serviceFee: e.target.value }))} />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Faturanızdaki tutar: {tl(data.settings.serviceFeeDefault)}</div>
          </div>
          <div>
            <label className="form-label">Tahmini kargo (₺ / sipariş)</label>
            <input type="number" min="0" step="0.01" className="form-input" style={{ width: 150 }} aria-label="Tahmini kargo" placeholder={data.settings.cargoAverage === null ? 'bilinmiyor' : String(data.settings.cargoAverage)} value={form.cargoEstimate} onChange={(e) => setForm((f) => ({ ...f, cargoEstimate: e.target.value }))} />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{data.settings.cargoAverage === null ? 'Henüz kargo faturası okunmadı' : `Boş bırakırsanız faturalardan okunan ortalama kullanılır: ${tl(data.settings.cargoAverage)}`}</div>
          </div>
          <button className="btn btn-primary" onClick={saveSettings}>Kaydet</button>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 380 }}>Bu iki tutar yalnızca Trendyol'dan henüz kesinleşmemiş siparişlerde kullanılır. Komisyon ve kargo kesinleşince gerçek tutar gösterilir.</div>
        </div>
      )}

      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
          <Card label="Sipariş" value={s.orders} sub={s.excluded ? `${s.excluded} iptal/iade hariç` : undefined} />
          <Card label="Müşterinin ödediği" value={tl(s.customerPaid)} sub={`liste ${tl(s.gross)}`} />
          <Card label="Komisyon" value={tl(s.commission)} />
          <Card label="Hizmet bedeli" value={tl(s.serviceFee)} sub="Trendyol platform" />
          {s.supplierFee > 0 && <Card label="Tedarikçi hizmeti" value={tl(s.supplierFee)} sub="XML kaynağı, ürün başına" />}
          <Card label="Kargo" value={tl(s.cargo)} />
          <Card label="Alış maliyeti" value={tl(s.cost)} />
          <Card label="Net kâr" value={tl(s.profit)} color={s.profit >= 0 ? 'var(--success)' : 'var(--danger)'} sub={s.unknownProfit ? `${s.profitOrders} siparişin toplamı` : undefined} />
        </div>
      )}
      {s && (s.unknownProfit > 0 || s.estimated > 0) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            {s.unknownProfit > 0 && <div><strong>{s.unknownProfit} sipariş</strong> kâr toplamına katılmadı: alış maliyeti veya kargo bilinmiyor. Satırı açıp alış maliyetini girebilirsiniz.</div>}
            {s.estimated > 0 && <div><strong>~</strong> ile başlayan tutarlar tahmindir. Komisyon ve kargo, sipariş teslim edilip Trendyol hesap ekstresine düştükten sonra kesinleşir; <em>Trendyol'dan kesin verileri al</em> ile okunur. Platform hizmet bedeli her zaman ayarınızdaki tutardır.</div>}
          </div>
        </div>
      )}

      <div className="table-container">
        {rows.length === 0 ? (
          <div className="empty-state"><TrendingUp size={40} className="empty-icon" /><h3>Bu aralıkta Trendyol siparişi yok</h3><p>Tarih aralığını genişletin veya siparişleri çekin.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tarih</th><th>Sipariş</th><th>Ürün</th>
                <th style={{ textAlign: 'right' }}>Satış fiyatı</th><th style={{ textAlign: 'right' }}>İndirimli satış</th><th style={{ textAlign: 'right' }}>Müşteri ödedi</th>
                <th style={{ textAlign: 'right' }}>Komisyon</th><th style={{ textAlign: 'right' }}>Hizmet bedeli</th>{showSupplier && <th style={{ textAlign: 'right' }}>Tedarikçi hizmeti</th>}<th style={{ textAlign: 'right' }}>Kargo</th>
                <th style={{ textAlign: 'right' }}>Alış maliyeti</th><th style={{ textAlign: 'right' }}>Net kâr</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => [
                <tr key={r.id} data-testid="profit-row" onClick={() => setOpen(open === r.id ? null : r.id)} style={{ cursor: 'pointer', opacity: r.excluded ? 0.55 : 1 }}>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{new Date(r.orderDate).toLocaleDateString('tr-TR')}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {r.marketplaceOrderId || r.orderNumber}
                    <div><span className={`badge ${STATUS_CLASS[r.status] || 'badge-info'}`} style={{ fontSize: 10 }}>{STATUS[r.status] || r.status}</span></div>
                  </td>
                  <td style={{ fontSize: 12, maxWidth: 200 }}>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.lines[0]?.name || '—'}</div>
                    {r.lines.length > 1 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>+{r.lines.length - 1} ürün</div>}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 13 }}>{tl(r.gross)}</td>
                  <td style={{ textAlign: 'right', fontSize: 13 }}>{tl(r.discounted)}</td>
                  <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{tl(r.customerPaid)}</td>
                  <td style={{ textAlign: 'right', fontSize: 13, color: r.commissionSource === 'trendyol' ? undefined : 'var(--text-secondary)' }}>{approx(r.commission, r.commissionSource)}</td>
                  <td style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-secondary)' }}>{approx(r.serviceFee, r.serviceFeeSource)}</td>
                  {showSupplier && <td style={{ textAlign: 'right', fontSize: 13 }}>{r.supplierFee > 0 ? tl(r.supplierFee) : '—'}</td>}
                  <td style={{ textAlign: 'right', fontSize: 13, color: r.cargoSource === 'trendyol' ? undefined : 'var(--text-secondary)' }}>{approx(r.cargo, r.cargoSource)}</td>
                  <td style={{ textAlign: 'right', fontSize: 13 }}>{r.costMissing ? <span style={{ color: 'var(--warning)' }}>maliyet gir</span> : tl(r.cost)}</td>
                  <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: r.profit === null ? 'var(--text-muted)' : r.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {r.profit === null ? '—' : <>{r.profit >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {r.exact ? '' : '~'}{tl(r.profit)}</>}
                  </td>
                  <td>{open === r.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</td>
                </tr>,
                open === r.id && (
                  <tr key={r.id + '-d'} data-testid="profit-detail"><td colSpan={showSupplier ? 13 : 12} style={{ background: 'var(--bg-secondary)' }}><Breakdown row={r} onSaved={load} /></td></tr>
                ),
              ])}
            </tbody>
          </table>
        )}
        {pg && pg.totalPages > 1 && (
          <div className="pagination">
            <button disabled={pg.page <= 1} onClick={() => setPage((p) => p - 1)}>Önceki</button>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{pg.page} / {pg.totalPages}</span>
            <button disabled={pg.page >= pg.totalPages} onClick={() => setPage((p) => p + 1)}>Sonraki</button>
          </div>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
        Net kâr, fiyat şablonundaki kâr hesabıyla aynı yöntemle bulunur: KDV hariç satış − komisyon − hizmet bedeli − kargo − alış maliyeti. Komisyon, hizmet bedeli ve kargo faturadaki (KDV dahil) tutarlarıyla düşülür. İptal ve iade siparişler toplamlara katılmaz.
      </div>
    </div>
  );
}
