-- CreateTable
CREATE TABLE "DropshipOrder" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "storeId"         TEXT NOT NULL,
    "orderRef"        TEXT,
    "productName"     TEXT NOT NULL,
    "productCode"     TEXT,
    "supplierName"    TEXT,
    "quantity"        INTEGER NOT NULL DEFAULT 1,
    "unitPrice"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "customerName"    TEXT,
    "customerPhone"   TEXT,
    "shippingAddress" TEXT,
    "status"          TEXT NOT NULL DEFAULT 'pending',
    "supplierOrderId" TEXT,
    "trackingNumber"  TEXT,
    "cargoCompany"    TEXT,
    "notes"           TEXT,
    "orderedAt"       TIMESTAMP(3),
    "shippedAt"       TIMESTAMP(3),
    "deliveredAt"     TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DropshipOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DropshipOrder_userId_idx" ON "DropshipOrder"("userId");
CREATE INDEX "DropshipOrder_storeId_idx" ON "DropshipOrder"("storeId");
CREATE INDEX "DropshipOrder_status_idx" ON "DropshipOrder"("status");

-- AddForeignKey
ALTER TABLE "DropshipOrder" ADD CONSTRAINT "DropshipOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DropshipOrder" ADD CONSTRAINT "DropshipOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
