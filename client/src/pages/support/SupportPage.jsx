import { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import {
  MessageSquare, Plus, Send, X, ChevronRight,
  Clock, CheckCircle, AlertCircle, XCircle, RefreshCcw
} from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS = {
  open:        { label: 'Açık',           cls: 'badge-info' },
  in_progress: { label: 'İşlemde',        cls: 'badge-warning' },
  resolved:    { label: 'Çözüldü',        cls: 'badge-success' },
  closed:      { label: 'Kapalı',         cls: 'badge-danger' },
};

const PRIORITY = {
  low:    { label: 'Düşük',   cls: 'badge-info' },
  normal: { label: 'Normal',  cls: '' },
  high:   { label: 'Yüksek', cls: 'badge-warning' },
  urgent: { label: 'Acil',   cls: 'badge-danger' },
};

const CATEGORY = {
  general:   'Genel',
  technical: 'Teknik',
  billing:   'Fatura / Ödeme',
  other:     'Diğer',
};

const EMPTY_FORM = { subject: '', category: 'general', priority: 'normal', message: '' };

export default function SupportPage() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const [createModal, setCreateModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [detailModal, setDetailModal] = useState(null); // ticket object with messages
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchTickets();
  }, [statusFilter]);

  useEffect(() => {
    if (detailModal) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [detailModal?.messages?.length]);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const res = await api.get(`/support${params}`);
      setTickets(res.data);
    } catch {
      toast.error('Biletler yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (ticket) => {
    setDetailLoading(true);
    setDetailModal({ ...ticket, messages: [] });
    try {
      const res = await api.get(`/support/${ticket.id}`);
      setDetailModal(res.data);
    } catch {
      toast.error('Bilet detayı yüklenemedi');
      setDetailModal(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.post('/support', form);
      toast.success('Destek biletiniz oluşturuldu');
      setTickets(prev => [res.data, ...prev]);
      setCreateModal(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Oluşturulamadı');
    } finally {
      setCreating(false);
    }
  };

  const handleReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    setReplying(true);
    try {
      const res = await api.post(`/support/${detailModal.id}/reply`, { message: replyText.trim() });
      setDetailModal(prev => ({
        ...prev,
        messages: [...prev.messages, res.data]
      }));
      setTickets(prev => prev.map(t =>
        t.id === detailModal.id ? { ...t, updatedAt: new Date().toISOString() } : t
      ));
      setReplyText('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Yanıt gönderilemedi');
    } finally {
      setReplying(false);
    }
  };

  const isClosed = detailModal?.status === 'closed';

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title">
          <h1>Destek Biletleri</h1>
          <p>Sorunlarınızı ve sorularınızı buradan iletebilirsiniz.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm(EMPTY_FORM); setCreateModal(true); }}>
          <Plus size={16} /> Yeni Bilet Aç
        </button>
      </div>

      <div className="table-container">
        <div className="table-header">
          <h3 style={{ margin: 0 }}>Biletlerim</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select
              className="form-input"
              style={{ width: 'auto', minWidth: 160 }}
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="">Tüm Durumlar</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <button className="btn btn-secondary" onClick={fetchTickets}>
              <RefreshCcw size={14} className={loading ? 'spinning' : ''} />
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div className="spinner" />
          </div>
        ) : tickets.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <MessageSquare size={48} style={{ color: 'var(--text-secondary)', marginBottom: 16 }} />
            <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
              Henüz destek biletiniz bulunmuyor.
            </p>
            <button className="btn btn-primary" onClick={() => { setForm(EMPTY_FORM); setCreateModal(true); }}>
              <Plus size={16} /> İlk Biletinizi Açın
            </button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Konu</th>
                <th>Kategori</th>
                <th>Öncelik</th>
                <th>Durum</th>
                <th>Tarih</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(ticket => {
                const st = STATUS[ticket.status] || STATUS.open;
                const pr = PRIORITY[ticket.priority] || PRIORITY.normal;
                return (
                  <tr key={ticket.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(ticket)}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{ticket.subject}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {ticket._count?.messages || 0} mesaj
                      </div>
                    </td>
                    <td><span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{CATEGORY[ticket.category] || ticket.category}</span></td>
                    <td><span className={`badge ${pr.cls}`}>{pr.label}</span></td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {new Date(ticket.updatedAt).toLocaleDateString('tr-TR')}
                    </td>
                    <td>
                      <ChevronRight size={16} style={{ color: 'var(--text-secondary)' }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Ticket Modal */}
      {createModal && (
        <Modal title="Yeni Destek Bileti Aç" onClose={() => setCreateModal(false)} maxWidth={560}>
          <form onSubmit={handleCreate} style={{ padding: 24 }}>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Konu *</label>
              <input
                type="text"
                className="form-input"
                value={form.subject}
                onChange={e => setForm({ ...form, subject: e.target.value })}
                placeholder="Sorununuzu kısaca açıklayın"
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              <div className="form-group">
                <label className="form-label">Kategori</label>
                <select className="form-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {Object.entries(CATEGORY).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Öncelik</label>
                <select className="form-input" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                  {Object.entries(PRIORITY).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 24 }}>
              <label className="form-label">Mesajınız *</label>
              <textarea
                className="form-input"
                rows={5}
                style={{ resize: 'vertical' }}
                value={form.message}
                onChange={e => setForm({ ...form, message: e.target.value })}
                placeholder="Sorununuzu veya talebinizi ayrıntılı olarak açıklayın..."
                required
              />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setCreateModal(false)}>
                Vazgeç
              </button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={creating}>
                {creating ? 'Gönderiliyor...' : 'Bileti Oluştur'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Ticket Detail Modal */}
      {detailModal && (
        <Modal
          title={detailModal.subject}
          onClose={() => { setDetailModal(null); setReplyText(''); }}
          maxWidth={640}
        >
          {/* Header info */}
          <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`badge ${(STATUS[detailModal.status] || STATUS.open).cls}`}>
              {(STATUS[detailModal.status] || STATUS.open).label}
            </span>
            <span className={`badge ${(PRIORITY[detailModal.priority] || PRIORITY.normal).cls}`}>
              {(PRIORITY[detailModal.priority] || PRIORITY.normal).label}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
              {CATEGORY[detailModal.category] || detailModal.category} · {new Date(detailModal.createdAt).toLocaleDateString('tr-TR')}
            </span>
          </div>

          {/* Messages */}
          <div style={{ padding: '16px 24px', maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {detailLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
            ) : detailModal.messages?.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', padding: 20 }}>Henüz mesaj yok.</p>
            ) : (
              detailModal.messages?.map(msg => (
                <div
                  key={msg.id}
                  style={{
                    alignSelf: msg.isAdmin ? 'flex-start' : 'flex-end',
                    maxWidth: '80%'
                  }}
                >
                  <div style={{
                    background: msg.isAdmin ? 'var(--bg-tertiary)' : 'var(--accent-primary)',
                    color: msg.isAdmin ? 'var(--text-primary)' : '#fff',
                    borderRadius: msg.isAdmin ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
                    padding: '10px 14px',
                    fontSize: 14,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap'
                  }}>
                    {msg.message}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, textAlign: msg.isAdmin ? 'left' : 'right' }}>
                    {msg.senderName} · {new Date(msg.createdAt).toLocaleString('tr-TR')}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply area */}
          <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border-color)' }}>
            {isClosed ? (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', padding: '8px 0' }}>
                Bu bilet kapatılmıştır. Yeni bir sorun için yeni bilet açabilirsiniz.
              </p>
            ) : (
              <form onSubmit={handleReply} style={{ display: 'flex', gap: 10 }}>
                <textarea
                  className="form-input"
                  rows={2}
                  style={{ flex: 1, resize: 'none', fontSize: 13 }}
                  placeholder="Yanıtınızı yazın..."
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleReply(e); }}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ alignSelf: 'flex-end', padding: '8px 16px' }}
                  disabled={replying || !replyText.trim()}
                >
                  {replying ? '...' : <Send size={16} />}
                </button>
              </form>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, maxWidth = 520, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div className="card" style={{ width: '100%', maxWidth, padding: 0, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div className="table-header" style={{ flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button className="header-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}
