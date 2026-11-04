/**
 * One-off: category mappings used to be shared by every XML source of a connection. They now belong to one source.
 * For every legacy mapping (xmlSourceId = null):
 *   - find the XML sources of the store that actually have products in that category;
 *   - attach the mapping to the first one and copy it for the others;
 *   - if no source has such products any more (the XML was deleted), the mapping is stale and is removed.
 *
 *   node scripts/migrateCategoryMappings.js          # dry run
 *   node scripts/migrateCategoryMappings.js --apply
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

const leaf = (c) => String(c).split('|').map((x) => x.trim()).filter(Boolean).pop() || '';
const matches = (mappingKey, productCategory) => {
  const k = String(mappingKey).trim().toLowerCase();
  const p = String(productCategory || '').trim().toLowerCase();
  if (!p) return false;
  return p === k || leaf(p).toLowerCase() === leaf(k).toLowerCase() || p.split('|').map((x) => x.trim().toLowerCase()).includes(k);
};

(async () => {
  const legacy = await prisma.categoryMapping.findMany({ where: { xmlSourceId: null }, include: { connection: { select: { storeId: true } } } });
  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${legacy.length} legacy mapping(s)`);
  for (const m of legacy) {
    const sources = await prisma.xmlSource.findMany({ where: { storeId: m.connection.storeId, globalProviderId: null }, select: { id: true, name: true } });
    const owners = [];
    for (const s of sources) {
      const cats = await prisma.product.findMany({ where: { xmlSourceId: s.id }, select: { category: true }, distinct: ['category'] });
      if (cats.some((c) => matches(m.localCategory, c.category))) owners.push(s);
    }
    if (owners.length === 0) {
      console.log(`  "${m.localCategory}": no source has such products -> remove (stale)`);
      if (apply) await prisma.categoryMapping.delete({ where: { id: m.id } });
      continue;
    }
    console.log(`  "${m.localCategory}": -> ${owners.map((o) => o.name).join(', ')}`);
    if (!apply) continue;
    await prisma.categoryMapping.update({ where: { id: m.id }, data: { xmlSourceId: owners[0].id } });
    for (const o of owners.slice(1)) {
      await prisma.categoryMapping.create({ data: { connectionId: m.connectionId, xmlSourceId: o.id, localCategory: m.localCategory, marketplaceCategoryId: m.marketplaceCategoryId, marketplaceCategoryName: m.marketplaceCategoryName, attributes: m.attributes } });
    }
  }
})().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
