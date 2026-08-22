-- CreateTable
CREATE TABLE "BuyboxRecord" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "productId" TEXT,
    "barcode" TEXT NOT NULL,
    "buyboxOrder" INTEGER,
    "buyboxPrice" DOUBLE PRECISION,
    "hasMultipleSeller" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyboxRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuyboxRecord_connectionId_idx" ON "BuyboxRecord"("connectionId");

-- CreateIndex
CREATE INDEX "BuyboxRecord_connectionId_checkedAt_idx" ON "BuyboxRecord"("connectionId", "checkedAt");

-- CreateIndex
CREATE INDEX "BuyboxRecord_barcode_idx" ON "BuyboxRecord"("barcode");

-- AddForeignKey
ALTER TABLE "BuyboxRecord" ADD CONSTRAINT "BuyboxRecord_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MarketplaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyboxRecord" ADD CONSTRAINT "BuyboxRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
