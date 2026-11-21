import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, Info, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { api } from './api.js';

/** Small building blocks shared by every page. */
const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ value, children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const seq = useRef(0);
  const toast = useCallback((message, kind = 'ok') => {
    const id = ++seq.current; setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'bad' ? 7000 : 3500);
  }, []);
  const confirm = useCallback((opts) => new Promise((resolve) => setDialog({ ...opts, resolve })), []);
  const v = useMemo(() => ({ ...value, toast, confirm }), [value, toast, confirm]);
  const close = (ok) => { dialog.resolve(ok); setDialog(null); };
  return (
    <Ctx.Provider value={v}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>)}</div>
      {dialog && (
        <Modal title={dialog.title || 'Emin misiniz?'} onClose={() => close(false)}>
          <div className="stack">{typeof dialog.body === 'string' ? <p>{dialog.body}</p> : dialog.body}</div>
          <div className="row end">
            <button className="btn" onClick={() => close(false)}>Vazgeç</button>
            <button className={`btn ${dialog.danger ? 'danger' : 'primary'}`} onClick={() => close(true)}>{dialog.confirmText || 'Onayla'}</button>
          </div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}

export const Spinner = ({ label }) => <span className="row muted" style={{ gap: 6 }}><Loader2 size={16} className="spin" style={{ animation: 'spin 1s linear infinite' }} />{label || 'Yükleniyor…'}<style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style></span>;
export const Loading = ({ label }) => <div className="empty"><Spinner label={label} /></div>;

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose} aria-label="Kapat"><X size={16} /></button></div>
        {children}
      </div>
    </div>
  );
}

export const Card = ({ title, actions, children, className = '', flat }) => (
  <section className={`card ${flat ? 'flat' : ''} ${className}`}>
    {(title || actions) && <div className="card-head">{title ? <h2>{title}</h2> : <span />}{actions && <div className="row">{actions}</div>}</div>}
    {children}
  </section>
);

export const PageHead = ({ title, children, actions }) => (
  <div className="page-head"><div><h1>{title}</h1>{children && <p>{children}</p>}</div>{actions && <div className="row">{actions}</div>}</div>
);

export const Field = ({ label, hint, error, children, className = '' }) => (
  <div className={`field ${className}`}>{label && <label>{label}</label>}{children}{error ? <span className="hint bad">{error}</span> : hint ? <span className="hint">{hint}</span> : null}</div>
);

export const Badge = ({ kind = '', children, title }) => <span className={`badge ${kind}`} title={title}>{children}</span>;

const ALERT_ICON = { info: Info, warn: AlertTriangle, ok: CheckCircle2, bad: XCircle };
export function Alert({ kind = 'info', title, children }) {
  const Icon = ALERT_ICON[kind] || Info;
  return <div className={`alert ${kind}`} role={kind === 'bad' ? 'alert' : undefined}><Icon size={18} style={{ flex: 'none', marginTop: 2 }} /><div className="stack" style={{ gap: 2 }}>{title && <strong>{title}</strong>}{children && <div>{children}</div>}</div></div>;
}

export const Empty = ({ title, children, action }) => <div className="empty"><strong>{title}</strong>{children && <p className="muted" style={{ maxWidth: 520 }}>{children}</p>}{action}</div>;

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="tabs" role="tablist">{tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={value === k} className={`tab ${value === k ? 'active' : ''}`} onClick={() => onChange(k)}>{label}</button>)}</div>
);

export const Check = ({ checked, onChange, children, disabled }) => (
  <label className="check"><input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{children}</label>
);

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="row between">
      <span className="muted">{total} kayıt · sayfa {page}/{pages}</span>
      <div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Önceki</button><button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Sonraki</button></div>
    </div>
  );
}

/** 0-100 as a bar with the number; `null` shows "Veri yok" (never 0). */
export function ScoreBar({ value, label, kind }) {
  if (value === null || value === undefined) return <span className="faint" title="Gerçek veri yok">Veri yok</span>;
  const k = kind || (value >= 70 ? 'ok' : value >= 40 ? 'warn' : 'bad');
  return <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }} title={label}><div className={`bar ${k}`} style={{ width: 70 }}><i style={{ width: `${Math.max(2, value)}%` }} /></div><strong style={{ minWidth: 24 }}>{value}</strong></div>;
}

export const NeedsProject = () => <div className="page"><Alert kind="warn">Önce üstteki menüden bir proje seçin.</Alert></div>;

/** Follows a background run: polls every 1.5 s until it is no longer "running", then calls onDone(run). Returns [run, setRun]. */
export function useRunWatcher(onDone) {
  const [run, setRun] = useState(null);
  const cb = useRef(onDone); cb.current = onDone;
  useEffect(() => {
    if (!run || run.status !== 'running') return undefined;
    let stop = false;
    const t = setInterval(async () => {
      try { const r = await api.get(`/runs/${run.id}`); if (!stop && r.status !== 'running') { setRun(r); if (cb.current) cb.current(r); } } catch { /* try again on the next tick */ }
    }, 1500);
    return () => { stop = true; clearInterval(t); };
  }, [run]);
  return [run, setRun];
}

/** Runs an async loader and keeps { data, error, loading, reload }. `deps` re-run it. */
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    return loader().then((data) => { if (id === seq.current) setState({ data, error: null, loading: false }); return data; },
      (error) => { if (id === seq.current) setState((s) => ({ data: s.data, error, loading: false })); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run, setData: (data) => setState((s) => ({ ...s, data })) };
}

/** Shows what useLoad has: spinner on the first load, a red box on error, children(data) when there is data. */
export function Async({ state, children }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <Alert kind="bad" title="Veri alınamadı">{state.error.message} <button className="btn sm" onClick={state.reload}>Tekrar dene</button></Alert>;
  return <>{state.error && <Alert kind="bad">{state.error.message}</Alert>}{children(state.data)}</>;
}

/** Runs an action, toasts its outcome, returns the result (or undefined on failure). */
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okMessage) => {
    setBusy(true);
    try { const r = await fn(); if (okMessage) toast(okMessage, 'ok'); return r === undefined ? true : r; }
    catch (e) { toast(e.message || 'İşlem başarısız', 'bad'); return undefined; }
    finally { setBusy(false); }
  }, [toast]);
  return [run, busy];
}
