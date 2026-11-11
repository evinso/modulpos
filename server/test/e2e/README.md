# End-to-end tests

These run against a **live deployment** (default `https://api.modulpos.com/api`) and the real database. Each test registers
temporary users (`tmp-…@example.invalid`), exercises the API, and deletes everything it created.

```bash
cd server
E2E_DB_URL="postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres" node test/e2e/<suite>.e2e.js
```

* `tenant-pricing-readiness` – data isolation between stores, per-connection send settings, pricing templates, the server-side
  readiness list, send-time validation, rejected products.
* `manual-price` – a sale price typed in by hand for one product and marketplace: preview, loss confirmation, list/readiness/detail honour it, back to template, isolation.
* `feed-changes` – products that leave the XML get stock 0 and return with it, a broken/cut-off feed is never acted on, loss alert for hand-priced products after a purchase price rise, giving hand-typed prices back to the template (fixtures `feed-stock-*.xml` must be pushed first).
* `already-listed` – products the marketplace says exist (“same barcode already exists”) are treated as listed: skipped by the send routes, healed to active by the status update.
* `pricing-tiers` – shipping / profit tier tables in price templates: calculator, validation, storage, isolation, real product price.
* `xml-scoped-mapping` – category mappings belong to one XML source and disappear with it; earnings summary of the price template.
* `products-page` – the products screen API: summary, facets, filters, sorting, paging, per-marketplace pricing, detail panel, editing rules.
* `orders-profit` – profit panel of the orders page: real vs estimated commission / shipping, cost snapshot and typed costs, cancelled orders left out, estimate settings, filters, isolation.
* `session-cookie` – cookie flags, CSRF header, CORS preflight, SSE, logout.
* `hardening` – VAT 0, manual prices, duplicate barcodes, DB sync guard, signed proxy.
* `whatsapp-access` – a normal user cannot reach any WhatsApp / settings endpoint (403) and changes nothing; an admin gets readable reasons; with the built-in connection it opens a real connection to WhatsApp up to the QR code and closes it again (skipped when a phone is linked). Never sends a message.
* `product-categories` – a Trendyol category chosen per product: free suggestions, bulk step, priority over the XML-category mapping, readiness, isolation, attributes per category, the paid AI step (credits refunded when the vendor fails), default answers for required attributes, reset per XML source, removal.
* `xml-varied-images` – a feed whose first product has 2 images and later ones 5: the mapping list offers every image tag, the suggestion and a no-mapping sync keep them all (fixture `feed-images-varied.xml` must be pushed first).
* `generic-feeds` – three structurally different feeds (`test/fixtures`) imported with no manual mapping.

Keep runs short: the API limits each client to 1000 requests / 15 minutes (login/register: 20).
Unit tests (no network, no database): `npm test`.
