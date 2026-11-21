const db = require('../db');
const passwords = require('../lib/passwords');
const tokens = require('../lib/tokens');
const V = require('../lib/validate');
const { env } = require('../env');
const { HttpError, bad } = require('../lib/http');

/**
 * Administrators, sessions and login protection.
 *  - passwords: bcrypt, a policy (length, not common, not the e-mail)
 *  - session: a random token in an httpOnly cookie; only its SHA-256 is stored, so a database leak does not hand out sessions
 *  - failed logins are counted per ip+e-mail in the database (a restart does not reset them) and lock the account after repeated failures
 *  - the first administrator can only be created with the one-time CONTENT_SETUP_TOKEN of the deployment, so a stranger cannot claim a fresh install
 */
const SESSION_DAYS = 7;
const THROTTLE_MAX = 5;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const LOCK_AFTER = 10;
const LOCK_MS = 15 * 60 * 1000;
const TOUCH_MS = 5 * 60 * 1000;
const ROLES = ['admin', 'editor', 'viewer'];

const PERMS = {
  'articles.write': ['admin', 'editor'], 'categories.write': ['admin', 'editor'], 'projects.write': ['admin'], 'settings.write': ['admin'],
  'providers.write': ['admin'], 'users.manage': ['admin'], 'bots.control': ['admin'], 'logs.read': ['admin', 'editor'],
  'research.write': ['admin', 'editor'], 'sources.write': ['admin'], 'research.paid': ['admin'],       // news runs / scoring | adding addresses the server will fetch | calls that cost money
};
const can = (role, perm) => !PERMS[perm] || PERMS[perm].includes(role);

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role_id, isActive: u.is_active, lastLoginAt: u.last_login_at, createdAt: u.created_at });

async function userCount() { return (await db.query('SELECT count(*)::int n FROM users')).rows[0].n; }

async function createUser({ email, name, password, role }) {
  const e = V.email(email);
  const n = V.str(name, 'Ad', { required: true, max: 100 });
  const r = V.oneOf(role, 'Rol', ROLES);
  const problem = passwords.policyError(password, e);
  if (problem) throw bad(problem);
  const hash = await passwords.hash(password);
  try {
    const row = (await db.query('INSERT INTO users (email, name, password_hash, role_id) VALUES ($1,$2,$3,$4) RETURNING *', [e, n, hash, r])).rows[0];
    return publicUser(row);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Bu e-posta ile kayıtlı bir kullanıcı var');
    throw err;
  }
}

/** The very first administrator. Refused unless there are no users yet and the deployment's setup token is given. */
async function setupFirstAdmin({ token, email, name, password }) {
  const expected = env().setupToken;
  if (!expected) throw new HttpError(503, 'Kurulum anahtarı (CONTENT_SETUP_TOKEN) sunucuda tanımlı değil; ilk yönetici oluşturulamaz');
  if (!token || !tokens.safeEqual(token, expected)) throw new HttpError(403, 'Kurulum anahtarı yanlış');
  return db.tx(async (c) => {
    await c.query('LOCK TABLE users IN EXCLUSIVE MODE');                    // two simultaneous setups cannot both succeed
    if ((await c.query('SELECT count(*)::int n FROM users')).rows[0].n > 0) throw new HttpError(409, 'Kurulum zaten yapılmış');
    const e = V.email(email);
    const n = V.str(name, 'Ad', { required: true, max: 100 });
    const problem = passwords.policyError(password, e);
    if (problem) throw bad(problem);
    const row = (await c.query("INSERT INTO users (email, name, password_hash, role_id) VALUES ($1,$2,$3,'admin') RETURNING *", [e, n, await passwords.hash(password)])).rows[0];
    return publicUser(row);
  });
}

async function newSession(userId, { ip, userAgent }) {
  const token = tokens.newToken();
  await db.query('INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent) VALUES ($1,$2, now() + ($3 || \' days\')::interval, $4, $5)',
    [userId, tokens.sha256(token), String(SESSION_DAYS), ip || null, String(userAgent || '').slice(0, 300)]);
  return { token, maxAgeSeconds: SESSION_DAYS * 86400 };
}

const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5G1oYR0Cc1N3zq5Qm4QGv3C2s0kXk7W';   // compared when the user does not exist, so timing does not tell

/**
 * @returns { user, token, maxAgeSeconds }; throws 401 (wrong data), 423 (account locked) or 429 (too many tries)
 */
