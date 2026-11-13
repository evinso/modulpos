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
  (shipping, other, commission, service fee). Keep it that way: no marketplace names/tariffs in this screen.
  Tax options (added 2026-11-12 on the owner's request, they are a VAT payer): **KDV mükellefiyim** (`inputVat`, purchase VAT `purchaseVatRate` default 20) and **stopaj** (`withholdingPct`, 1% of the
  VAT-exclusive price). With them, profit = price - commission - service fee - other - shipping - purchase - stopaj - VAT payable, where VAT payable = VAT of the sale minus the VAT inside purchase,
  shipping, commission, service fee and other costs (20%, `EXPENSE_VAT`). `profitBreakdown()` is the ONE place that turns a price into a profit and `priceWith()` its exact inverse; both go through
  `taxModel()`. Without the options (every template saved before them) the earlier formulas run untouched, so changing a template's options changes its prices: it is the owner's decision per template.
  The engine can still evaluate older stored rules that use `shippingTiers` (+`shippingTiersExVat`) or `margin_on_gross`,
  but no screen creates them; editing such a rule warns and drops them on save.
  A sale price typed in by hand for one product on one marketplace lives in `ProductPriceOverride` and is applied INSIDE
  `PricingContext` (`priceFor` / `explainFor`), so the list, readiness, sends and the automatic updates all use the same
  number. Never compute or store a sale price anywhere else. If the table cannot be read, pricing falls back to templates.
* **Products screen** (`client/src/pages/products/`): marketplace first, then its XML source (`SourceGate`); nothing is loaded
  before both are chosen. `xmlSourceId=none` = products added by hand. The price dialog (`PriceModal`) saves a hand-typed
  price and can send it (`priceActions.js`: on sale -> `sync-price-stock`, never sent -> `send-products`).
