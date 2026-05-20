CREATE TABLE "ProductLog" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "oldPrice" DOUBLE PRECISION,
  "newPrice" DOUBLE PRECISION,
  "oldStock" INTEGER,
  "newStock" INTEGER,
  "notes" TEXT,
  "source" TEXT NOT NULL DEFAULT 'xml_sync',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductLog_productId_idx" ON "ProductLog"("productId");
CREATE INDEX "ProductLog_productId_createdAt_idx" ON "ProductLog"("productId", "createdAt");

ALTER TABLE "ProductLog" ADD CONSTRAINT "ProductLog_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
