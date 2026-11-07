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
cd client && npm run test:smoke                 # renders the products screen in jsdom with a mocked API
```

## Architecture notes (non-obvious)
* **One pricing engine** (`server/src/services/pricingEngine.js`) prices products for the list, the send routes and the cron.
  Sale VAT comes from the product (chosen when the XML source is added), never from the pricing template.
  The template screen (`client/src/pages/pricing/`) is ONE screen with two template types: **Tek kâr** (one profit,
  percent of purchase or fixed TL) and **Kademeli kâr** (`profitTiers`, any number of rows by purchase price; `MAX_TIERS` = 1000 is only a safety ceiling). Costs are single values
  (shipping, other, commission). Keep it that way: no VAT options and no marketplace names/tariffs in this screen.
  The engine can still evaluate older stored rules that use `shippingTiers` (+`shippingTiersExVat`) or `margin_on_gross`,
  but no screen creates them; editing such a rule warns and drops them on save.
  A sale price typed in by hand for one product on one marketplace lives in `ProductPriceOverride` and is applied INSIDE
  `PricingContext` (`priceFor` / `explainFor`), so the list, readiness, sends and the automatic updates all use the same
  number. Never compute or store a sale price anywhere else. If the table cannot be read, pricing falls back to templates.
* **Products screen** (`client/src/pages/products/`): marketplace first, then its XML source (`SourceGate`); nothing is loaded
  before both are chosen. `xmlSourceId=none` = products added by hand. The price dialog (`PriceModal`) saves a hand-typed
  price and can send it (`priceActions.js`: on sale -> `sync-price-stock`, never sent -> `send-products`).
* **One readiness validator** (`services/readiness.js`) decides whether a product may be sent; the list shows its reasons
  and the send routes refuse what it blocks. Add new send-time rules there, not in the routes.
* **XML sync** (`services/xml/syncService.js`) is shared by the manual button and cron: diff in memory, batch writes,
  background job tracked in `SyncLog`, one sync per source.
  Products that are no longer in the feed get stock 0 (`services/xml/vanished.js`; they are not deleted and come back with
  the feed). A feed that looks broken is never acted on: empty feed, unreadable rows, or more than 25 products AND 10% of the
  live catalog missing at once (the stream parser silently accepts a cut-off download) -> nothing is zeroed and the sync notification says so. The 0 reaches Trendyol with the cron's
  automatic update (`autoSendToMarketplaces`); a manual sync does not push.
  After a sync that raised purchase prices, `services/manualPriceAlerts.js` reports hand-priced products that crossed into
  loss (notification `manual_price_loss`, only at the moment it happens); the product list/detail flag the state at any time
  (`pricing.loss`). `POST /products/reset-manual-prices` gives hand-typed prices back to the template (products no template
  covers keep theirs).
* **WhatsApp** (`services/whatsapp/`, `services/whatsappService.js`, page `/whatsapp`): admin only, page and API. ONE linked number for the whole platform
  (the admin scans the QR) sends everything, to the admin phone and to the users' phones; users never configure anything. Two engines behind `createClient()`
  (`whatsapp/index.js`): the **built-in connection** (Baileys, `embeddedService.js`: default when no `WAHA_BASE_URL`; the login is kept encrypted in table
  `WhatsappAuthState` because the free hosting has no disk; opened lazily, one message at a time with a pause, max 120 an hour) and **WAHA** (a separate
  server, `wahaService.js`: used when `WAHA_BASE_URL` is set or `WHATSAPP_ENGINE=waha`). Baileys is pinned to an exact version on purpose: WhatsApp changes
  can break it, so bump it deliberately and check that the QR still appears. Phones typed the local way (05XX…) are completed to 90… when sending
  (`normalizePhone`). Failures are reported on the WhatsApp page (`describeError`); the notification senders stay silent on purpose. In-app notifications are
  also forwarded to the user's phone unless created with `noWhatsapp: true` (the event checklist does not filter those; the XML sync notice opts out).
* **Field mapping**: `xml/autoMapping.js` guesses the mapping for new feeds; the user's saved mapping always wins.
* **Tenant isolation**: every route that takes an `:id` must verify the record belongs to the caller's store
  (`middleware/ownership.js` → `router.param`). Never look records up by `id` alone.
* **Auth**: httpOnly cookie session (`utils/sessionCookie.js`, `middleware/auth.js`); never store the JWT in browser storage or URLs.
  Cookie-authenticated unsafe requests need the `X-Requested-With` header (CSRF guard). Bearer tokens remain valid for scripts.
* Marketplace credentials are encrypted at rest by a Prisma client extension (`config/database.js`); responses never include them.
* The original feed values stay in `Product.rawXmlData` (used to detect what changed on the next sync).
* Free-tier hosting: the API sleeps without traffic; cron jobs only run while awake (see DEPLOY_RENDER.md).