async function login({ email, password, ip, userAgent }) {
  const e = String(email || '').trim().toLowerCase();
  const key = `${ip || '-'}|${e}`;
  const now = Date.now();
  const t = (await db.query('SELECT count, window_start FROM login_throttle WHERE key = $1', [key])).rows[0];
  if (t && now - new Date(t.window_start).getTime() < THROTTLE_WINDOW_MS && t.count >= THROTTLE_MAX) {
    const wait = Math.ceil((THROTTLE_WINDOW_MS - (now - new Date(t.window_start).getTime())) / 60000);
    throw new HttpError(429, `Çok fazla başarısız deneme. ${wait} dakika sonra tekrar deneyin`, { retryAfterMinutes: wait });
  }
  const user = e ? (await db.query('SELECT * FROM users WHERE lower(email) = $1', [e])).rows[0] : null;
  if (user && user.locked_until && new Date(user.locked_until).getTime() > now) throw new HttpError(423, 'Hesap geçici olarak kilitlendi; biraz sonra tekrar deneyin');
  const okPw = await passwords.verify(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  if (!user || !okPw || !user.is_active) {
    await db.query(`INSERT INTO login_throttle (key, count, window_start) VALUES ($1, 1, now())
      ON CONFLICT (key) DO UPDATE SET count = CASE WHEN login_throttle.window_start < now() - ($2 || ' milliseconds')::interval THEN 1 ELSE login_throttle.count + 1 END,
        window_start = CASE WHEN login_throttle.window_start < now() - ($2 || ' milliseconds')::interval THEN now() ELSE login_throttle.window_start END`, [key, String(THROTTLE_WINDOW_MS)]);
    if (user) {
      const failed = (await db.query('UPDATE users SET failed_logins = failed_logins + 1 WHERE id = $1 RETURNING failed_logins', [user.id])).rows[0].failed_logins;
      if (failed >= LOCK_AFTER) await db.query("UPDATE users SET locked_until = now() + ($2 || ' milliseconds')::interval, failed_logins = 0 WHERE id = $1", [user.id, String(LOCK_MS)]);
    }
    throw new HttpError(401, 'E-posta ya da şifre hatalı');
  }
  await db.query('DELETE FROM login_throttle WHERE key = $1', [key]);
  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
  const s = await newSession(user.id, { ip, userAgent });
  return { user: publicUser(user), ...s };
}

async function logout(token) { if (token) await db.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [tokens.sha256(token)]); }

/** The user behind a session cookie, or null (unknown, expired, revoked, user switched off). */
async function authenticate(token) {
  if (!token) return null;
  const r = (await db.query(`SELECT s.id AS session_id, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active`, [tokens.sha256(token)])).rows[0];
  if (!r) return null;
  if (Date.now() - new Date(r.last_seen_at).getTime() > TOUCH_MS) db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [r.session_id]).catch(() => {});
  return { sessionId: r.session_id, user: publicUser(r) };
}

async function changePassword(userId, { current, next }) {
  const u = (await db.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
  if (!u || !(await passwords.verify(String(current || ''), u.password_hash))) throw new HttpError(403, 'Mevcut şifre yanlış');
  const problem = passwords.policyError(next, u.email);
  if (problem) throw bad(problem);
  await db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await passwords.hash(next), userId]);
  await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);   // every other device is logged out
}

async function listUsers() { return (await db.query('SELECT * FROM users ORDER BY created_at')).rows.map(publicUser); }

async function updateUser(id, { role, isActive, name }) {
  const u = (await db.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
  if (!u) throw new HttpError(404, 'Kullanıcı bulunamadı');
  const newRole = role === undefined ? u.role_id : V.oneOf(role, 'Rol', ROLES);
  const active = isActive === undefined ? u.is_active : V.bool(isActive, 'Aktif');
  if (u.role_id === 'admin' && (newRole !== 'admin' || !active)) {
    const others = (await db.query("SELECT count(*)::int n FROM users WHERE role_id = 'admin' AND is_active AND id <> $1", [id])).rows[0].n;
    if (others === 0) throw new HttpError(409, 'Son aktif yönetici düşürülemez ya da kapatılamaz');
  }
  const row = (await db.query('UPDATE users SET role_id = $1, is_active = $2, name = COALESCE($3, name), updated_at = now() WHERE id = $4 RETURNING *',
    [newRole, active, name === undefined ? null : V.str(name, 'Ad', { required: true, max: 100 }), id])).rows[0];
  if (!active) await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
  return publicUser(row);
}

module.exports = { createUser, setupFirstAdmin, login, logout, authenticate, changePassword, listUsers, updateUser, userCount, can, PERMS, ROLES, THROTTLE_MAX, LOCK_AFTER, SESSION_DAYS };
