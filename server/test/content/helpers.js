/**
 * Integration tests of the content module need a REAL PostgreSQL (row locks, unique indexes and transactions are what is being tested).
 * Set CONTENT_TEST_DATABASE_URL to an empty database whose name ends in "_test"; every run wipes it. Without it the tests are skipped (npm test never needs it).
 *   local:  postgresql://cp@127.0.0.1:54329/content_test      CI: the postgres service in .github/workflows
 * Run:  npm run test:content   (one test file at a time: they share the database)
 */
const url = process.env.CONTENT_TEST_DATABASE_URL || '';
const dbName = (() => { try { return new URL(url).pathname.replace(/^\//, ''); } catch { return ''; } })();
const skip = !url ? 'CONTENT_TEST_DATABASE_URL yok: gerçek PostgreSQL gerektiren entegrasyon testi atlandı' : (/_test$/.test(dbName) ? false : 'CONTENT_TEST_DATABASE_URL veritabanı adı "_test" ile bitmeli (yanlışlıkla gerçek veriyi silmemek için)');

if (!skip) {
  process.env.CONTENT_DATABASE_URL = url;
  process.env.CONTENT_DISABLED = '';
  process.env.CONTENT_ENCRYPTION_KEY = 'b2'.repeat(32);
  process.env.CONTENT_SETUP_TOKEN = 'setup-token-for-tests-0123456789';
  process.env.CONTENT_ADMIN_ORIGINS = 'https://content.example.test';
  process.env.CONTENT_TIMEZONE = 'Europe/Istanbul';
}

const db = () => require('../../src/content/db');

/** Empty schema + all migrations. Call once per test file (before). */
async function freshDatabase() {
  const d = db();
  await d.query('DROP SCHEMA IF EXISTS public CASCADE');
  await d.query('CREATE SCHEMA public');
  return require('../../src/content/migrate').migrate();
}

/** Removes the data of every table but the fixed ones (roles, _migrations). Call between tests. */
async function clean() {
  const d = db();
  const t = (await d.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('roles', '_migrations')")).rows.map((r) => `"${r.tablename}"`);
  if (t.length) await d.query(`TRUNCATE ${t.join(', ')} RESTART IDENTITY CASCADE`);
}

const close = () => db().end();

/** the tests of the ORIGINAL strict scoring (volume, SERP, a person's short list) switch the fresh-news lane off first: the lane is a newer, separate path (contentFlow.test.js) */
async function noFreshLane() { const S = require('../../src/content/services/settings'); await S.set('seo', { ...(await S.get('seo')).value, freshHours: 0 }, { scope: 'global' }); }

module.exports = { skip, freshDatabase, clean, close, db, noFreshLane };
