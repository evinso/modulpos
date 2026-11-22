/**
 * ModulPOS AI Content Intelligence: settings that come from the environment.
 * The whole module is OFF unless CONTENT_DATABASE_URL is set (its own database, never the ModulPOS one), so merging this code changes nothing
 * for ModulPOS until the content database exists. CONTENT_DISABLED=1 is the kill switch.
 * Read on every call (not at load) so tests and a changed environment take effect.
 */
const list = (v, fallback) => String(v == null || v === '' ? fallback : v).split(',').map((s) => s.trim()).filter(Boolean);

function env() {
  const e = process.env;
  return {
    enabled: !!(e.CONTENT_DATABASE_URL && e.CONTENT_DISABLED !== '1'),
    databaseUrl: e.CONTENT_DATABASE_URL || '',
    dbSsl: e.CONTENT_DB_SSL === '1' || /supabase\.(co|com)/i.test(e.CONTENT_DATABASE_URL || ''),
    schema: /^[a-z_][a-z0-9_]{0,62}$/.test(e.CONTENT_DB_SCHEMA || '') ? e.CONTENT_DB_SCHEMA : '',   // own schema (must exist); empty = the database's default schema
    poolMax: Math.min(8, Math.max(1, parseInt(e.CONTENT_DB_POOL_MAX, 10) || 3)),
    encryptionKey: /^[0-9a-fA-F]{64}$/.test(e.CONTENT_ENCRYPTION_KEY || '') ? e.CONTENT_ENCRYPTION_KEY : '',
    setupToken: e.CONTENT_SETUP_TOKEN || '',
    adminOrigins: list(e.CONTENT_ADMIN_ORIGINS, 'https://content.modulpos.com'),
    isProd: e.NODE_ENV === 'production',
    allowPrivateFetch: e.NODE_ENV !== 'production' && e.CONTENT_ALLOW_PRIVATE_FETCH === '1',   // tests only: lets safeFetch reach 127.0.0.1
    defaultTimezone: e.CONTENT_TIMEZONE || 'Europe/Istanbul',
    schedulerEnabled: e.CONTENT_SCHEDULER === '1' || (e.NODE_ENV === 'production' && e.CONTENT_SCHEDULER !== '0'),   // the background loops: on in production unless CONTENT_SCHEDULER=0; tests start them by hand
  };
}

module.exports = { env };
