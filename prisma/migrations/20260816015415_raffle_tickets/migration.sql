-- CreateEnum
CREATE TYPE "RaffleStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateTable
CREATE TABLE "Raffle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prizePool" TEXT NOT NULL,
    "prizeValue" DECIMAL(18,8),
    "ticketPrice" DECIMAL(18,8),
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "RaffleStatus" NOT NULL DEFAULT 'ACTIVE',
    "ticketCounter" INTEGER NOT NULL DEFAULT 0,
    "winningTicketNumber" INTEGER,
    "winnerUserId" TEXT,
    "drawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Raffle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaffleTicket" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticketNumber" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaffleTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaffleEntry" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wageredCredited" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "lastCheckInTicketAt" TIMESTAMP(3),

    CONSTRAINT "RaffleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Raffle_status_endsAt_idx" ON "Raffle"("status", "endsAt");

-- CreateIndex
CREATE INDEX "RaffleTicket_raffleId_createdAt_idx" ON "RaffleTicket"("raffleId", "createdAt");

-- CreateIndex
CREATE INDEX "RaffleTicket_raffleId_userId_idx" ON "RaffleTicket"("raffleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RaffleTicket_raffleId_ticketNumber_key" ON "RaffleTicket"("raffleId", "ticketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RaffleEntry_raffleId_userId_key" ON "RaffleEntry"("raffleId", "userId");

-- AddForeignKey
ALTER TABLE "RaffleTicket" ADD CONSTRAINT "RaffleTicket_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaffleTicket" ADD CONSTRAINT "RaffleTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaffleEntry" ADD CONSTRAINT "RaffleEntry_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaffleEntry" ADD CONSTRAINT "RaffleEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

