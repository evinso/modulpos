const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const A = require('../../src/content/services/auth');
const tokens = require('../../src/content/lib/tokens');

const opts = { skip: H.skip };
const PW = 'Correct-Horse-9-Battery';
const TOKEN = 'setup-token-for-tests-0123456789';

test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

const admin = () => A.setupFirstAdmin({ token: TOKEN, email: 'Boss@Example.com', name: 'Boss', password: PW });
const fail = async (p) => { try { await p; } catch (e) { return e; } assert.fail('should have failed'); };

test('first administrator: only with the deployment token, only once, even when asked twice at the same moment', opts, async () => {
  assert.equal((await fail(A.setupFirstAdmin({ token: 'wrong', email: 'a@example.com', name: 'A', password: PW }))).status, 403);
  assert.equal((await fail(A.setupFirstAdmin({ token: '', email: 'a@example.com', name: 'A', password: PW }))).status, 403);
  assert.equal((await fail(A.setupFirstAdmin({ token: TOKEN, email: 'a@example.com', name: 'A', password: 'short' }))).status, 400);
  assert.equal(await A.userCount(), 0, 'refused attempts created nothing');
  const results = await Promise.allSettled([1, 2, 3].map((i) => A.setupFirstAdmin({ token: TOKEN, email: `a${i}@example.com`, name: 'A', password: PW })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one of three simultaneous setups wins');
  assert.equal(await A.userCount(), 1);
  assert.equal((await fail(admin())).status, 409);
  const saved = process.env.CONTENT_SETUP_TOKEN; process.env.CONTENT_SETUP_TOKEN = '';
  assert.equal((await fail(admin())).status, 503, 'no token configured on the server = no setup at all');
  process.env.CONTENT_SETUP_TOKEN = saved;
});

test('login: right password gives a session, e-mail is not case sensitive, only the hash of the token is stored', opts, async () => {
  const u = await admin();
  assert.equal(u.role, 'admin'); assert.equal(u.email, 'boss@example.com'); assert.equal(u.passwordHash, undefined);
  const l = await A.login({ email: 'BOSS@example.com', password: PW, ip: '1.1.1.1', userAgent: 'test' });
  assert.equal(l.user.email, 'boss@example.com'); assert.ok(l.token.length >= 40); assert.equal(l.maxAgeSeconds, 7 * 86400);
  const stored = (await H.db().query('SELECT token_hash FROM sessions')).rows;
  assert.equal(stored.length, 1); assert.notEqual(stored[0].token_hash, l.token); assert.equal(stored[0].token_hash, tokens.sha256(l.token));
  const me = await A.authenticate(l.token);
  assert.equal(me.user.id, u.id);
  assert.equal(await A.authenticate('nonsense'), null); assert.equal(await A.authenticate(''), null);
  await A.logout(l.token);
  assert.equal(await A.authenticate(l.token), null, 'a logged-out token is dead');
});

test('login: wrong data all look the same (401), unknown user costs the same work, 5 failures per ip+e-mail throttle', opts, async () => {
  await admin();
  assert.equal((await fail(A.login({ email: 'boss@example.com', password: 'wrong', ip: '2.2.2.2' }))).message, 'E-posta ya da şifre hatalı');
  assert.equal((await fail(A.login({ email: 'nobody@example.com', password: 'wrong', ip: '2.2.2.2' }))).message, 'E-posta ya da şifre hatalı');
  assert.equal((await fail(A.login({ email: '', password: '', ip: '2.2.2.2' }))).status, 401);
  // failures so far on "2.2.2.2|boss@example.com": 1 (the unknown user and the empty e-mail have their own keys); four more make 5
  for (let i = 0; i < 3; i++) await fail(A.login({ email: 'boss@example.com', password: 'wrong', ip: '2.2.2.2' }));
  assert.ok((await A.login({ email: 'boss@example.com', password: PW, ip: '2.2.2.2' })).token, 'the 5th try is still allowed (4 failures so far) and a success clears the counter');
  for (let i = 0; i < 5; i++) await fail(A.login({ email: 'boss@example.com', password: 'wrong', ip: '2.2.2.2' }));
  const blocked = await fail(A.login({ email: 'boss@example.com', password: PW, ip: '2.2.2.2' }));
  assert.equal(blocked.status, 429, 'even the right password is refused while throttled'); assert.ok(blocked.extra.retryAfterMinutes >= 1);
  const other = await A.login({ email: 'boss@example.com', password: PW, ip: '3.3.3.3' });
  assert.ok(other.token, 'another address is not throttled by this one');
});

test('login: 10 failures from changing addresses lock the account; success resets the counters', opts, async () => {
  await admin();
  for (let i = 0; i < 9; i++) await fail(A.login({ email: 'boss@example.com', password: 'wrong', ip: `9.9.9.${i}` }));
  assert.ok((await A.login({ email: 'boss@example.com', password: PW, ip: '9.9.9.100' })).token, '9 failures do not lock');
  for (let i = 0; i < 10; i++) await fail(A.login({ email: 'boss@example.com', password: 'wrong', ip: `8.8.8.${i}` }));
  const locked = await fail(A.login({ email: 'boss@example.com', password: PW, ip: '7.7.7.7' }));
  assert.equal(locked.status, 423, 'locked even for the right password');
  await H.db().query("UPDATE users SET locked_until = now() - interval '1 minute'");
  assert.ok((await A.login({ email: 'boss@example.com', password: PW, ip: '7.7.7.7' })).token, 'the lock runs out by itself');
});

test('sessions: expired, revoked or deactivated users are not authenticated; password change logs every device out', opts, async () => {
  const u = await admin();
  const s1 = await A.login({ email: 'boss@example.com', password: PW, ip: '1.1.1.1' });
  const s2 = await A.login({ email: 'boss@example.com', password: PW, ip: '1.1.1.2' });
  await H.db().query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [tokens.sha256(s2.token)]);
  assert.equal(await A.authenticate(s2.token), null, 'expired');
  assert.ok(await A.authenticate(s1.token));
  assert.equal((await fail(A.changePassword(u.id, { current: 'wrong', next: 'Another-Strong-Pass-1' }))).status, 403);
  assert.equal((await fail(A.changePassword(u.id, { current: PW, next: 'short' }))).status, 400);
  await A.changePassword(u.id, { current: PW, next: 'Another-Strong-Pass-1' });
  assert.equal(await A.authenticate(s1.token), null, 'old sessions are gone after a password change');
  assert.equal((await fail(A.login({ email: 'boss@example.com', password: PW, ip: '4.4.4.4' }))).status, 401);
  const s3 = await A.login({ email: 'boss@example.com', password: 'Another-Strong-Pass-1', ip: '4.4.4.4' });
  const ed = await A.createUser({ email: 'ed@example.com', name: 'Ed', password: PW, role: 'editor' });
  const se = await A.login({ email: 'ed@example.com', password: PW, ip: '5.5.5.5' });
  await A.updateUser(ed.id, { isActive: false });
  assert.equal(await A.authenticate(se.token), null, 'a switched-off user loses the session at once');
  assert.equal((await fail(A.login({ email: 'ed@example.com', password: PW, ip: '5.5.5.6' }))).status, 401);
  assert.ok(await A.authenticate(s3.token));
});

test('users and roles: duplicates, last-admin protection, permission matrix', opts, async () => {
  const u = await admin();
  assert.equal((await fail(A.createUser({ email: 'BOSS@example.com', name: 'Dup', password: PW, role: 'viewer' }))).status, 409);
  assert.equal((await fail(A.createUser({ email: 'x@example.com', name: 'X', password: PW, role: 'owner' }))).status, 400);
  assert.equal((await fail(A.createUser({ email: 'not-an-email', name: 'X', password: PW, role: 'viewer' }))).status, 400);
  const v = await A.createUser({ email: 'v@example.com', name: 'V', password: PW, role: 'viewer' });
  assert.equal((await A.listUsers()).length, 2);
  assert.equal((await fail(A.updateUser(u.id, { role: 'editor' }))).status, 409, 'the last admin cannot be demoted');
  assert.equal((await fail(A.updateUser(u.id, { isActive: false }))).status, 409, 'nor switched off');
  await A.updateUser(v.id, { role: 'admin' });
  assert.equal((await A.updateUser(u.id, { role: 'editor' })).role, 'editor', 'with a second admin the first may step down');
  assert.equal((await fail(A.updateUser('00000000-0000-0000-0000-000000000009', {}))).status, 404);
  assert.equal(A.can('viewer', 'articles.write'), false); assert.equal(A.can('editor', 'articles.write'), true);
  assert.equal(A.can('editor', 'settings.write'), false); assert.equal(A.can('admin', 'users.manage'), true);
  assert.equal(A.can('viewer', 'something.unknown'), true, 'actions that need no permission are open to every signed-in user');
});
