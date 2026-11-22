const http = require('node:http');

/**
 * A small fake WordPress over REAL HTTP (127.0.0.1): the routes the platform uses, Basic authentication with an application password, the capabilities of the user, and
 * failure switches (rights, a lost answer after the write, a pre-existing post with the same slug, a SEO plugin). The tests talk to it through the same guarded fetcher
 * the production code uses (CONTENT_ALLOW_PRIVATE_FETCH=1 lets that fetcher reach 127.0.0.1).
 */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function startFakeWp({ user = 'editor', password = 'abcd efgh ijkl mnop', namespaces = ['oembed/1.0', 'wp/v2'], canPublish = true, canUpload = true, name = 'Fake Tech Blog' } = {}) {
  const st = { user, password, namespaces, canPublish, canUpload, name, nextId: 100, posts: new Map(), categories: [{ id: 1, name: 'Uncategorized', slug: 'uncategorized', parent: 0, count: 5 }, { id: 5, name: 'AI Tools &amp; Updates', slug: 'ai-tools', parent: 0, count: 2 }], tags: [], media: [], requests: [], rankMath: [],
    dropAfterCreate: false, failNext: null, yoastMeta: false, notWordPress: false, delayMs: 0, authFailures: 0 };
  const send = (res, code, body, headers = {}) => { const s = typeof body === 'string' ? body : JSON.stringify(body); res.writeHead(code, { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json', ...headers }); res.end(s); };
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks); const u = new URL(req.url, 'http://x'); const route = u.pathname.replace(/^\/wp-json/, '') || '/';
      let json = null; if ((req.headers['content-type'] || '').startsWith('application/json') && raw.length) { try { json = JSON.parse(raw.toString('utf8')); } catch { json = null; } }
      st.requests.push({ method: req.method, route, query: Object.fromEntries(u.searchParams), json, headers: req.headers, size: raw.length });
      if (st.delayMs) await new Promise((r) => setTimeout(r, st.delayMs));
      if (u.pathname.startsWith('/img/')) { if (u.pathname === '/img/ok.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); } res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>not an image</html>'); }
      if (st.notWordPress) return send(res, 200, '<html><body>My shop</body></html>');
      if (st.failNext && st.failNext.match.test(`${req.method} ${route}`)) { const f = st.failNext; if (!f.keep) st.failNext = null; if (f.destroy) return req.socket.destroy(); return send(res, f.status, f.body || { code: 'rest_forbidden', message: 'no' }); }
      if (route === '/') return send(res, 200, { name: st.name, description: 'x', url: `http://${req.headers.host}`, namespaces: st.namespaces, timezone_string: 'Europe/Istanbul' });
      const auth = req.headers.authorization || '';
      const ok = auth === `Basic ${Buffer.from(`${st.user}:${st.password}`).toString('base64')}`;
      if (!ok) { st.authFailures++; return send(res, 401, { code: 'incorrect_password', message: 'The provided password is an invalid application password.', data: { status: 401 } }); }
      const m = (re) => re.exec(route);
      if (route === '/wp/v2/users/me') return send(res, 200, { id: 7, name: 'Editor Joe', roles: ['editor'], capabilities: { edit_posts: true, publish_posts: st.canPublish, upload_files: st.canUpload, manage_categories: true } });
      if (route === '/wp/v2/categories' && req.method === 'GET') { const page = Number(u.searchParams.get('page') || 1); return send(res, 200, st.categories.slice((page - 1) * 100, page * 100)); }
      if (route === '/wp/v2/categories' && req.method === 'POST') { if (st.categories.some((c) => c.name.toLowerCase() === String(json.name).toLowerCase())) return send(res, 400, { code: 'term_exists', message: 'A term with the name provided already exists.' }); const c = { id: ++st.nextId, name: json.name, slug: String(json.name).toLowerCase().replace(/\W+/g, '-'), parent: 0, count: 0 }; st.categories.push(c); return send(res, 201, c); }
      if (route === '/wp/v2/tags' && req.method === 'GET') { const q = (u.searchParams.get('search') || '').toLowerCase(); return send(res, 200, st.tags.filter((t) => t.name.toLowerCase().includes(q))); }
      if (route === '/wp/v2/tags' && req.method === 'POST') { const t = { id: ++st.nextId, name: json.name }; st.tags.push(t); return send(res, 201, t); }
      if (route === '/wp/v2/media' && req.method === 'POST') {
        if (!st.canUpload) return send(res, 403, { code: 'rest_cannot_create', message: 'Sorry, you are not allowed to upload.' });
        const md = { id: ++st.nextId, filename: (/filename="([^"]+)"/.exec(req.headers['content-disposition'] || '') || [])[1], mime: req.headers['content-type'], bytes: raw.length, alt: '' }; st.media.push(md); return send(res, 201, { id: md.id, source_url: `http://${req.headers.host}/uploads/${md.filename}` });
      }
      if ((m(/^\/wp\/v2\/media\/(\d+)$/)) && req.method === 'POST') { const md = st.media.find((x) => x.id === Number(m(/^\/wp\/v2\/media\/(\d+)$/)[1])); if (md && json) md.alt = json.alt_text; return send(res, 200, { id: md && md.id }); }
      if (route === '/wp/v2/posts' && req.method === 'GET') { const slug = u.searchParams.get('slug'); return send(res, 200, [...st.posts.values()].filter((p) => !slug || p.slug === slug).map((p) => out(p, req))); }
      if (route === '/wp/v2/posts' && req.method === 'POST') {
        if ((json.status === 'publish' || json.status === 'future') && !st.canPublish) return send(res, 403, { code: 'rest_cannot_publish', message: 'Sorry, you are not allowed to publish posts.' });
        const p = { id: ++st.nextId, slug: json.slug, status: json.status, title: json.title, content: json.content, excerpt: json.excerpt, categories: json.categories || [], tags: json.tags || [], featured_media: json.featured_media || 0, author: json.author || 1, date_gmt: json.date_gmt || new Date().toISOString().replace(/\.\d+Z$/, ''), meta: st.yoastMeta && json.meta ? json.meta : {}, history: [json] };
        if (p.status === 'future' && !json.date_gmt) return send(res, 400, { code: 'rest_invalid_param', message: 'date missing' });
        st.posts.set(p.id, p);
        if (st.dropAfterCreate) { st.dropAfterCreate = false; return req.socket.destroy(); }          // the post exists, the answer is lost
        return send(res, 201, out(p, req));
      }
      const pm = m(/^\/wp\/v2\/posts\/(\d+)$/);
      if (pm) {
        const p = st.posts.get(Number(pm[1])); if (!p) return send(res, 404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.' });
        if (req.method === 'GET') return send(res, 200, out(p, req));
        if ((json.status === 'publish' || json.status === 'future') && !st.canPublish) return send(res, 403, { code: 'rest_cannot_publish', message: 'no' });
        Object.assign(p, { slug: json.slug ?? p.slug, status: json.status ?? p.status, title: json.title ?? p.title, content: json.content ?? p.content, excerpt: json.excerpt ?? p.excerpt, categories: json.categories ?? p.categories, tags: json.tags ?? p.tags, featured_media: json.featured_media ?? p.featured_media });
        if (json.date_gmt) p.date_gmt = json.date_gmt; if (st.yoastMeta && json.meta) p.meta = json.meta; p.history.push(json);
        return send(res, 200, out(p, req));
      }
      if (route === '/rankmath/v1/updateMeta' && req.method === 'POST') { if (!st.namespaces.includes('rankmath/v1')) return send(res, 404, { code: 'rest_no_route', message: 'No route' }); st.rankMath.push(json); return send(res, 200, { slug: 'ok' }); }
      return send(res, 404, { code: 'rest_no_route', message: 'No route was found matching the URL and request method.' });
    });
  });
  const out = (p, req) => ({ id: p.id, slug: p.slug, status: p.status, link: `http://${req.headers.host}/${p.slug}/`, date_gmt: p.date_gmt, meta: p.meta, featured_media: p.featured_media, modified_gmt: p.date_gmt });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  st.url = `http://127.0.0.1:${server.address().port}`;
  st.close = () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(r); });
  /** makes a scheduled post go live (what WordPress's own cron does at the time) */
  st.goLive = (id) => { const p = st.posts.get(id); if (p) p.status = 'publish'; };
  return st;
}

module.exports = { startFakeWp, PNG };
