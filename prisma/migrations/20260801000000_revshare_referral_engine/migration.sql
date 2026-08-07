-- RevShare Referral Engine
--
-- Adds referral attribution + per-user rev-share cuts on User, an accrual
-- column on Wallet, and the AFFILIATE_REWARD ledger type.
--
-- referralCode is UNIQUE NOT NULL, so it is added nullable, backfilled for
-- pre-existing accounts, and only then constrained. Adding it NOT NULL in one
-- step (as a naive diff would) fails on any table that already has rows.

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'AFFILIATE_REWARD';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredById" TEXT,
ADD COLUMN     "revSharePercentage" DECIMAL(5,2) NOT NULL DEFAULT 25.00;

-- Backfill existing accounts. New rows get a cuid() from the Prisma client;
-- these only need to be unique and stable, so a uuid stands in.
UPDATE "User"
   SET "referralCode" = replace(gen_random_uuid()::text, '-', '')
 WHERE "referralCode" IS NULL;

ALTER TABLE "User" ALTER COLUMN "referralCode" SET NOT NULL;

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "affiliateBalance" DECIMAL(18,8) NOT NULL DEFAULT 0.00;

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_referredById_idx" ON "User"("referredById");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
