-- CreateTable: UserSession (deviceId added later by 20260525000000)
CREATE TABLE IF NOT EXISTS "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "loginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AuditLog
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Notification
CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'info',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable: GlobalXmlProvider (productCount, cargoCompanies, purchaseVatRate added by later migrations)
CREATE TABLE IF NOT EXISTS "GlobalXmlProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'xml',
    "mappingConfig" TEXT,
    "categoryMappingConfig" TEXT,
    "description" TEXT,
    "logo" TEXT,
    "priceMarkup" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceMarkupPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "barcodePrefix" TEXT,
    "creditCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceMarkupPctByPlan" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GlobalXmlProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CreditBalance
CREATE TABLE IF NOT EXISTS "CreditBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CreditTransaction
CREATE TABLE IF NOT EXISTS "CreditTransaction" (
    "id" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SystemSettings
CREATE TABLE IF NOT EXISTS "SystemSettings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LandingPricingPlan (yearlyPrice, maxProducts, maxXmlSources added by 20260510120000)
CREATE TABLE IF NOT EXISTS "LandingPricingPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "features" TEXT NOT NULL,
    "ctaText" TEXT NOT NULL DEFAULT 'Hemen Başla',
    "isHighlighted" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LandingPricingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LandingFooterSection
CREATE TABLE IF NOT EXISTS "LandingFooterSection" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "links" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LandingFooterSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: CreditBalance unique userId
CREATE UNIQUE INDEX IF NOT EXISTS "CreditBalance_userId_key" ON "CreditBalance"("userId");

-- CreateIndex: SystemSettings unique key
CREATE UNIQUE INDEX IF NOT EXISTS "SystemSettings_key_key" ON "SystemSettings"("key");

-- AddForeignKey: UserSession -> User
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: AuditLog -> User
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Notification -> Store
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: CreditTransaction -> CreditBalance
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_balanceId_fkey"
    FOREIGN KEY ("balanceId") REFERENCES "CreditBalance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
