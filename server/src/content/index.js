const { env } = require('./env');
const { migrate } = require('./migrate');

/**
 * ModulPOS AI Content Intelligence: entry point. app.js calls mount(app) once.
 *  - CONTENT_DATABASE_URL missing (or CONTENT_DISABLED=1): nothing is connected, /api/content answers 503 "kapalı", ModulPOS is untouched
 *  - otherwise the content database is migrated in the BACKGROUND (never blocks or crashes the API; a failure is retried with growing pauses), then the default project is created
 */
const state = { status: 'disabled', error: null, attempts: 0 };
const getState = () => state;
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

async function boot() {
  const projects = require('./services/projects');
  const delays = [5000, 15000, 30000, 60000, 120000, 300000];
  state.status = 'starting';
  for (;;) {
    try {
      state.attempts++;
      const m = await migrate({ log: (s) => console.log(`[Content] ${s}`) });
      const seeded = await projects.seedDefault();
      state.status = 'ready'; state.error = null;
      keepDatabaseAwake();
      console.log(`[Content] ready (${m.total} migrations, ${m.applied.length} applied now${seeded.created ? ', default project created' : ''})`);
      return;
    } catch (err) {
      state.status = 'failed'; state.error = err.message;
      console.error(`[Content] database not ready (attempt ${state.attempts}):`, err.message);
      await sleep(delays[Math.min(state.attempts - 1, delays.length - 1)]);
    }
  }
}

/**
 * A free Supabase project pauses after about a week without activity. The API wakes up daily and the boot above already touches the database, but a process that
 * stays up for days would not: one trivial query every 6 hours (only while the API is awake anyway) keeps the content database active.
 */
let keepTimer = null;
function keepDatabaseAwake() {
  if (keepTimer) return;
  keepTimer = setInterval(() => { require('./db').query('SELECT 1').catch((err) => console.error('[Content] keep-alive query failed:', err.message)); }, 6 * 3600 * 1000);
  if (keepTimer.unref) keepTimer.unref();
}

/** @returns the content router (or a "closed" router when the module is off). */
function mount(app) {
  const e = env();
  if (!e.enabled) {
    app.use('/api/content', (_req, res) => res.status(503).json({ error: 'İçerik modülü bu sunucuda kapalı (CONTENT_DATABASE_URL tanımlı değil)', state: 'disabled' }));
    return { enabled: false };
  }
  const { buildRouter } = require('./routes');
  app.use('/api/content', buildRouter(getState));
  boot().catch((err) => console.error('[Content] boot stopped:', err && err.message));
  return { enabled: true };
}

/** Extra browser origins the API's CORS list must accept (only when the module is on). */
const corsOrigins = () => (env().enabled ? env().adminOrigins : []);

module.exports = { mount, corsOrigins, getState, boot };
