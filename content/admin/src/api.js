/**
 * The only door to the backend. Cookie session (httpOnly, set by the server), the CSRF header on every call, errors as readable sentences.
 * Nothing is kept in browser storage except the theme choice.
 */
const BASE = (import.meta.env && import.meta.env.VITE_CONTENT_API_BASE_URL) || '/api/content';

/** the public address of the API when the panel knows it (an absolute base address), else '' (the server then uses the address the panel called) */
export const API_ORIGIN = (() => { try { return new URL(BASE).origin; } catch { return ''; } })();

export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data || {}; }
}

async function request(method, path, body, { raw = false } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method, credentials: 'include',
      headers: { 'X-Requested-With': 'modulpos-content', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin ya da biraz sonra tekrar deneyin.');
  }
  if (raw) {
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(res.status, d.error || 'İstek başarısız', d); }
    return res;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') window.dispatchEvent(new Event('cp:unauthorized'));
    throw new ApiError(res.status, (data && data.error) || `İstek başarısız (${res.status})`, data);
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b === undefined ? {} : b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
  /** The bytes of a file the API serves behind the session (an <img> cannot send the CSRF header); the caller makes an object address from it. */
  async blob(path) { return (await request('GET', path, undefined, { raw: true })).blob(); },
  /** Downloads a file the API builds (export). The cookie and header are needed, so a plain link would not work. */
  async download(path) {
    const res = await request('GET', path, undefined, { raw: true });
    const cd = res.headers.get('content-disposition') || '';
    const name = (cd.match(/filename="([^"]+)"/) || [])[1] || 'export';
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { name, count: Number(res.headers.get('x-article-count') || 0) };
  },
};

export const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
