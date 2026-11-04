const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { withIdleTimeout } = require('../../src/services/xml/xmlParser');

const collect = (stream) => new Promise((resolve, reject) => {
  const parts = [];
  stream.on('data', (c) => parts.push(c)); stream.on('end', () => resolve(Buffer.concat(parts).toString())); stream.on('error', reject);
});

test('a healthy download passes through unchanged', async () => {
  const src = new PassThrough();
  const res = withIdleTimeout({ data: src }, 500);
  const out = collect(res.data);
  src.write('hello '); await new Promise((r) => setTimeout(r, 50)); src.write('world'); src.end();
  assert.equal(await out, 'hello world');
});

test('a download that stalls mid-way is aborted instead of hanging forever', async () => {
  const src = new PassThrough();
  const res = withIdleTimeout({ data: src }, 120);
  const out = collect(res.data);
  src.write('partial');           // then nothing more arrives and the stream never ends
  await assert.rejects(out, /veri göndermedi/);
});

test('a slow but steady download is not aborted', async () => {
  const src = new PassThrough();
  const res = withIdleTimeout({ data: src }, 150);
  const out = collect(res.data);
  for (let i = 0; i < 5; i++) { src.write(String(i)); await new Promise((r) => setTimeout(r, 60)); }
  src.end();
  assert.equal(await out, '01234');
});