* **Trendyol send page** (`/trendyol-send`, `TrendyolSendPage.jsx`): like the products screen it works inside ONE XML source that is chosen FIRST ("Önce XML kaynağını seçin"): before that nothing is listed, no mappings are read,
  and "Tümünü Gönder" / "Durumları Sorgula" are disabled; there is no "all suppliers" choice. `xmlSourceId=none` means products added by hand (understood by `product-list`, `product-list/ids` and `send-all-ready`).
  Choosing another source clears the product selection (a selection must never be sent into another source). The API itself still accepts `send-all-ready` without a source (older callers, e2e); only the page requires it.
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
* **Bulk WhatsApp** (admin area "Toplu WhatsApp", `/whatsapp-bulk`, `client/src/pages/whatsapp/bulk/`, API `/api/whatsapp-bulk` in `routes/whatsappBulk.js`; sidebar "Sistem Yönetimi"): a campaign = ONE text sent to a list of numbers, one after another, with a random pause
  between the campaign's minimum and maximum seconds (whole seconds, floor 5 s; the chosen moment has millisecond resolution; `bulkRunner.delayMs`) after EACH message, counted from the moment the send ended. Text only. **It sends from SENDER numbers, never from the platform's own WhatsApp** (the notification number of the `/whatsapp` page): the admin links up to 3 numbers on the bulk page itself (`WhatsappSender`, each with its own QR; routes `/senders*`; panel `SenderPanel.jsx`),
  a campaign picks one (`WhatsappCampaign.senderId`; without one it cannot start). A sender is its own `EmbeddedWhatsapp` connection from `services/whatsapp/senders.js` (registry) whose login lives in `WhatsappAuthState` under the key prefix `s-<id>:` while the platform's is `default:`,
  so linking / unlinking / deleting a sender can never touch the platform's login (unit-tested: `whatsappSenders.test.js`; live e2e checks the platform's rows are unchanged). Needs the built-in engine (not WAHA). A connection nobody used for 10 min is hung up (`suspend()`, the saved login stays;
  the next send opens it again) because the free hosting has little memory; the list asks `peekStatus()` (never opens anything), the QR panel's status/QR calls may. The list comes from typed / pasted numbers or a CSV file: `services/whatsapp/bulkCsv.js`
  (`parseList`, one place for the rules: separator `; , tab |`, header detection, number column by header or by content, name column, other columns become `{column}` fields in the message, `{ad|yedek}` fallback, numbers completed to 905XXXXXXXXX, Turkish numbers must be
  mobile, other countries need their country code, Excel's `5,32E+11` damage is reported, duplicates kept once, max 5000). The page decodes the file (UTF-8, else Windows-1254), the SERVER reads it (`POST /parse`, nothing saved) and re-checks every number on create.
  Tables `WhatsappCampaign` (status draft | running | paused | done, `statusNote`, `nextSendAt`, `dailyLimit`) and `WhatsappCampaignRecipient` (pending | sending | sent | failed). **The runner** (`services/whatsapp/bulkRunner.js`, started by `app.js` with `resume()`) keeps only a timer:
  everything else is in the database, so a sleep/deploy of the free hosting just pauses it (the GitHub keepalive wakes the API) and it goes on with the next number; the right to send each message is LEASED with a conditional update of the campaign row (so the old and the new process of a deploy never send inside each other's pause), a number is claimed (pending -> sending) before it is sent, and one that was in
  flight when a process died is marked failed ("unknown"), never sent again on its own. Per sender number only its oldest running campaign sends (different numbers run side by side). It protects each number: a daily limit across all campaigns of that sender (Turkey day, then
  09:00 next morning), pause when WhatsApp is not linked / restricted (409/403), retry a minute later when the connection did not come up (503, paused after 5), pause after 5 failed sends in a row, a number without a WhatsApp account (422) only fails that number.
  Bulk sends pass `{ bulk: true }`: they are not stopped by the engine's 120/hour valve (the pace is the campaign's own). Creating a campaign sends NOTHING (draft + preview of the finished
  messages); starting is refused unless its sender number is linked. Tests: `whatsappBulkCsv`, `whatsappBulkRunner` (unit, in-memory database + fake WhatsApp + moved clock), smoke `whatsappbulk`, e2e `whatsapp-bulk` (never starts a campaign on a linked deployment).
* **Order profit panel** (`/orders` tab "Kârlılık", `services/orderProfit.js`, `orderCosts.js`, `orderFinanceSync.js`): Trendyol sales with list price,
  discounted price, what the customer paid, commission, platform fee, shipping, our cost and profit. Same profit method as the price template
  (VAT-exclusive revenue minus charged amounts). Commission and shipping are Trendyol's REAL figures once read from the current account statement
  (`settlements` Sale rows MINUS the Discount/Coupon rows, which give commission back: the real commission is charged on the price after discounts) and the cargo invoices (`otherfinancials` DeductionInvoices -> `cargo-invoice/{id}/items`), matched by order number into
  `OrderFinance` (button on the tab + a daily cron); until then they are estimates (line commission rate, average known shipping) and shown with `~`.
  **Tax model (2026-11-12, same as the price template's tax options, `services/taxMath.js`):** the page's default is VAT payer + 1% stopaj (settings `inputVat`, `purchaseVatRate`, `withholdingPct` in
  `order_profit:<storeId>`; without them `computeOrderProfit` keeps the earlier no-VAT-credit method). profit = discounted sale - commission - platform fee - supplier fee - shipping - purchase cost - stopaj
  (1% of the VAT-exclusive sale) - VAT to pay (sale VAT minus the VAT inside purchase cost, shipping, commission and platform fee). Trendyol's commission, the cargo invoice amount and the platform fee are
  all VAT-INCLUSIVE as charged (verified on real data); the cargo invoice only exists ~3 weeks after the order and the finance API has no earlier per-order shipping figure (the seller panel's "Finans > Sipariş Kayıtları" shows one that is not in the public API), so an order's shipping can be typed in by hand (`PUT /orders/profit/cargo`, SystemSettings `order_cargo:<storeId>`), used until the invoice figure arrives; purchase costs are assumed VAT-inclusive. The other cost is VAT-inclusive like in the template, so its VAT comes off the VAT to pay too. VAT to pay is only computed when the profit is known.
  The platform fee ("Platform Hizmet Bedeli") only exists as a periodic invoice, so it is a setting (default 13.19). The purchase cost is saved on the order
  (`Order.lineCosts`) when it arrives; costs typed on the panel live in SystemSettings `order_cost:<storeId>`. Never invent a profit when a cost is unknown.
  A supplier's service fee per product after an order is placed (and any other per-unit cost) is the price template's **"Diğer gider"** (`packagingCost` + `extraCost`): it is built into the sale price AND taken off the order profit (`PricingContext.otherCostFor(product)` finds the template that prices the sold product, `orderCosts.otherCostMapFor`). The amount at the time is saved on the order (`Order.lineFees`, positive amounts only; without one the template's current value is used); products the store does not carry (barcode not found) have no template, so they get no other cost. `XmlSource.orderServiceFee` is a dead legacy column (the per-source field was removed from the XML screen and the API ignores it). (`GlobalXmlProvider.orderFee` is a different thing: the per-order fee of dropship supplier orders.)
* **Product-level categories** (`ProductCategoryOverride`, `services/productCategories.js`, `categoryMatcher.js`, `categoryAiPicker.js`; tab "Ürün bazlı kategori" of the category mapping page `/category-mapping?tab=products`, `/product-categories` redirects there; "Kategorileri sıfırla" on that page deletes them per XML source via `POST .../product-categories/reset`, XML-category mappings only when asked): a Trendyol category chosen for ONE
  product, because XML categories are often too broad to map as a whole ("Ev ve Yaşam", 800 kinds of products). It wins over the category mapping and is applied INSIDE
  `ReadinessContext.resolveMapping`, so the list, readiness and both send routes use the same answer; never look categories up anywhere else (the old `resolveCatMapping` helpers
  in `marketplace.js` are no longer used for sending). Required Trendyol attributes belong to the category: typed once per category, reused from other products of that
  category or from a category mapping. Free: rule-based suggestions (word matching over the bundled tree, NOT reliable on its own) and a manual picker. Paid (credit setting
  `credit_product_category_ai`, per product, default 0.05): the AI only chooses among the rule-based candidates, answers are validated against them, only products with a result
  are charged (the rest is refunded), a fatal AI error (empty vendor balance, rejected key) stops at once with a readable message (`aiErrors.js`).
  **Default answers for required attributes** (`services/attributeDefaults.js`, stored in `connection.config.attributeDefaults`, panel "Varsayılan cevaplar"): rules by attribute name
  ("Menşei" -> TR, "Renk, Web Color" -> Çok Renkli; comma = aliases, `|` = alternative values tried in order) plus one answer for all other required attributes. They are written into
  the products' attributes with `auto: true` (refreshed when rules change; hand-typed values and values of a category mapping are never touched) and only when Trendyol accepts the
  value (it is in the attribute's value list, or the attribute allows free text); the rest stays empty and is listed with Trendyol's example values. Applied on saving the rules and
  after every assignment (best effort). The attribute lookup + 6 h cache is shared with the readiness check (`loadRequiredDefs`).
  **Open required attributes read per product** (`services/attributeFromText.js`, `productAttributes.js`, `attributeAiPicker.js`; card "Eksik zorunlu özellikleri ürün başlığı ve açıklamasından otomatik seç" in the attribute panel): the attributes
  that are STILL empty after the default answers are filled per product from its own title and description. Free step (`POST .../attributes-from-text`, also runs by itself for products that were just assigned a category, in `fillAfterSave`): the
  attribute's allowed values are searched in the text; careful on purpose (a wrong value gets the product rejected): codes/letters ("VE") and values with signs ("6+ Yaş") never match, values with numbers need the attribute's own name next to them and
  never come from ranges/dimensions ("3-6 yaş", "2x38 cm"), seller-side attributes (Menşei, Marka) are never read, several different values in the title = ambiguous = nothing. Paid step (`GET .../attribute-gaps` for the ids, `POST .../attributes-ai`,
  parts of 40, credit `credit_product_attribute_ai` default 0.1 per product that got a value, rest refunded, fatal vendor error stops at once): the AI chooses ONLY among the allowed values and answers null when the text does not say. Values live in the
  product's OWN attribute JSON with `from: 'title' | 'description' | 'ai'` and NO `auto` flag: `buildOverrideMappings` never shares a `from` entry with the other products of the category (`shareableJson`), the default-answers refresh and the
  category-wide `PUT .../attributes` never overwrite one, and changing a product's category drops them. A default answer is only replaced (box "Varsayılan cevaplarla doldurulanları da güncelle") by a value read from the TITLE, never from the description (measured: description-only picks were sometimes wrong, e.g. "Kompakt" for a "Likit Fondöten"). Measured on the owner's data: the free step fills only ~6% of the open slots (most are questions the text does not answer: Basım Dili, Pil ile mi
  çalışır?, Kapasite ...), so the AI step is where most of the value is. Product-specific values do NOT belong in the default answers (the owner had "Derinlik 114 cm", "Hacim 6500 ml" there: written to every product of the category).
  **Free suggestions for XML categories** (tab "Kategori eşleştirme", card "Önerilen eşleştirmeler", `GET .../product-categories/category-suggestions?xmlSourceId=`, `services/xmlCategorySuggestions.js`): each XML category is judged by up to 30 of its product
  titles spread over the whole category (same word matcher as the product tab, plus the category name), counted per Trendyol leaf. `share` = titles with that leaf in their top 3; `mixed` = the biggest Trendyol FAMILY (parent category) holds < 40%
  of the titles' best answers (so "Çelik Kolye"/"Zirkon Kolye" is NOT mixed, "Ev ve Yaşam" is); a non-mixed category drops answers from another top-level category (brass "pirinç" vs rice); `weak` = fewer than 5 products.
  Nothing is saved from it: a click only fills the mapping form, the user still fills the required attributes and saves. Measured on the owner's feeds: biii 0 of 16 categories mixed, TahtaKale 38 of 79.
* **User guide** (`/guide`, `client/src/pages/guide/`): the content is DATA (`content/*.js`: sections -> topics -> blocks), rendered by `GuidePage.jsx` with a table of contents, search
  (`guideText.js`, Turkish-folded) and live boxes (`LiveBoxes.jsx`: plans from `/public/pricing-plans`, credit prices from `/credits/prices`, the "not ready" table built from the product list's
  `ISSUE_LABELS` + `issueHelp.js`). Inline markup: `**bold**`, `[[Screen name]]`, `{{/route|text}}`, `{{#topic-id|text}}`. `npm run test:smoke` (guide) FAILS when a `[[name]]` is not found anywhere in
  the app's source, a `{{/route}}` is not a route in App.jsx, a jump target is missing, or a new readiness reason has no explanation: when you rename a button or add a feature, update the guide
  (and `GUIDE_UPDATED` in `content/index.js`).
* **XML converter** (`/xml-converter`, `routes/xmlConverter.js`): a LIVE proxy, nothing of the converted XML is stored; every pull of the signed proxy address (an XML source's sync, or the download button) reads the supplier and converts on the spot
  (`streamConverted`). So "when was it last updated" is a note written after each production: table `XmlConverterFeed` (one row per supplier address, found by the SHA-256 of the normalised address, no address stored; `services/xml/converterFeeds.js`):
  `servedAt/servedOk/servedError/productCount` from the proxy and download, `convertedAt` from "Dönüştür", `sourceModifiedAt` = the supplier's `Last-Modified` header (via `streamProductObjects`' `onHeaders`; not every supplier sends one, e.g. biii does not,
  TahtaKale's does). A failed pull or an empty feed is marked failed and keeps the last good product count. Writing the note never breaks the XML (best effort, after the response ended). The page reads it with `POST /xml-converter/feeds/status {urls}` (free, only the addresses sent are looked up).
* **Field mapping**: `xml/autoMapping.js` guesses the mapping for new feeds; the user's saved mapping always wins. The field list of the mapping screen is
  MERGED over many products (`createFieldCollector` in `xmlParser.js`), never taken from the first product: products of one feed carry different tags
  (2 images on the first, 5 on the others).
* **Tenant isolation**: every route that takes an `:id` must verify the record belongs to the caller's store
  (`middleware/ownership.js` → `router.param`). Never look records up by `id` alone.
* **Auth**: httpOnly cookie session (`utils/sessionCookie.js`, `middleware/auth.js`); never store the JWT in browser storage or URLs.
  Cookie-authenticated unsafe requests need the `X-Requested-With` header (CSRF guard). Bearer tokens remain valid for scripts.
* Marketplace credentials are encrypted at rest by a Prisma client extension (`config/database.js`); responses never include them.
* The original feed values stay in `Product.rawXmlData` (used to detect what changed on the next sync).
* Free-tier hosting: the API sleeps without traffic; cron jobs only run while awake (see DEPLOY_RENDER.md).
