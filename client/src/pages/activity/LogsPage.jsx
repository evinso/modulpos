import React, { useState, useEffect } from 'react';
import { Activity, AlertCircle, CheckCircle, Info, Clock, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await api.get('/dashboard/logs');
      setLogs(res.data);
    } catch (error) {
      toast.error('Log kayıtları alınamadı');
    } finally {
      setLoading(false);
    }
  };

  const getIconForLevel = (level) => {
    switch (level) {
      case 'ERROR': return <AlertCircle size={16} className="text-danger" />;
      case 'WARNING': return <AlertTriangle size={16} className="text-warning" />;
      default: return <Info size={16} className="text-info" />;
    }
  };

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>İşlem Logları</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Otomatik senkronizasyonlar ve sistem işlemlerinin detaylı dökümü</p>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Yükleniyor...</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
            <Activity size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            <p>Henüz bir işlem kaydı bulunmuyor.</p>
          </div>
        ) : (
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)' }}>Tarih</th>
                <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)' }}>İşlem Tipi</th>
                <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)' }}>Durum</th>
                <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)' }}>Detay Mesajı</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Clock size={14} />
                      {new Date(log.createdAt).toLocaleString('tr-TR')}
                    </div>
                  </td>
                  <td style={{ padding: '16px', fontWeight: 500 }}>
                    {log.type}
                  </td>
                  <td style={{ padding: '16px' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: log.level === 'ERROR' ? 'rgba(239,68,68,0.1)' : log.level === 'WARNING' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)', color: log.level === 'ERROR' ? 'var(--danger)' : log.level === 'WARNING' ? 'var(--warning)' : 'var(--success)' }}>
                      {getIconForLevel(log.level)}
                      {log.level === 'ERROR' ? 'Hata' : log.level === 'WARNING' ? 'Uyarı' : 'Başarılı'}
                    </div>
                  </td>
                  <td style={{ padding: '16px', fontSize: 13, color: 'var(--text-secondary)', maxWidth: 400 }}>
                    {log.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
