-- AlterTable
ALTER TABLE "OtpCode" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'LOGIN';

