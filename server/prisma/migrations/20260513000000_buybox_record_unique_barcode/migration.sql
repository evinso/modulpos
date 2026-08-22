-- Remove duplicate BuyboxRecords — keep only the most recent per (connectionId, barcode)
DELETE FROM "BuyboxRecord"
WHERE id NOT IN (
  SELECT DISTINCT ON ("connectionId", "barcode") id
  FROM "BuyboxRecord"
  ORDER BY "connectionId", "barcode", "checkedAt" DESC
);

-- Add unique constraint
CREATE UNIQUE INDEX "BuyboxRecord_connectionId_barcode_key" ON "BuyboxRecord"("connectionId", "barcode");
