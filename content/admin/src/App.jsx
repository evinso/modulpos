import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LogOut, Menu, Moon, Sun, KeyRound, Bell } from 'lucide-react';
import { api } from './api.js';
import { MENU } from './menu.js';
import { AppProvider, Alert, Badge, Field, Loading, Modal, useApp, useAction } from './ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Strategy from './pages/Strategy.jsx';
import Articles from './pages/Articles.jsx';
import ArticleEditor from './pages/ArticleEditor.jsx';
import Limits from './pages/Limits.jsx';
import ApiUsage from './pages/ApiUsage.jsx';
import Bots from './pages/Bots.jsx';
import Notifications from './pages/Notifications.jsx';
import Logs from './pages/Logs.jsx';
import Settings from './pages/Settings.jsx';
import News from './pages/News.jsx';
import Trends from './pages/Trends.jsx';
import Niche from './pages/Niche.jsx';
import Keywords from './pages/Keywords.jsx';
import Serp from './pages/Serp.jsx';
import Opportunities from './pages/Opportunities.jsx';

function AuthScreen({ setupNeeded, tokenConfigured, onDone }) {
  const [mode, setMode] = useState(setupNeeded ? 'setup' : 'login');
  const [f, setF] = useState({ email: '', password: '', name: '', token: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (mode === 'setup') { await api.post('/auth/setup', { token: f.token, email: f.email, name: f.name, password: f.password }); setMode('login'); setF((x) => ({ ...x, token: '' })); setErr(''); }
      else { const r = await api.post('/auth/login', { email: f.email, password: f.password }); onDone(r.user); }
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}><div className="logo">M</div><div>ModulPOS AI Content Intelligence<small>Yönetim paneli</small></div></div>
        {mode === 'setup' ? (
          <>
            <Alert kind="info" title="İlk yönetici kurulumu">Bu kurulumda henüz kullanıcı yok. Sunucuda tanımlı kurulum anahtarı (CONTENT_SETUP_TOKEN) ile ilk yönetici hesabını oluşturun.</Alert>
            {!tokenConfigured && <Alert kind="bad">Sunucuda CONTENT_SETUP_TOKEN tanımlı değil; kurulum yapılamaz.</Alert>}
            <Field label="Kurulum anahtarı"><input className="input" type="password" autoComplete="off" value={f.token} onChange={set('token')} required /></Field>
            <Field label="Ad"><input className="input" value={f.name} onChange={set('name')} required /></Field>
          </>
        ) : <h2>Giriş yap</h2>}
        <Field label="E-posta"><input className="input" type="email" autoComplete="username" value={f.email} onChange={set('email')} required /></Field>
        <Field label="Şifre" hint={mode === 'setup' ? 'En az 12 karakter; büyük/küçük harf, rakam ve simgeden en az üçü; yaygın bir şifre olmamalı.' : undefined}>
          <input className="input" type="password" autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} value={f.password} onChange={set('password')} required />
        </Field>
        {err && <Alert kind="bad">{err}</Alert>}
        {mode === 'login' && setupNeeded && <Alert kind="info">Kurulum tamamlandı. Şimdi giriş yapabilirsiniz.</Alert>}
        <button className="btn primary" disabled={busy}>{busy ? 'Bekleyin…' : mode === 'setup' ? 'Yöneticiyi oluştur' : 'Giriş yap'}</button>
      </form>
    </div>
  );
}

function PasswordModal({ onClose, onChanged }) {
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [run, busy] = useAction();
  const mismatch = f.next && f.again && f.next !== f.again;
  const save = async (e) => {
    e.preventDefault();
    if (mismatch) return;
    const ok = await run(() => api.post('/auth/password', { current: f.current, next: f.next }));
    if (ok) onChanged();
  };
  return (
    <Modal title="Şifre değiştir" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Mevcut şifre"><input className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></Field>
        <Field label="Yeni şifre" hint="En az 12 karakter; büyük/küçük harf, rakam, simgeden en az üçü."><input className="input" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required /></Field>
        <Field label="Yeni şifre (tekrar)" error={mismatch ? 'Şifreler aynı değil' : ''}><input className="input" type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} required /></Field>
        <Alert kind="warn">Şifre değişince tüm cihazlardaki oturumlar kapanır.</Alert>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || mismatch}>Değiştir</button></div>
      </form>
    </Modal>
  );
}

