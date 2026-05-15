import { useState, useEffect } from 'react';
import { Activity, AlertCircle, Info, Clock, AlertTriangle, ChevronDown, ChevronRight, CheckCircle, XCircle } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState('system');

  // System logs
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(true);

  // Trendyol API logs
  const [apiLogs, setApiLogs] = useState([]);
  const [apiLogsLoading, setApiLogsLoading] = useState(false);
  const [apiPage, setApiPage] = useState(1);
  const [apiTotal, setApiTotal] = useState(0);
  const [apiTotalPages, setApiTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState(null);
  const [connections, setConnections] = useState([]);
  const [filterConn, setFilterConn] = useState('');

  useEffect(() => { fetchLogs(); fetchConnections(); }, []);
  useEffect(() => { if (activeTab === 'trendyol') fetchApiLogs(); }, [activeTab, apiPage, filterConn]);

  const fetchLogs = async () => {
    try {
      const res = await api.get('/dashboard/logs');
      setLogs(res.data);
    } catch { toast.error('Log kayıtları alınamadı'); }
    finally { setLogsLoading(false); }
  };

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      setConnections(res.data.filter(c => c.marketplaceType === 'trendyol'));
    } catch {}
  };

  const fetchApiLogs = async () => {
    setApiLogsLoading(true);
    try {
      const params = { page: apiPage, limit: 50 };
      if (filterConn) params.connectionId = filterConn;
      const res = await api.get('/marketplace/trendyol-api-logs', { params });
      setApiLogs(res.data.logs);
      setApiTotal(res.data.total);
      setApiTotalPages(res.data.totalPages);
    } catch { toast.error('API logları alınamadı'); }
    finally { setApiLogsLoading(false); }
  };

  const getLevelIcon = (level) => {
    if (level === 'ERROR') return <AlertCircle size={15} style={{ color: 'var(--danger)' }} />;
    if (level === 'WARNING') return <AlertTriangle size={15} style={{ color: 'var(--warning)' }} />;
    return <Info size={15} style={{ color: 'var(--accent-primary)' }} />;
  };

  const statusColor = (status) => {
    if (!status) return 'var(--text-muted)';
    if (status >= 200 && status < 300) return 'var(--success)';
    if (status >= 400) return 'var(--danger)';
    return 'var(--warning)';
  };

  const methodColor = (method) => {
    const m = (method || '').toUpperCase();
    if (m === 'GET') return '#3b82f6';
    if (m === 'POST') return '#10b981';
    if (m === 'PUT') return '#f59e0b';
    if (m === 'DELETE') return '#ef4444';
    return 'var(--text-secondary)';
  };

  const fmtJson = (str) => {
    if (!str) return '';
    try { return JSON.stringify(JSON.parse(str), null, 2); }
    catch { return str; }
  };

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>İşlem Logları</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Sistem işlemleri ve Trendyol API istekleri</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border-color)', paddingBottom: 0 }}>
        {[
          { key: 'system', label: 'Sistem Logları' },
          { key: 'trendyol', label: 'Trendyol API Logları' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? 'var(--accent-primary)' : 'var(--text-secondary)',
              borderBottom: activeTab === tab.key ? '2px solid var(--accent-primary)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── System Logs ── */}
      {activeTab === 'system' && (
        <div className="card" style={{ padding: 0 }}>
          {logsLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Yükleniyor...</div>
          ) : logs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
              <Activity size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
              <p>Henüz bir işlem kaydı bulunmuyor.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  {['Tarih', 'İşlem Tipi', 'Durum', 'Detay'].map(h => (
                    <th key={h} style={{ padding: '14px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Clock size={13} />{new Date(log.createdAt).toLocaleString('tr-TR')}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: 500, fontSize: 13 }}>{log.type}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px',
                        borderRadius: 20, fontSize: 12, fontWeight: 600,
                        background: log.level === 'ERROR' ? 'rgba(239,68,68,0.1)' : log.level === 'WARNING' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)',
                        color: log.level === 'ERROR' ? 'var(--danger)' : log.level === 'WARNING' ? 'var(--warning)' : 'var(--success)',
                      }}>
                        {getLevelIcon(log.level)}
                        {log.level === 'ERROR' ? 'Hata' : log.level === 'WARNING' ? 'Uyarı' : 'Başarılı'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)', maxWidth: 400 }}>{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Trendyol API Logs ── */}
      {activeTab === 'trendyol' && (
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
            {connections.length > 1 && (
              <select className="form-select" style={{ width: 220 }} value={filterConn} onChange={e => { setFilterConn(e.target.value); setApiPage(1); }}>
                <option value="">Tüm bağlantılar</option>
                {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
              </select>
            )}
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
              Toplam <strong>{apiTotal}</strong> kayıt
            </span>
            <button className="btn btn-secondary btn-sm" onClick={fetchApiLogs}>Yenile</button>
          </div>

          <div className="card" style={{ padding: 0 }}>
            {apiLogsLoading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Yükleniyor...</div>
            ) : apiLogs.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
                <Activity size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                <p>Henüz Trendyol API logu yok. İlk işlemi yaptıktan sonra burada görünecek.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    {['Tarih', 'Metot', 'Endpoint', 'Durum', 'Süre', 'Detay'].map(h => (
                      <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {apiLogs.map(log => (
                    <>
                      <tr
                        key={log.id}
                        style={{ borderBottom: expandedId === log.id ? 'none' : '1px solid var(--border-color)', cursor: 'pointer', background: expandedId === log.id ? 'rgba(99,102,241,0.04)' : undefined }}
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                      >
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {new Date(log.createdAt).toLocaleString('tr-TR')}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: methodColor(log.method) }}>
                            {log.method}
                          </span>
                        </td>
                        <td style={{ padding: '11px 14px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.endpoint}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          {log.error ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--danger)' }}>
                              <XCircle size={13} /> Hata
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: statusColor(log.responseStatus) }}>
                              {log.responseStatus >= 200 && log.responseStatus < 300 ? <CheckCircle size={13} /> : <XCircle size={13} />}
                              {log.responseStatus || '—'}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {log.durationMs != null ? `${log.durationMs}ms` : '—'}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          {expandedId === log.id ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
                        </td>
                      </tr>

                      {expandedId === log.id && (
                        <tr key={`${log.id}-detail`} style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(99,102,241,0.03)' }}>
                          <td colSpan={6} style={{ padding: '0 14px 16px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                                  İstek (Request Body)
                                </div>
                                <pre style={{
                                  background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                                  borderRadius: 6, padding: '10px 12px', fontSize: 11, fontFamily: 'monospace',
                                  overflowX: 'auto', maxHeight: 300, overflowY: 'auto', margin: 0,
                                  color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                }}>
                                  {log.requestBody ? fmtJson(log.requestBody) : '(boş)'}
                                </pre>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                                  Cevap (Response Body)
                                  {log.responseStatus && <span style={{ marginLeft: 8, color: statusColor(log.responseStatus), fontWeight: 700 }}>HTTP {log.responseStatus}</span>}
                                </div>
                                <pre style={{
                                  background: log.error || (log.responseStatus >= 400) ? 'rgba(239,68,68,0.05)' : 'var(--bg-secondary)',
                                  border: `1px solid ${log.error || (log.responseStatus >= 400) ? 'rgba(239,68,68,0.3)' : 'var(--border-color)'}`,
                                  borderRadius: 6, padding: '10px 12px', fontSize: 11, fontFamily: 'monospace',
                                  overflowX: 'auto', maxHeight: 300, overflowY: 'auto', margin: 0,
                                  color: log.error ? 'var(--danger)' : 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                }}>
                                  {log.error || (log.responseBody ? fmtJson(log.responseBody) : '(boş)')}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {apiTotalPages > 1 && (
            <div className="pagination" style={{ marginTop: 12 }}>
              <button disabled={apiPage <= 1} onClick={() => setApiPage(p => p - 1)}>Önceki</button>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{apiPage} / {apiTotalPages}</span>
              <button disabled={apiPage >= apiTotalPages} onClick={() => setApiPage(p => p + 1)}>Sonraki</button>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
