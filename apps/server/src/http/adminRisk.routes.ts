import type { FastifyInstance } from 'fastify';
import { Prisma, GameType, TransactionType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { requireAdmin } from './auth';
import { pushBalanceToUser } from '../websocket/socket.server';
import { auditWithin, isUnknownAdminError } from '../services/audit.service';
import {
  approveWithdrawal,
  rejectWithdrawal,
  WithdrawalStateError,
} from '../services/ledger.service';
import { readRiskConfig, writeRiskConfig } from '../services/riskConfig.service';

const DECIMAL = /^\d+(\.\d{1,8})?$/;
const GAME_TYPES = Object.values(GameType);

function clampTake(raw: unknown, fallback = 25): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 100);
}


/**
 * Finds a withdrawal from either identifier the admin surfaces expose.
 *
 * Returns the ledger row that holds the funds (the thing approve/reject act on)
 * alongside the Withdrawal row, so the caller can update both consistently.
 */
async function resolveWithdrawal(id: string): Promise<{
  withdrawalId: string | null;
  transactionId: string;
  userId: string | null;
} | null> {
  const byWithdrawal = await prisma.withdrawal.findUnique({
    where: { id },
    select: { id: true, transactionId: true, userId: true },
  });
  if (byWithdrawal) {
    return {
      withdrawalId: byWithdrawal.id,
      transactionId: byWithdrawal.transactionId,
      userId: byWithdrawal.userId,
    };
  }

  const byTransaction = await prisma.transaction.findFirst({
    where: { id, type: TransactionType.WITHDRAWAL },
    select: { id: true, wallet: { select: { userId: true } } },
  });
  if (!byTransaction) return null;

  const linked = await prisma.withdrawal.findUnique({
    where: { transactionId: byTransaction.id },
    select: { id: true },
  });
  return {
    withdrawalId: linked?.id ?? null,
    transactionId: byTransaction.id,
    userId: byTransaction.wallet.userId,
  };
}

/** Mirrors the ledger decision onto the gateway-facing row. */
async function markWithdrawal(
  withdrawalId: string | null,
  status: 'CONFIRMED' | 'CANCELLED'
): Promise<void> {
  if (!withdrawalId) return;
  await prisma.withdrawal.update({ where: { id: withdrawalId }, data: { status } });
}

