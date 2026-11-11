const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyAiError } = require('../../src/services/aiErrors');

const billing = Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'), { status: 400 });

test('empty Anthropic balance is fatal and tells the admin where to top up', () => {
  const r = classifyAiError(billing, { admin: true });
  assert.equal(r.kind, 'billing'); assert.equal(r.fatal, true);
  assert.match(r.message, /Plans & Billing/);
});

test('a normal user gets no vendor details', () => {
  const r = classifyAiError(billing, { admin: false });
  assert.equal(r.fatal, true);
  assert.doesNotMatch(r.message, /console\.anthropic|Plans/);
  assert.match(r.message, /yöneticiye bildirin/i);
});

test('rejected key is fatal; the upstream 401 is never passed on', () => {
  const r = classifyAiError(Object.assign(new Error('401 invalid x-api-key'), { status: 401 }), { admin: true });
  assert.equal(r.kind, 'auth'); assert.equal(r.fatal, true);
  assert.equal(r.status, undefined);
});

test('rate limit and overload are not fatal', () => {
  assert.deepEqual(['rate', false], [classifyAiError({ status: 429, message: 'x' }).kind, classifyAiError({ status: 429, message: 'x' }).fatal]);
  const o = classifyAiError({ status: 529, message: 'overloaded' });
  assert.equal(o.kind, 'overloaded'); assert.equal(o.fatal, false);
});

test('a JSON parse problem is reported, not fatal', () => {
  const r = classifyAiError(new Error('JSON bulunamadı'));
  assert.equal(r.kind, 'other'); assert.equal(r.fatal, false);
  assert.match(r.message, /JSON bulunamadı/);
});
