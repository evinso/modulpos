-- CreateTable
CREATE TABLE "WhatsappConnection" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "apiToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsappConnection_storeId_idx" ON "WhatsappConnection"("storeId");

-- AddForeignKey
ALTER TABLE "WhatsappConnection" ADD CONSTRAINT "WhatsappConnection_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