export function registerAdminRiskRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { status?: string; take?: string; skip?: string } }>(
    '/api/admin/withdrawals',
    { preHandler: requireAdmin },
    async (req) => {
      const take = clampTake(req.query.take);
      const skip = Math.max(0, Number(req.query.skip) || 0);
      const status =
        req.query.status === 'COMPLETED' || req.query.status === 'FAILED'
          ? req.query.status
          : 'PENDING';

      const where: Prisma.TransactionWhereInput = {
        type: TransactionType.WITHDRAWAL,
        status,
      };

      const [rows, total, pendingTotal] = await Promise.all([
        prisma.transaction.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          take,
          skip,
          select: {
            id: true,
            amount: true,
            status: true,
            createdAt: true,
            wallet: {
              select: {
                currency: true,
                balance: true,
                user: { select: { id: true, email: true, frozen: true } },
              },
            },
          },
        }),
        prisma.transaction.count({ where }),
        prisma.transaction.aggregate({
          where: { type: TransactionType.WITHDRAWAL, status: 'PENDING' },
          _sum: { amount: true },
          _count: { _all: true },
        }),
      ]);

      // The payout destination lives on `Withdrawal`, not on the ledger row —
      // they are joined by `Withdrawal.transactionId`. Without this the queue
      // showed who and how much but not *where to*, which is the one field an
      // approver actually has to check before releasing funds.
      const destinations = await prisma.withdrawal.findMany({
        where: { transactionId: { in: rows.map((t) => t.id) } },
        select: { transactionId: true, address: true, network: true, provider: true },
      });
      const destinationByTx = new Map(destinations.map((d) => [d.transactionId, d]));

      return {
        total,
        take,
        skip,
        status,
        pendingCount: pendingTotal._count._all,
        pendingAmount: (pendingTotal._sum.amount ?? new Prisma.Decimal(0)).toFixed(8),
        withdrawals: rows.map((t) => ({
          id: t.id,
          amount: t.amount.toFixed(8),
          status: t.status,
          createdAt: t.createdAt.toISOString(),
          currency: t.wallet.currency,
          userId: t.wallet.user.id,
          userEmail: t.wallet.user.email,
          userFrozen: t.wallet.user.frozen,
          walletBalance: t.wallet.balance.toFixed(8),
          address: destinationByTx.get(t.id)?.address ?? null,
          network: destinationByTx.get(t.id)?.network ?? null,
          provider: destinationByTx.get(t.id)?.provider ?? null,
        })),
      };
    }
  );

  /**
   * Explicit approve / reject verbs.
   *
   * `:id` accepts either the Withdrawal id or the id of the PENDING ledger row
   * holding the funds — the admin list serves the latter, while a support agent
   * looking at a player's history has the former, and making them care which is
   * a papercut with no upside.
   *
   * Both delegate to the same audited ledger functions as the combined endpoint
   * below: approve settles the hold, reject refunds it inside one transaction.
   */
  for (const verb of ['approve', 'reject'] as const) {
    app.post<{ Params: { id: string }; Body: { reason?: string } }>(
      `/api/admin/withdrawals/:id/${verb}`,
      { preHandler: requireAdmin },
      async (req, reply) => {
        const adminId = req.identity!.userId;
        const reason = req.body?.reason;

        if (verb === 'reject' && (typeof reason !== 'string' || reason.trim().length < 3)) {
          return reply.code(400).send({ error: 'reason is required when rejecting' });
        }

        const resolved = await resolveWithdrawal(req.params.id);
        if (!resolved) return reply.code(404).send({ error: 'withdrawal_not_found' });

        const audit =
          (tx: Prisma.TransactionClient, extra: Record<string, unknown>) =>
            auditWithin(tx, {
              adminId,
              action: verb === 'approve' ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED',
              targetUserId: (extra.targetUserId as string) ?? null,
              details: { reason: reason?.trim() ?? null, ...extra },
            });

        try {
          if (verb === 'approve') {
            const settled = await approveWithdrawal({
              transactionId: resolved.transactionId,
              auditWithin: audit,
            });
            await markWithdrawal(resolved.withdrawalId, 'CONFIRMED');
            // Spread first: the ledger's own `status` is the ledger's word for it
            // ('COMPLETED'), and the API contract is the same word, but the order
            // must be explicit rather than accidental.
            return { ...settled, success: true, status: 'COMPLETED' as const };
          }

          const refunded = await rejectWithdrawal({
            transactionId: resolved.transactionId,
            auditWithin: audit,
          });
          await markWithdrawal(resolved.withdrawalId, 'CANCELLED');
          // The refund landed; tell the player's open tabs about it.
          if (resolved.userId) pushBalanceToUser(resolved.userId, refunded.balance);
          return { ...refunded, success: true, status: 'REJECTED' as const };
        } catch (err) {
          if (err instanceof WithdrawalStateError) {
            return reply.code(409).send({ error: 'not_pending', detail: err.message });
          }
          if (isUnknownAdminError(err)) {
            return reply.code(409).send({
              error: 'unknown_admin',
              detail: 'Acting admin id does not exist; nothing was changed.',
            });
          }
          throw err;
        }
      }
    );
  }

  app.post<{ Params: { id: string }; Body: { action?: string; reason?: string } }>(
    '/api/admin/withdrawals/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { action, reason } = req.body ?? {};
      const adminId = req.identity!.userId;

      if (action !== 'APPROVE' && action !== 'REJECT') {
        return reply.code(400).send({ error: 'action must be APPROVE or REJECT' });
      }
      if (action === 'REJECT' && (typeof reason !== 'string' || reason.trim().length < 3)) {
        return reply.code(400).send({ error: 'reason is required when rejecting' });
      }

      const audit =
        (details: Record<string, unknown>) =>
        (tx: Prisma.TransactionClient, extra: Record<string, unknown>) =>
          auditWithin(tx, {
            adminId,
            action:
              action === 'APPROVE' ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED',
            targetUserId: (extra.targetUserId as string) ?? null,
            details: { ...details, ...extra },
          });

      try {
        if (action === 'APPROVE') {
          return await approveWithdrawal({
            transactionId: req.params.id,
            auditWithin: audit({ reason: reason?.trim() ?? null }),
          });
        }
        return await rejectWithdrawal({
          transactionId: req.params.id,
          auditWithin: audit({ reason: reason!.trim() }),
        });
      } catch (err) {
        if (err instanceof WithdrawalStateError) {
          // Already handled by someone else, or never pending.
          return reply.code(409).send({ error: 'not_pending', detail: err.message });
        }
        if (isUnknownAdminError(err)) {
          return reply.code(409).send({
            error: 'unknown_admin',
            detail: 'Acting admin id does not exist; nothing was changed.',
          });
        }
        throw err;
      }
    }
  );

  app.get('/api/admin/risk', { preHandler: requireAdmin }, async () => readRiskConfig());

  app.put<{
    Body: {
      maintenanceMode?: boolean;
      maintenanceMessage?: string | null;
      limits?: Array<{ gameType?: string; minBet?: string; maxBet?: string; maxWin?: string }>;
    };
  }>('/api/admin/risk', { preHandler: requireAdmin }, async (req, reply) => {
    const { maintenanceMode, maintenanceMessage, limits } = req.body ?? {};
    const adminId = req.identity!.userId;

    if (typeof maintenanceMode !== 'boolean') {
      return reply.code(400).send({ error: 'maintenanceMode must be a boolean' });
    }
    if (!Array.isArray(limits)) {
      return reply.code(400).send({ error: 'limits must be an array' });
    }

    const parsed = [];
    for (const limit of limits) {
      if (!limit?.gameType || !GAME_TYPES.includes(limit.gameType as GameType)) {
        return reply.code(400).send({ error: `unknown gameType: ${limit?.gameType}` });
      }
      for (const field of ['minBet', 'maxBet', 'maxWin'] as const) {
        if (typeof limit[field] !== 'string' || !DECIMAL.test(limit[field]!)) {
          return reply
            .code(400)
            .send({ error: `${limit.gameType}.${field} must be a decimal string` });
        }
      }
      if (new Prisma.Decimal(limit.minBet!).greaterThan(new Prisma.Decimal(limit.maxBet!))) {
        return reply
          .code(400)
          .send({ error: `${limit.gameType}: minBet cannot exceed maxBet` });
      }
      parsed.push({
        gameType: limit.gameType as GameType,
        minBet: limit.minBet!,
        maxBet: limit.maxBet!,
        maxWin: limit.maxWin!,
      });
    }

    try {
      await writeRiskConfig({
        adminId,
        maintenanceMode,
        maintenanceMessage: maintenanceMessage?.trim() || null,
        limits: parsed,
        auditWithin: (tx, details) =>
          auditWithin(tx, {
            adminId,
            action: 'RISK_CONFIG_UPDATED',
            details,
          }),
      });
      return readRiskConfig();
    } catch (err) {
      if (isUnknownAdminError(err)) {
        return reply.code(409).send({
          error: 'unknown_admin',
          detail: 'Acting admin id does not exist; nothing was changed.',
        });
      }
      throw err;
    }
  });

  // ── Audit log (read-only) ──────────────────
  app.get<{ Querystring: { action?: string; q?: string; take?: string; skip?: string } }>(
    '/api/admin/audit-logs',
    { preHandler: requireAdmin },
    async (req) => {
      const take = clampTake(req.query.take, 50);
      const skip = Math.max(0, Number(req.query.skip) || 0);
      const q = (req.query.q ?? '').trim();

      const where: Prisma.AdminAuditLogWhereInput = {
        ...(req.query.action ? { action: req.query.action } : {}),
        ...(q
          ? {
              OR: [
                { admin: { email: { contains: q, mode: 'insensitive' as const } } },
                { target: { email: { contains: q, mode: 'insensitive' as const } } },
                { targetUserId: q },
                { adminId: q },
              ],
            }
          : {}),
      };

      const [rows, total, actions] = await Promise.all([
        prisma.adminAuditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take,
          skip,
          select: {
            id: true,
            action: true,
            details: true,
            createdAt: true,
            admin: { select: { id: true, email: true } },
            target: { select: { id: true, email: true } },
          },
        }),
        prisma.adminAuditLog.count({ where }),
        prisma.adminAuditLog.findMany({
          distinct: ['action'],
          select: { action: true },
          orderBy: { action: 'asc' },
        }),
      ]);

      return {
        total,
        take,
        skip,
        actions: actions.map((a) => a.action),
        entries: rows.map((row) => ({
          id: row.id,
          action: row.action,
          details: row.details,
          createdAt: row.createdAt.toISOString(),
          adminId: row.admin.id,
          adminEmail: row.admin.email,
          targetUserId: row.target?.id ?? null,
          targetEmail: row.target?.email ?? null,
        })),
      };
    }
  );
}
