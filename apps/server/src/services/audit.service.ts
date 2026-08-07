/**
 * FRIGAT — Admin Audit Trail
 *
 * Every privileged action writes here. The AdminAuditLog model existed in the
 * schema from the start but nothing wrote to it, which meant balance edits and
 * role changes left no trace — unacceptable for an operator console handling
 * real money.
 *
 * Writes are best-effort-logged but never swallowed silently: if the trail
 * cannot be written the caller decides, because an unaudited privileged action
 * should generally fail rather than proceed unrecorded.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

export type AdminAction =
  | 'BALANCE_ADJUSTED'
  | 'ROLE_CHANGED'
  | 'REVSHARE_CHANGED'
  | 'ACCOUNT_FROZEN'
  | 'ACCOUNT_UNFROZEN'
  | 'WITHDRAWAL_APPROVED'
  | 'WITHDRAWAL_REJECTED'
  | 'RISK_CONFIG_UPDATED';

export interface AuditParams {
  adminId: string;
  action: AdminAction;
  targetUserId?: string | null;
  details: Record<string, unknown>;
}

export class UnknownAdminError extends Error {
  constructor(adminId: string) {
    super(`admin ${adminId} is not a known user; refusing to act unaudited`);
    this.name = 'UnknownAdminError';
  }
}

/**
 * Writes the audit entry using the SUPPLIED transaction client.
 *
 * Callers must pass the same `tx` that performs the privileged change, so the
 * change and its audit record commit atomically. Writing them separately is a
 * real hazard: a failed audit after a committed balance update leaves money
 * moved with no record of who moved it or why.
 */
export async function auditWithin(
  tx: Prisma.TransactionClient,
  params: AuditParams
) {
  return tx.adminAuditLog.create({
    data: {
      adminId: params.adminId,
      action: params.action,
      targetUserId: params.targetUserId ?? null,
      details: params.details as Prisma.InputJsonValue,
    },
    select: { id: true, createdAt: true },
  });
}

export async function writeAudit(params: AuditParams) {
  return prisma.$transaction((tx) => auditWithin(tx, params));
}

/** True when a Prisma error is the AdminAuditLog.adminId foreign key failing. */
export function isUnknownAdminError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003' &&
    String(error.meta?.field_name ?? '').includes('adminId')
  );
}
