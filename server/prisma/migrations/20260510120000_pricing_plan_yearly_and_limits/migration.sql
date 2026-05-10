-- Add yearlyPrice, maxProducts, maxXmlSources to LandingPricingPlan
-- Using IF NOT EXISTS so it's safe to run even if the columns were already added via ALTER TABLE in app.js

ALTER TABLE "LandingPricingPlan" ADD COLUMN IF NOT EXISTS "yearlyPrice" TEXT;
ALTER TABLE "LandingPricingPlan" ADD COLUMN IF NOT EXISTS "maxProducts" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "LandingPricingPlan" ADD COLUMN IF NOT EXISTS "maxXmlSources" INTEGER NOT NULL DEFAULT 1;
