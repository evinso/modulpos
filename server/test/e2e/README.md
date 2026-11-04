# End-to-end tests

These run against a **live deployment** (default `https://api.modulpos.com/api`) and the real database. Each test registers
temporary users (`tmp-…@example.invalid`), exercises the API, and deletes everything it created.

```bash
cd server
E2E_DB_URL="postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres" node test/e2e/<suite>.e2e.js
```

* `tenant-pricing-readiness` – data isolation between stores, XML source options, pricing templates, the server-side
  readiness list, send-time validation, rejected products.
* `xml-scoped-mapping` – category mappings belong to one XML source and disappear with it; earnings summary of the price template.
* `session-cookie` – cookie flags, CSRF header, CORS preflight, SSE, logout.
* `hardening` – VAT 0, manual prices, duplicate barcodes, DB sync guard, signed proxy.
* `generic-feeds` – three structurally different feeds (`test/fixtures`) imported with no manual mapping.

Keep runs short: the API limits each client to 1000 requests / 15 minutes (login/register: 20).
Unit tests (no network, no database): `npm test`.
