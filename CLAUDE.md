# ModulPOS

E-commerce integration platform: imports supplier XML feeds, prices products with templates, validates them and sends them to
marketplaces (Trendyol first; Hepsiburada / Pazarama / Çiçeksepeti partly).

```
server/   Express + Prisma (PostgreSQL) API, cron jobs          → Render web service (Singapore)
client/   React + Vite single page app                          → Render static site
docs/     Trendyol API notes
render.yaml  Render Blueprint      DEPLOY_RENDER.md  deployment & operations
```

## Commands
```bash
cd server && npm install && npm test            # unit tests (no database needed)
cd server && npx prisma generate && npm run dev # needs DATABASE_URL / DIRECT_URL / JWT_SECRET in server/.env
cd client && npm install && npm run dev         # VITE_API_BASE_URL in client/.env
```

## Architecture notes (non-obvious)
* **One pricing engine** (`server/src/services/pricingEngine.js`) prices products for the list, the send routes and the cron.
  Sale VAT comes from the product (chosen when the XML source is added), never from the pricing template.
* **One readiness validator** (`services/readiness.js`) decides whether a product may be sent; the list shows its reasons
  and the send routes refuse what it blocks. Add new send-time rules there, not in the routes.
* **XML sync** (`services/xml/syncService.js`) is shared by the manual button and cron: diff in memory, batch writes,
  background job tracked in `SyncLog`, one sync per source.
* **Field mapping**: `xml/autoMapping.js` guesses the mapping for new feeds; the user's saved mapping always wins.
* **Tenant isolation**: every route that takes an `:id` must verify the record belongs to the caller's store
  (`middleware/ownership.js` → `router.param`). Never look records up by `id` alone.
* **Auth**: httpOnly cookie session (`utils/sessionCookie.js`, `middleware/auth.js`); never store the JWT in browser storage or URLs.
  Cookie-authenticated unsafe requests need the `X-Requested-With` header (CSRF guard). Bearer tokens remain valid for scripts.
* Marketplace credentials are encrypted at rest by a Prisma client extension (`config/database.js`); responses never include them.
* Content rules (forbidden words) are applied to the stored copy; the original feed text stays in `Product.rawXmlData`.
* Free-tier hosting: the API sleeps without traffic; cron jobs only run while awake (see DEPLOY_RENDER.md).
