/**
 * FRIGAT — Withdrawal approvals, risk controls and audit log routes.
 *
 * All ADMIN-gated and all mutations audited inside their own transaction.
 */

import type { FastifyInstance } from 'fastify';
import { Prisma, GameType, TransactionType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { requireAdmin } from './auth';
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

export function registerAdminRiskRoutes(app: FastifyInstance) {
  // ── Pending withdrawal queue ───────────────
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
          orderBy: { createdAt: 'asc' }, // oldest first: a queue, not a feed
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
        })),
      };
    }
  );

  // ── Approve / reject ───────────────────────
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

  // ── Risk configuration ─────────────────────
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
      // A max below the min would make the game unplayable rather than limited.
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
