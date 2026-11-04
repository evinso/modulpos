const test = require('node:test');
const assert = require('node:assert/strict');
const { setSessionCookie, clearSessionCookie, readSessionCookie, COOKIE_NAME } = require('../../src/utils/sessionCookie');

const fakeRes = () => { const h = []; return { h, append: (k, v) => h.push([k, v]) }; };

test('cookie is httpOnly, SameSite=Lax, Secure in production, lifetime follows JWT_EXPIRES_IN', () => {
  process.env.NODE_ENV = 'production'; process.env.JWT_EXPIRES_IN = '7d';
  const res = fakeRes(); setSessionCookie(res, 'abc.def.ghi');
  const [name, value] = res.h[0];
  assert.equal(name, 'Set-Cookie');
  assert.ok(value.startsWith(`${COOKIE_NAME}=abc.def.ghi;`));
  for (const flag of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/', `Max-Age=${7 * 86400}`]) assert.ok(value.includes(flag), flag);
  assert.ok(!/Domain=/i.test(value), 'host-only cookie');
});
test('not Secure outside production (local development over http)', () => {
  process.env.NODE_ENV = 'development';
  const res = fakeRes(); setSessionCookie(res, 't');
  assert.ok(!res.h[0][1].includes('Secure'));
});
test('clearing expires the cookie immediately', () => {
  process.env.NODE_ENV = 'production';
  const res = fakeRes(); clearSessionCookie(res);
  assert.ok(res.h[0][1].startsWith(`${COOKIE_NAME}=;`)); assert.ok(res.h[0][1].includes('Max-Age=0'));
});
test('reads the session cookie among other cookies, ignores look-alikes', () => {
  assert.equal(readSessionCookie({ headers: { cookie: `a=1; ${COOKIE_NAME}=tok%2Ben; b=2` } }), 'tok+en');
  assert.equal(readSessionCookie({ headers: { cookie: `x${COOKIE_NAME}=evil; other=1` } }), null);
  assert.equal(readSessionCookie({ headers: {} }), null);
});
