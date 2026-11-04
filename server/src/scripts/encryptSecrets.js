/**
 * One-off: encrypts legacy plaintext marketplace credentials in place.
 * Idempotent (already-encrypted values are skipped).
 *   ENCRYPTION_KEY=<64 hex> DATABASE_URL=... node src/scripts/encryptSecrets.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { encrypt, isEncrypted } = require('../utils/secretBox');

const raw = new PrismaClient(); // plain client: reads/writes the stored values as-is

(async () => {
  if (!/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY || '')) throw new Error('ENCRYPTION_KEY (64 hex chars) is required');
  const rows = await raw.marketplaceConnection.findMany({ select: { id: true, apiKey: true, apiSecret: true } });
  let changed = 0;
  for (const r of rows) {
    const data = {};
    if (r.apiKey && !isEncrypted(r.apiKey)) data.apiKey = encrypt(r.apiKey);
    if (r.apiSecret && !isEncrypted(r.apiSecret)) data.apiSecret = encrypt(r.apiSecret);
    if (Object.keys(data).length) {
      await raw.marketplaceConnection.update({ where: { id: r.id }, data });
      changed++;
    }
  }
  console.log(`Connections: ${rows.length}, newly encrypted: ${changed}`);
})().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => raw.$disconnect());
