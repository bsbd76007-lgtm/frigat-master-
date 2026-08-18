-- AlterEnum
ALTER TYPE "TransactionStatus" ADD VALUE 'CANCELED';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'BONUS_CASHBACK';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "providerId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "currentStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastPlayedDate" TIMESTAMP(3),
ADD COLUMN     "longestStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "restorableStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "streakBrokenAt" TIMESTAMP(3),
ADD COLUMN     "streakRestoreCost" DECIMAL(18,8) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Transaction_providerId_idx" ON "Transaction"("providerId");
