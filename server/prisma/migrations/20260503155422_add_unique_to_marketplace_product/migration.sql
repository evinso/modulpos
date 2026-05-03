-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceProduct_productId_connectionId_key" ON "MarketplaceProduct"("productId", "connectionId");
