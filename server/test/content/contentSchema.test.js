const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

// CONTENT_DB_SCHEMA: everything (tables, the migration record, the advisory-locked migration run) lands in the named schema, never in `public`
test('own schema: migrations and services work inside it and leave public untouched', { skip: H.skip }, async () => {
  const d = H.db();
  await d.query('DROP SCHEMA IF EXISTS public CASCADE'); await d.query('CREATE SCHEMA public'); await d.query('DROP SCHEMA IF EXISTS content_own CASCADE'); await d.query('CREATE SCHEMA content_own');
  await d.end();
  process.env.CONTENT_DB_SCHEMA = 'content_own';
  try {
    const { migrate } = require('../../src/content/migrate');
    const out = await migrate();
    assert.equal(out.applied.length, out.total);
    const where = async (t) => (await d.query('SELECT table_schema FROM information_schema.tables WHERE table_name = $1', [t])).rows.map((r) => r.table_schema);
    assert.deepEqual(await where('articles'), ['content_own']); assert.deepEqual(await where('_migrations'), ['content_own']);
    assert.equal((await d.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public'")).rows[0].n, 0, 'public is empty');
    const P = require('../../src/content/services/projects');
    assert.equal((await P.seedDefault()).created, true);
    assert.equal((await P.listCategories((await P.listProjects())[0].id)).length, 5);
    assert.equal((await migrate()).applied.length, 0, 'a second run applies nothing');
    await d.end();
    process.env.CONTENT_DB_SCHEMA = 'Not Valid; drop';
    assert.equal(require('../../src/content/env').env().schema, '', 'a schema name that is not a plain identifier is ignored, never put into SQL');
  } finally {
    delete process.env.CONTENT_DB_SCHEMA;
    await d.end();
    await d.query('DROP SCHEMA IF EXISTS content_own CASCADE');
    await d.end();
  }
});
