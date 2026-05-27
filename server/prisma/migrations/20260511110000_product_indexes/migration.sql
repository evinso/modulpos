-- Add missing indexes on Product table for common query patterns
CREATE INDEX IF NOT EXISTS "Product_storeId_xmlSourceId_idx" ON "Product"("storeId", "xmlSourceId");
CREATE INDEX IF NOT EXISTS "Product_storeId_category_idx" ON "Product"("storeId", "category");
CREATE INDEX IF NOT EXISTS "Product_xmlSourceId_idx" ON "Product"("xmlSourceId");
