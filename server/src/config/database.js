const { PrismaClient } = require('@prisma/client');
const { encrypt, decrypt } = require('../utils/secretBox');

const base = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

const SECRET_FIELDS = ['apiKey', 'apiSecret'];

function encryptData(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const f of SECRET_FIELDS) {
    const v = out[f];
    if (typeof v === 'string') out[f] = encrypt(v);
    else if (v && typeof v === 'object' && typeof v.set === 'string') out[f] = { ...v, set: encrypt(v.set) };
  }
  return out;
}

// Marketplace credentials are encrypted at rest (AES-256-GCM) and decrypted
// transparently on read, including when the connection is loaded through a relation.
const prisma = base.$extends({
  query: {
    marketplaceConnection: {
      create: ({ args, query }) => query({ ...args, data: encryptData(args.data) }),
      createMany: ({ args, query }) => query({ ...args, data: Array.isArray(args.data) ? args.data.map(encryptData) : encryptData(args.data) }),
      update: ({ args, query }) => query({ ...args, data: encryptData(args.data) }),
      updateMany: ({ args, query }) => query({ ...args, data: encryptData(args.data) }),
      upsert: ({ args, query }) => query({ ...args, create: encryptData(args.create), update: encryptData(args.update) }),
    },
  },
  result: {
    marketplaceConnection: {
      apiKey: { needs: { apiKey: true }, compute: (c) => decrypt(c.apiKey) },
      apiSecret: { needs: { apiSecret: true }, compute: (c) => decrypt(c.apiSecret) },
    },
  },
});

module.exports = prisma;
