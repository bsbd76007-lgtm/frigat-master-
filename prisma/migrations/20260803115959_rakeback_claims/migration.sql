-- CreateTable
CREATE TABLE "RakebackClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RakebackClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RakebackClaim_userId_createdAt_idx" ON "RakebackClaim"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "RakebackClaim" ADD CONSTRAINT "RakebackClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
