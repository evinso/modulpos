CREATE TABLE "WebhookEvent" (
    "id"           TEXT NOT NULL,
    "storeId"      TEXT,
    "connectionId" TEXT,
    "sellerId"     TEXT,
    "eventType"    TEXT NOT NULL,
    "payload"      TEXT NOT NULL,
    "processed"    BOOLEAN NOT NULL DEFAULT false,
    "error"        TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookEvent_storeId_idx"    ON "WebhookEvent"("storeId");
CREATE INDEX "WebhookEvent_eventType_idx"  ON "WebhookEvent"("eventType");
CREATE INDEX "WebhookEvent_createdAt_idx"  ON "WebhookEvent"("createdAt");
