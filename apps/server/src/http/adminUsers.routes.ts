/**
 * FRIGAT — Admin user & ledger routes
 *
 * All ADMIN-gated. Every mutating route writes an AdminAuditLog entry naming
 * the acting admin, the target, and the reason — an operator console that can
 * move money without leaving a trail is not auditable.
 *
 * Money is returned as Decimal strings throughout; the browser formats it
 * digit-wise and never parses it into a float.
 */

import type { FastifyInstance } from 'fastify';
import { Prisma, Role, TransactionType, TransactionStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { requireAdmin } from './auth';
import { adjustBalance, InsufficientFundsError } from '../services/ledger.service';
import { auditWithin, isUnknownAdminError } from '../services/audit.service';

const PAGE_SIZE = 25;
const MAX_REASON = 500;

function clampTake(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return PAGE_SIZE;
  return Math.min(Math.floor(n), 100);
}

/** Sums a wallet list into one display balance (single-currency for now). */
function totalBalance(wallets: Array<{ balance: Prisma.Decimal }>): string {
  return wallets
    .reduce((sum, w) => sum.plus(w.balance), new Prisma.Decimal(0))
    .toFixed(8);
}

export function registerAdminUserRoutes(app: FastifyInstance) {
  // ── List / search users ────────────────────
  app.get<{ Querystring: { q?: string; take?: string; skip?: string; frozen?: string } }>(
    '/api/admin/users',
    { preHandler: requireAdmin },
    async (req) => {
      const q = (req.query.q ?? '').trim();
      const take = clampTake(req.query.take);
      const skip = Math.max(0, Number(req.query.skip) || 0);

      // `mode: 'insensitive'` keeps this a parameterised query — never string
      // interpolation into SQL.
      const where: Prisma.UserWhereInput = {
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: 'insensitive' as const } },
                { telegramId: { contains: q, mode: 'insensitive' as const } },
                { id: q },
              ],
            }
          : {}),
        ...(req.query.frozen === 'true' ? { frozen: true } : {}),
      };

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take,
          skip,
          select: {
            id: true,
            email: true,
            telegramId: true,
            role: true,
            frozen: true,
            frozenReason: true,
            createdAt: true,
            revSharePercentage: true,
            wallets: { select: { balance: true, currency: true } },
            _count: { select: { referrals: true } },
          },
        }),
        prisma.user.count({ where }),
      ]);

      return {
        total,
        take,
        skip,
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          telegramId: u.telegramId,
          role: u.role,
          frozen: u.frozen,
          frozenReason: u.frozenReason,
          createdAt: u.createdAt.toISOString(),
          balance: totalBalance(u.wallets),
          currency: u.wallets[0]?.currency ?? 'USD',
          referredCount: u._count.referrals,
          revSharePercentage: u.revSharePercentage.toFixed(2),
        })),
      };
    }
  );

  // ── Single user detail ─────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/admin/users/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          email: true,
          telegramId: true,
          role: true,
          frozen: true,
          frozenAt: true,
          frozenReason: true,
          createdAt: true,
          revSharePercentage: true,
          wallets: { select: { balance: true, currency: true } },
          _count: { select: { gameSessions: true, referrals: true } },
        },
      });
      if (!user) return reply.code(404).send({ error: 'not_found' });

      return {
        id: user.id,
        email: user.email,
        telegramId: user.telegramId,
        role: user.role,
        frozen: user.frozen,
        frozenAt: user.frozenAt?.toISOString() ?? null,
        frozenReason: user.frozenReason,
        createdAt: user.createdAt.toISOString(),
        balance: totalBalance(user.wallets),
        currency: user.wallets[0]?.currency ?? 'USD',
        betCount: user._count.gameSessions,
        referredCount: user._count.referrals,
        revSharePercentage: user.revSharePercentage.toFixed(2),
      };
    }
  );

  // ── Manual balance adjustment ──────────────
  app.post<{
    Params: { id: string };
    Body: { amount?: string; direction?: string; reason?: string; idempotencyKey?: string };
  }>(
    '/api/admin/users/:id/balance',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { amount, direction, reason, idempotencyKey } = req.body ?? {};
      const adminId = req.identity!.userId;

      if (direction !== 'CREDIT' && direction !== 'DEBIT') {
        return reply.code(400).send({ error: 'direction must be CREDIT or DEBIT' });
      }
      if (typeof amount !== 'string' || !/^\d+(\.\d{1,8})?$/.test(amount)) {
        return reply.code(400).send({ error: 'amount must be a positive decimal string' });
      }
      // A reason is mandatory: it is the only record of *why* money moved.
      if (typeof reason !== 'string' || reason.trim().length < 3) {
        return reply.code(400).send({ error: 'reason is required (min 3 characters)' });
      }
      if (reason.length > MAX_REASON) {
        return reply.code(400).send({ error: `reason must be <= ${MAX_REASON} characters` });
      }
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
        return reply.code(400).send({ error: 'idempotencyKey is required' });
      }

      const target = await prisma.user.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!target) return reply.code(404).send({ error: 'not_found' });

      try {
        // The audit entry is written inside adjustBalance's transaction, so a
        // failure here rolls the money back rather than leaving it unrecorded.
        return await adjustBalance({
          userId: req.params.id,
          amount,
          direction,
          idempotencyKey,
          audit: { adminId, reason: reason.trim() },
        });
      } catch (err) {
        if (err instanceof InsufficientFundsError) {
          return reply.code(409).send({ error: 'insufficient_funds' });
        }
        if (isUnknownAdminError(err)) {
          return reply
            .code(409)
            .send({ error: 'unknown_admin', detail: 'Acting admin id does not exist; nothing was changed.' });
        }
        throw err;
      }
    }
  );

  // ── Role change ────────────────────────────
  app.patch<{ Params: { id: string }; Body: { role?: string; reason?: string } }>(
    '/api/admin/users/:id/role',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { role, reason } = req.body ?? {};
      const adminId = req.identity!.userId;

      if (role !== Role.USER && role !== Role.ADMIN) {
        return reply.code(400).send({ error: 'role must be USER or ADMIN' });
      }
      // Self-demotion can strip the last admin out of the console entirely.
      if (req.params.id === adminId && role === Role.USER) {
        return reply.code(409).send({ error: 'cannot demote your own account' });
      }

      const before = await prisma.user.findUnique({
        where: { id: req.params.id },
        select: { role: true },
      });
      if (!before) return reply.code(404).send({ error: 'not_found' });

      try {
        return await prisma.$transaction(async (tx) => {
          const updated = await tx.user.update({
            where: { id: req.params.id },
            data: { role },
            select: { id: true, role: true },
          });
          await auditWithin(tx, {
            adminId,
            action: 'ROLE_CHANGED',
            targetUserId: req.params.id,
            details: { from: before.role, to: role, reason: reason?.trim() ?? null },
          });
          return updated;
        });
      } catch (err) {
        if (isUnknownAdminError(err)) {
          return reply
            .code(409)
            .send({ error: 'unknown_admin', detail: 'Acting admin id does not exist; nothing was changed.' });
        }
        throw err;
      }
    }
  );

  // ── RevShare percentage ────────────────────
  //
  // The affiliate's cut of their downline's net losses. Per-user so a proven
  // arbitrageur can be moved off the 25% default without changing it globally.
  app.patch<{ Params: { id: string }; Body: { revSharePercentage?: string; reason?: string } }>(
    '/api/admin/users/:id/revshare',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { revSharePercentage, reason } = req.body ?? {};
      const adminId = req.identity!.userId;

      if (
        typeof revSharePercentage !== 'string' ||
        !/^\d{1,3}(\.\d{1,2})?$/.test(revSharePercentage)
      ) {
        return reply
          .code(400)
          .send({ error: 'revSharePercentage must be a decimal string with at most 2 places' });
      }

      const pct = new Prisma.Decimal(revSharePercentage);
      // Above 100 the platform pays out more than the downline actually lost,
      // turning every losing bet into a net loss for the house. The column is
      // Decimal(5,2) and would happily store 999.99, so the ceiling is here.
      if (pct.lessThan(0) || pct.greaterThan(100)) {
        return reply.code(400).send({ error: 'revSharePercentage must be between 0 and 100' });
      }

      const before = await prisma.user.findUnique({
        where: { id: req.params.id },
        select: { revSharePercentage: true },
      });
      if (!before) return reply.code(404).send({ error: 'not_found' });

      try {
        return await prisma.$transaction(async (tx) => {
          const updated = await tx.user.update({
            where: { id: req.params.id },
            data: { revSharePercentage: pct },
            select: { id: true, revSharePercentage: true },
          });
          await auditWithin(tx, {
            adminId,
            action: 'REVSHARE_CHANGED',
            targetUserId: req.params.id,
            details: {
              from: before.revSharePercentage.toFixed(2),
              to: pct.toFixed(2),
              reason: reason?.trim() ?? null,
            },
          });
          return {
            id: updated.id,
            revSharePercentage: updated.revSharePercentage.toFixed(2),
          };
        });
      } catch (err) {
        if (isUnknownAdminError(err)) {
          return reply
            .code(409)
            .send({ error: 'unknown_admin', detail: 'Acting admin id does not exist; nothing was changed.' });
        }
        throw err;
      }
    }
  );

  // ── Freeze / unfreeze ──────────────────────
  app.post<{ Params: { id: string }; Body: { frozen?: boolean; reason?: string } }>(
    '/api/admin/users/:id/freeze',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { frozen, reason } = req.body ?? {};
      const adminId = req.identity!.userId;

      if (typeof frozen !== 'boolean') {
        return reply.code(400).send({ error: 'frozen must be a boolean' });
      }
      if (frozen && (typeof reason !== 'string' || reason.trim().length < 3)) {
        return reply.code(400).send({ error: 'reason is required when freezing' });
      }
      if (req.params.id === adminId && frozen) {
        return reply.code(409).send({ error: 'cannot freeze your own account' });
      }

      const exists = await prisma.user.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!exists) return reply.code(404).send({ error: 'not_found' });

      try {
        const updated = await prisma.$transaction(async (tx) => {
          const row = await tx.user.update({
            where: { id: req.params.id },
            data: {
              frozen,
              frozenAt: frozen ? new Date() : null,
              frozenReason: frozen ? reason!.trim() : null,
            },
            select: { id: true, frozen: true, frozenAt: true, frozenReason: true },
          });
          await auditWithin(tx, {
            adminId,
            action: frozen ? 'ACCOUNT_FROZEN' : 'ACCOUNT_UNFROZEN',
            targetUserId: req.params.id,
            details: { reason: reason?.trim() ?? null },
          });
          return row;
        });

        return { ...updated, frozenAt: updated.frozenAt?.toISOString() ?? null };
      } catch (err) {
        if (isUnknownAdminError(err)) {
          return reply
            .code(409)
            .send({ error: 'unknown_admin', detail: 'Acting admin id does not exist; nothing was changed.' });
        }
        throw err;
      }
    }
  );

  // ── Transaction ledger ─────────────────────
  app.get<{
    Querystring: { q?: string; type?: string; status?: string; take?: string; skip?: string };
  }>(
    '/api/admin/transactions',
    { preHandler: requireAdmin },
    async (req) => {
      const take = clampTake(req.query.take);
      const skip = Math.max(0, Number(req.query.skip) || 0);
      const q = (req.query.q ?? '').trim();

      const type =
        req.query.type && req.query.type in TransactionType
          ? (req.query.type as TransactionType)
          : undefined;
      const status =
        req.query.status && req.query.status in TransactionStatus
          ? (req.query.status as TransactionStatus)
          : undefined;

      const where: Prisma.TransactionWhereInput = {
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(q
          ? {
              wallet: {
                user: {
                  OR: [
                    { email: { contains: q, mode: 'insensitive' as const } },
                    { id: q },
                  ],
                },
              },
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take,
          skip,
          select: {
            id: true,
            type: true,
            amount: true,
            status: true,
            txHash: true,
            createdAt: true,
            wallet: {
              select: {
                currency: true,
                user: { select: { id: true, email: true } },
              },
            },
          },
        }),
        prisma.transaction.count({ where }),
      ]);

      return {
        total,
        take,
        skip,
        transactions: rows.map((t) => ({
          id: t.id,
          type: t.type,
          amount: t.amount.toFixed(8),
          status: t.status,
          txHash: t.txHash,
          createdAt: t.createdAt.toISOString(),
          currency: t.wallet.currency,
          userId: t.wallet.user.id,
          userEmail: t.wallet.user.email,
        })),
      };
    }
  );
}
