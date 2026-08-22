-- Add new fields to DropshipOrder
ALTER TABLE "DropshipOrder" ADD COLUMN IF NOT EXISTS "productId"    TEXT;
ALTER TABLE "DropshipOrder" ADD COLUMN IF NOT EXISTS "campaignCode" TEXT;
ALTER TABLE "DropshipOrder" ADD COLUMN IF NOT EXISTS "creditAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Add relation index
CREATE INDEX IF NOT EXISTS "DropshipOrder_productId_idx" ON "DropshipOrder"("productId");

-- AddForeignKey
ALTER TABLE "DropshipOrder" ADD CONSTRAINT "DropshipOrder_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
