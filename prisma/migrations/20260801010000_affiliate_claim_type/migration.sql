-- Ledger type for an affiliate sweeping earnings into their wagerable balance.
-- Distinct from DEPOSIT because no money enters the platform: it is a transfer
-- between two columns of the same wallet.

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'AFFILIATE_CLAIM';
