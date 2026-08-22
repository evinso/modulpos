CREATE TABLE "PaytrLog" (
    "id"          TEXT NOT NULL,
    "merchantOid" TEXT NOT NULL,
    "status"      TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "userId"      TEXT,
    "userEmail"   TEXT,
    "type"        TEXT,
    "failReason"  TEXT,
    "rawBody"     TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaytrLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaytrLog_status_idx" ON "PaytrLog"("status");
CREATE INDEX "PaytrLog_createdAt_idx" ON "PaytrLog"("createdAt");
