-- AlterTable: make AutoReplyRule.storeId nullable for global rules
ALTER TABLE "AutoReplyRule" ALTER COLUMN "storeId" DROP NOT NULL;
