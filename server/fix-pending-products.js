/**
 * One-time script: reconcile pending MarketplaceProduct records with Trendyol's actual state.
 * Run: node fix-pending-products.js
 */
const prisma = require('./src/config/database');
const TrendyolService = require('./src/services/trendyol/trendyolService');

async function main() {
  const connections = await prisma.marketplaceConnection.findMany({
    where: { marketplaceType: 'trendyol', status: 'active' },
    include: { store: { select: { id: true, name: true } } }
  });

  if (connections.length === 0) {
    console.log('Aktif Trendyol bağlantısı bulunamadı.');
    return;
  }

  console.log(`${connections.length} aktif Trendyol bağlantısı bulundu.\n`);

  let totalUpdated = 0;
  let totalNotFound = 0;

  for (const conn of connections) {
    console.log(`--- Bağlantı: ${conn.store.name} (${conn.id}) ---`);
    const service = new TrendyolService(conn);

    const pendingMPs = await prisma.marketplaceProduct.findMany({
      where: { connectionId: conn.id, status: 'pending' },
      include: { product: { select: { id: true, barcode: true, title: true } } }
    });

    console.log(`  Bekleyen ürün sayısı: ${pendingMPs.length}`);
    if (pendingMPs.length === 0) continue;

    const barcodes = pendingMPs.map(mp => mp.product.barcode).filter(Boolean);
    const barcodeToMP = {};
    for (const mp of pendingMPs) {
      if (mp.product.barcode) barcodeToMP[mp.product.barcode] = mp;
    }

    // Trendyol'dan barkod bazlı sorgula (100'lük batch'ler halinde)
    const BATCH = 100;
    const trendyolProductMap = {};

    for (let i = 0; i < barcodes.length; i += BATCH) {
      const batch = barcodes.slice(i, i + BATCH);
      try {
        const data = await service.getProducts(0, BATCH, undefined, batch);
        for (const item of (data.content || [])) {
          if (item.barcode) trendyolProductMap[item.barcode] = item;
        }
        console.log(`  Trendyol'dan ${Object.keys(trendyolProductMap).length} ürün çekildi`);
      } catch (e) {
        console.error(`  Trendyol sorgu hatası: ${e.message}`);
      }
    }

    let updated = 0;
    let notFound = 0;

    for (const mp of pendingMPs) {
      const barcode = mp.product.barcode;
      const tyProduct = barcode ? trendyolProductMap[barcode] : null;

      if (!tyProduct) {
        notFound++;
        console.log(`  BULUNAMADI: ${mp.product.title} (barcode: ${barcode})`);
        continue;
      }

      let newStatus = 'pending';
      if (tyProduct.approved === true) {
        newStatus = 'active';
      } else if (tyProduct.approved === false && tyProduct.rejected === true) {
        newStatus = 'rejected';
      }

      await prisma.marketplaceProduct.update({
        where: { id: mp.id },
        data: {
          status: newStatus,
          trendyolProductId: tyProduct.id ? String(tyProduct.id) : mp.trendyolProductId,
          lastSyncAt: new Date()
        }
      });

      console.log(`  GÜNCELLENDI: ${mp.product.title} → ${newStatus}`);
      updated++;
    }

    totalUpdated += updated;
    totalNotFound += notFound;
    console.log(`  Sonuç: ${updated} güncellendi, ${notFound} bulunamadı\n`);
  }

  console.log(`\n=== TOPLAM: ${totalUpdated} güncellendi, ${totalNotFound} Trendyol'da bulunamadı ===`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
