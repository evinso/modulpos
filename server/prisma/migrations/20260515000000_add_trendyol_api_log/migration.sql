-- CreateTable
CREATE TABLE "TrendyolApiLog" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "method" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestBody" TEXT,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "durationMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendyolApiLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrendyolApiLog_connectionId_idx" ON "TrendyolApiLog"("connectionId");

-- CreateIndex
CREATE INDEX "TrendyolApiLog_createdAt_idx" ON "TrendyolApiLog"("createdAt");