function Shell() {
  const { me, projectId, setProjectId, projects, theme, setTheme, logout, unread, onPasswordChanged } = useApp();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Ana menü">
        <div className="brand"><div className="logo">M</div><div>AI Content Intelligence<small>ModulPOS · Aşama 2</small></div></div>
        {MENU.map((m) => {
          const Icon = m.icon;
          if (!m.to) return <div key={m.label} className="nav disabled" title={`Bu sayfa Aşama ${m.phase}’te geliştirilecek`} aria-disabled="true"><Icon size={17} />{m.label}<span className="tag">Aşama {m.phase}</span></div>;
          return (
            <NavLink key={m.label} to={m.to} end={m.end} className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}>
              <Icon size={17} />{m.label}{m.badge === 'unread' && unread > 0 && <span className="tag" style={{ color: 'var(--bad)' }}>{unread}</span>}
            </NavLink>
          );
        })}
      </aside>
      <div className="main">
        <header className="top">
          <button className="btn ghost menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Menü"><Menu size={18} /></button>
          <select className="input" style={{ width: 'auto', maxWidth: 280 }} value={projectId || ''} onChange={(e) => setProjectId(e.target.value || null)} aria-label="Proje">
            <option value="">Tüm projeler</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="grow" />
          <NavLink to="/notifications" className="btn ghost" aria-label="Bildirimler"><Bell size={17} />{unread > 0 && <Badge kind="bad">{unread}</Badge>}</NavLink>
          <button className="btn ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Temayı değiştir">{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
          <span className="muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={me.email}>{me.name} <Badge>{me.role}</Badge></span>
          <button className="btn ghost" onClick={() => setPw(true)} aria-label="Şifre değiştir" title="Şifre değiştir"><KeyRound size={17} /></button>
          <button className="btn ghost" onClick={logout} aria-label="Çıkış" title="Çıkış"><LogOut size={17} /></button>
        </header>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/strategy" element={<Strategy />} />
          <Route path="/articles" element={<Articles />} />
          <Route path="/articles/new" element={<ArticleEditor />} />
          <Route path="/articles/:id" element={<ArticleEditor />} />
          <Route path="/news" element={<News />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/niche" element={<Niche />} />
          <Route path="/keywords" element={<Keywords />} />
          <Route path="/serp" element={<Serp />} />
          <Route path="/opportunities" element={<Opportunities />} />
          <Route path="/limits" element={<Limits />} />
          <Route path="/api-usage" element={<ApiUsage />} />
          <Route path="/bots" element={<Bots />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {pw && <PasswordModal onClose={() => setPw(false)} onChanged={() => { setPw(false); onPasswordChanged(); }} />}
    </div>
  );
}

export default function App() {
  const [boot, setBoot] = useState({ loading: true, me: null, perms: [], status: null, error: '' });
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [unread, setUnread] = useState(0);
  const [theme, setThemeState] = useState(() => document.documentElement.dataset.theme || 'dark');
  const setTheme = (t) => { document.documentElement.dataset.theme = t; try { localStorage.setItem('cp-theme', t); } catch { /* private mode */ } setThemeState(t); };

  const loadMe = useCallback(async () => {
    try {
      const st = await api.get('/status');
      let me = null; let perms = [];
      try { const r = await api.get('/auth/me'); me = r.user; perms = r.permissions; } catch (e) { if (e.status !== 401) throw e; }
      setBoot({ loading: false, me, perms, status: st, error: '' });
    } catch (e) { setBoot({ loading: false, me: null, perms: [], status: null, error: e.message }); }
  }, []);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => { const h = () => setBoot((b) => ({ ...b, me: null, error: 'Oturum süresi doldu; yeniden giriş yapın.' })); window.addEventListener('cp:unauthorized', h); return () => window.removeEventListener('cp:unauthorized', h); }, []);

  const reloadProjects = useCallback(async () => {
    const r = await api.get('/projects'); setProjects(r.projects);
    setProjectId((cur) => (cur && r.projects.some((p) => p.id === cur) ? cur : (r.projects.find((p) => p.isDefault) || r.projects[0] || {}).id || null));
    return r.projects;
  }, []);
  const refreshUnread = useCallback(() => api.get('/notifications?unread=1&limit=1').then((r) => setUnread(r.unread), () => {}), []);
  useEffect(() => {
    if (!boot.me) return undefined;
    reloadProjects().catch(() => {}); refreshUnread();
    const t = setInterval(() => { if (!document.hidden) refreshUnread(); }, 60000);
    return () => clearInterval(t);
  }, [boot.me, reloadProjects, refreshUnread]);

  const logout = useCallback(async () => { await api.post('/auth/logout').catch(() => {}); setBoot((b) => ({ ...b, me: null, error: '' })); }, []);
  const value = useMemo(() => ({
    me: boot.me, can: (p) => boot.perms.includes(p), projectId, setProjectId, projects, reloadProjects, theme, setTheme, logout, unread, refreshUnread,
    project: projects.find((p) => p.id === projectId) || null, onPasswordChanged: () => setBoot((b) => ({ ...b, me: null, error: 'Şifre değişti; yeniden giriş yapın.' })),
  }), [boot.me, boot.perms, projectId, projects, reloadProjects, theme, logout, unread, refreshUnread]);

  if (boot.loading) return <div className="auth"><Loading label="Panel açılıyor…" /></div>;
  if (boot.error && !boot.status) return <div className="auth"><div className="card stack"><Alert kind="bad" title="Panele bağlanılamadı">{boot.error}</Alert><button className="btn primary" onClick={() => { setBoot((b) => ({ ...b, loading: true })); loadMe(); }}>Tekrar dene</button></div></div>;
  if (!boot.me) {
    return (
      <AppProvider value={value}>
        {boot.error && <div style={{ position: 'fixed', top: 12, left: 0, right: 0, display: 'grid', placeItems: 'center', zIndex: 70 }}><Alert kind="warn">{boot.error}</Alert></div>}
        <AuthScreen setupNeeded={!!(boot.status && boot.status.setupNeeded)} tokenConfigured={!!(boot.status && boot.status.setupTokenConfigured)} onDone={() => loadMe()} />
      </AppProvider>
    );
  }
  return <AppProvider value={value}><Shell /></AppProvider>;
}
