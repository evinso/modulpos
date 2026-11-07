/**
 * Re-encrypts stored marketplace credentials with a new key.
 *
 *   1. Generate a key:        openssl rand -hex 32
 *   2. Set on the server:     ENCRYPTION_KEY_PREVIOUS=<old key>   ENCRYPTION_KEY=<new key>   (deploy)
 *   3. Run once (same env):   node scripts/rotateEncryptionKey.js
 *   4. Remove ENCRYPTION_KEY_PREVIOUS from the server.
 *
 * Safe to re-run: values already encrypted with the new key are simply re-written.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { encrypt, decrypt } = require('../src/utils/secretBox');

const raw = new PrismaClient(); // plain client: reads/writes the stored (encrypted) values as-is

(async () => {
  if (!process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY (new key) is required');
  const rows = await raw.marketplaceConnection.findMany({ select: { id: true, apiKey: true, apiSecret: true } });
  let n = 0;
  for (const r of rows) {
    const data = {};
    if (r.apiKey) data.apiKey = encrypt(decrypt(r.apiKey));
    if (r.apiSecret) data.apiSecret = encrypt(decrypt(r.apiSecret));
    await raw.marketplaceConnection.update({ where: { id: r.id }, data });
    n++;
  }
  console.log(`Re-encrypted ${n} connection(s).`);
  // the built-in WhatsApp connection's login (a value that cannot be read any more simply means "link the phone again")
  const wrows = await raw.whatsappAuthState.findMany();
  let w = 0;
  for (const r of wrows) {
    let plain;
    try { plain = decrypt(r.value); } catch { continue; }
    await raw.whatsappAuthState.update({ where: { key: r.key }, data: { value: encrypt(plain) } });
    w++;
  }
  console.log(`Re-encrypted ${w} WhatsApp login item(s).`);
})().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => raw.$disconnect());
