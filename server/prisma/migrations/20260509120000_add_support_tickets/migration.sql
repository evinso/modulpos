-- CreateTable
CREATE TABLE "SupportTicket" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "subject"   TEXT NOT NULL,
    "category"  TEXT NOT NULL DEFAULT 'general',
    "priority"  TEXT NOT NULL DEFAULT 'normal',
    "status"    TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id"         TEXT NOT NULL,
    "ticketId"   TEXT NOT NULL,
    "isAdmin"    BOOLEAN NOT NULL DEFAULT false,
    "senderName" TEXT NOT NULL,
    "message"    TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportTicket_userId_idx" ON "SupportTicket"("userId");
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");
CREATE INDEX "SupportMessage_ticketId_idx" ON "SupportMessage"("ticketId");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
