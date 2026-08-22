require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rules = await prisma.pricingRule.findMany();
  console.log("Rules:", rules);
  const stores = await prisma.store.findMany();
  console.log("Stores:", stores);
}

main().catch(console.error).finally(() => prisma.$disconnect());
