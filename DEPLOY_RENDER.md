# Deployment (Render + Supabase)

| Part | Where | Notes |
|---|---|---|
| API (`server/`) | Render web service **`modulpos-api`**, region **Singapore** | same region as the database; `api.modulpos.com` |
| Web app (`client/`) | Render static site `entegrasyon-client` | `modulpos.com`, `www.modulpos.com` |
| Database | Supabase project `modulpos` (ap-southeast-1), Postgres schema **`app`** | the old POS tables in schema `public` are unrelated |

Everything is described in `render.yaml` (Blueprint, auto-sync on push to `main`).

## Environment variables (API service)

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Supabase **pooler** URL (port 6543, `?pgbouncer=true&schema=app`) |
| `DIRECT_URL` | Supabase direct/session URL (port 5432, `?schema=app`), used for schema changes |
| `JWT_SECRET` | ≥ 32 chars, the API refuses to start in production otherwise |
| `ENCRYPTION_KEY` | 64 hex chars, AES-256-GCM key for stored marketplace credentials. **Back it up** – losing it makes them unrecoverable |
| `ENCRYPTION_KEY_PREVIOUS` | only while rotating the key (`server/scripts/rotateEncryptionKey.js`) |
| `ADMIN_EMAIL` | account promoted to `superadmin` at boot |
| `RETURN_TOKEN_IN_BODY` | `0` (current): login/register no longer put the JWT in the JSON body; the session is the httpOnly cookie `mp_session` only |
| `CORS_ORIGIN` | comma separated allowed origins |
| `RETENTION_*_DAYS` | optional log retention (defaults: product logs 30, API logs 30, sync logs 60, webhooks 30) |
| `WAHA_BASE_URL`, `WAHA_API_KEY` | only when WhatsApp should go through a separate WAHA server (see *WhatsApp*); without them the built-in connection is used |
| `WHATSAPP_ENGINE` | optional: `embedded` or `waha` forces one of the two |
| `ALLOW_UNSIGNED_PROXY` | `1` re-opens `/api/xml-converter/proxy` for unsigned URLs (not recommended) |

PayTR credentials are stored in the admin settings (or `PAYTR_MERCHANT_ID/KEY/SALT`); payments stay disabled until all three exist.

## WhatsApp
Admin only (the **WhatsApp** page under *Sistem Yönetimi*; normal users cannot see or change anything there). There is **one** WhatsApp
number for the whole platform, the one the admin links with a QR code, and every message (to the admin, to users, login codes) goes out
through it. Users only give their phone number.

**Built-in connection (default, free, nothing to install).** The API itself is the linked device (Baileys). The login is stored encrypted in the
database (table `WhatsappAuthState`), so a sleep or a deploy does not unlink the phone; the connection is opened when something needs it.
1. WhatsApp page: *Bağlantı Ekle* (any session name, e.g. `default`) → *QR Kodu Göster* (it renews itself about every 20 s) → on the phone:
   WhatsApp → Bağlı cihazlar → Cihaz bağla. The card turns *Bağlı* and shows the last digits of the linked number.
2. *Bildirim Ayarları*: admin phone as `905XXXXXXXXX`, tick the events, *Kaydet*, *Test Gönder*. Switch *WhatsApp OTP* on **last**: if the
   connection is down or a user's phone is wrong, nobody can log in from a browser that has no open session.
3. *Oturumu kapat / sıfırla* (the exit icon) unlinks the phone and deletes the stored login; the next QR starts clean.
Limits and behaviour: messages go out one at a time with a short pause, at most 120 an hour; the first message after the API woke up waits a few
seconds for the connection. Incoming chats are never read. Baileys is pinned to an exact version: WhatsApp changes can break such libraries, so after
a bump (or if the QR stops appearing) check *QR Kodu Göster* first. Only one process may use the linked number at a time: during a deploy two instances
overlap for a moment and WhatsApp keeps one of them.

**WAHA (optional, separate server).** Set `WAHA_BASE_URL=https://<waha host>` and `WAHA_API_KEY` (the same key WAHA runs with) and deploy; the page
then talks to WAHA instead. WAHA must run on an always-on machine with a persistent disk (docker compose: image `devlikeapro/waha`, port 3000, volume
`./.sessions:/app/.sessions`, `WAHA_API_KEY=<long random secret>`, `WHATSAPP_DEFAULT_ENGINE=NOWEB`); it cannot run on Render's free plan (it sleeps, has no
persistent disk, and a second always-on free service would use up the shared 750 free hours of the workspace).

Either way: use a dedicated SIM. Both are unofficial ways to use WhatsApp, and many automated messages can get a number restricted.

## Sessions
The browser session is an **httpOnly, Secure, SameSite=Lax cookie** (`mp_session`, host-only on `api.modulpos.com`), so page scripts can
never read it. State-changing requests must also carry `X-Requested-With: XMLHttpRequest` (the web app adds it); cross-site pages cannot.
Because `modulpos.com` and `api.modulpos.com` are the same *site*, this works only on the custom domains – logging in at
`*.onrender.com` addresses will not keep the session. `Authorization: Bearer` is still accepted for scripts/tests (a token can be
read from the cookie). Rotating `JWT_SECRET` signs everybody out. Env-var changes made through the API need a manual deploy to take effect.

## Start-up
`(npx prisma db push --skip-generate || echo …) && npm start`. `db push` is additive; if it fails (for example because a newer
schema is already in the database) the API still starts with the existing schema instead of crash-looping.
**When you change `schema.prisma`, deploy the code in the same push** – the push applies the schema, and an older running
version does not need the new tables.

## Health & monitoring
* `GET /api/health` – shallow (used by Render). `GET /api/health?db=1` – also checks the database.
* `.github/workflows/keepalive.yml` pings both every 10 minutes (keeps the free instance awake, keeps Supabase from pausing)
  and **fails – so GitHub e-mails you – when the API or the web app is down**. Check the *Actions* tab if automatic XML syncs stop.
* The free Render plan sleeps without traffic and then **in-process cron jobs do not run**. Upgrading the API service to a paid
  plan removes the dependency on the keepalive.

## Backups
Supabase's free plan has no automatic backups, so they are done separately:

* **Daily, automatic:** the **private** repository `evinso/modulpos-backups` runs a GitHub Action every day at 03:30 UTC
  (secret `DIRECT_URL` = the Supabase session URL) and commits the database as plain NDJSON under `data/`.
  The git history is the version history; a failed run e-mails the repository owner. Restore instructions are in that repo's README.
  Never put backup files in *this* repository – it is public.
* **Manual:** `node server/scripts/backup.js` (timestamped, compressed, `~/modulpos-backups`) – see the script header.
* The backups contain personal data. Keep the backup repository private, protect the GitHub account with two-factor authentication,
  and keep a copy of `ENCRYPTION_KEY` in a password manager (stored marketplace credentials are unreadable without it).

## Rollback
Render dashboard → service → *Deploys* → redeploy a previous commit. Schema changes are additive, so older code keeps working.

## Smoke test
`GET https://api.modulpos.com/api/health?db=1` → 200; log in; open *Trendyol'a Gönder*. Full automated checks: `server/test/e2e/README.md`.
