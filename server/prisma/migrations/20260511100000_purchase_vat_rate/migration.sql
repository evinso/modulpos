-- Add purchaseVatRate to XmlSource and GlobalXmlProvider
ALTER TABLE "XmlSource" ADD COLUMN IF NOT EXISTS "purchaseVatRate" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GlobalXmlProvider" ADD COLUMN IF NOT EXISTS "purchaseVatRate" INTEGER NOT NULL DEFAULT 0;
