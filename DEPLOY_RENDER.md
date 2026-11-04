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
| `CORS_ORIGIN` | comma separated allowed origins |
| `RETENTION_*_DAYS` | optional log retention (defaults: product logs 30, API logs 30, sync logs 60, webhooks 30) |
| `ALLOW_UNSIGNED_PROXY` | `1` re-opens `/api/xml-converter/proxy` for unsigned URLs (not recommended) |

PayTR credentials are stored in the admin settings (or `PAYTR_MERCHANT_ID/KEY/SALT`); payments stay disabled until all three exist.

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
Supabase's free plan has no automatic backups. Run `node server/scripts/backup.js` regularly (see the script header) and keep
the output somewhere safe.

## Rollback
Render dashboard → service → *Deploys* → redeploy a previous commit. Schema changes are additive, so older code keeps working.

## Smoke test
`GET https://api.modulpos.com/api/health?db=1` → 200; log in; open *Trendyol'a Gönder*. Full automated checks: `server/test/e2e/README.md`.
