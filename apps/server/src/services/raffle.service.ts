/**
 * FRIGAT — Giveaway tickets.
 *
 * Tickets are *earned*, and the server works out how many are owed rather than
 * accepting a number from the client. Two rules matter more than the rest:
 *
 *   1. **Numbers are allocated atomically.** `Raffle.ticketCounter` is
 *      incremented inside the same transaction that inserts the rows, so two
 *      concurrent claims take disjoint ranges. A unique index on
 *      (raffleId, ticketNumber) is the backstop if that reasoning is ever
 *      broken by a later edit.
 *
 *   2. **Every source has a watermark.** Wagering is summed over the giveaway
 *      window, and an entry row records how much of it has already been
 *      converted; the daily ticket records the UTC day it was granted. Without
 *      those, the same $10 — or the same check-in — mints a ticket forever.
 */

import { Prisma, RaffleStatus } from '@prisma/client';

import { prisma } from '../config/prisma';

const D = Prisma.Decimal;

/** Wagering that earns one ticket. */
export const WAGER_PER_TICKET = new D(10);

/** Cap per request. A player returning after a long absence gets a sane batch. */
const MAX_TICKETS_PER_CLAIM = 500;

export type TicketSource = 'WAGER' | 'DAILY_LOGIN' | 'DEPOSIT' | 'TELEGRAM';

/** Tickets granted per completed deposit. */
export const TICKETS_PER_DEPOSIT = 5;

/** Payment states that count as money actually received. */
const SETTLED_PAYMENTS = ['PAID', 'PAID_OVER', 'CONFIRMED'] as const;

/**
 * The task board the hub renders.
 *
 * `verifiable` decides whether a task can pay. Telegram is listed and does not:
 * nothing in this system talks to Telegram, so a claim button for it would hand
 * out tickets — which win a $10,000 prize — to anyone who pressed it without
 * subscribing. It becomes payable the day a bot can confirm membership.
 */
export interface RaffleTask {
  id: TicketSource;
  title: string;
  detail: string;
  reward: string;
  verifiable: boolean;
  href?: string;
}

export const RAFFLE_TASKS: readonly RaffleTask[] = [
  {
    id: 'DAILY_LOGIN',
    title: 'Daily check-in',
    detail: 'Check in on the rewards hub and today’s ticket comes with it.',
    reward: '+1 ticket',
    verifiable: true,
  },
  {
    id: 'WAGER',
    title: 'Wager $10 in games',
    detail: 'Every $10 staked since the giveaway opened earns a ticket.',
    reward: '+1 per $10',
    verifiable: true,
  },
  {
    id: 'DEPOSIT',
    title: 'Make a deposit',
    detail: 'Every settled deposit adds five tickets to the draw.',
    reward: `+${TICKETS_PER_DEPOSIT} tickets`,
    verifiable: true,
  },
  {
    id: 'TELEGRAM',
    title: 'Subscribe to Telegram',
    detail:
      'Announcements and drops. No tickets attached yet — nothing here can confirm a subscription.',
    reward: 'No tickets yet',
    verifiable: false,
    href: 'https://t.me/frigat',
  },
];

export class NoActiveRaffleError extends Error {
  constructor() {
    super('raffle: no active raffle');
    this.name = 'NoActiveRaffleError';
  }
}

export class RaffleClosedError extends Error {
  constructor() {
    super('raffle: this giveaway has closed');
    this.name = 'RaffleClosedError';
  }
}

export class NothingToClaimError extends Error {
  constructor(readonly wageredToNext: string) {
    super('raffle: no tickets owed');
    this.name = 'NothingToClaimError';
  }
}

/**
 * Wagering by one player *since the giveaway opened*.
 *
 * Deliberately not the lifetime total. Testing against seeded data made the
 * problem obvious: an existing account with £32k of history instantly minted
 * 3,197 tickets and held 99% of the draw before anyone else had played a hand.
 * A giveaway that is decided by who was already here is not a giveaway, so the
 * window starts at `Raffle.createdAt`.
 */
async function wageredSince(userId: string, since: Date): Promise<Prisma.Decimal> {
  const agg = await prisma.gameSession.aggregate({
    _sum: { betAmount: true },
    where: { userId, createdAt: { gte: since } },
  });
  return agg._sum.betAmount ?? new D(0);
}

/**
 * Completed deposits made since the giveaway opened.
 *
 * Counted from `Payment`, not from wallet credits: a bonus or an affiliate
 * sweep also increases a balance, and neither is a deposit.
 */
async function settledDepositsSince(userId: string, since: Date): Promise<number> {
  return prisma.payment.count({
    where: {
      userId,
      createdAt: { gte: since },
      status: { in: SETTLED_PAYMENTS as unknown as Prisma.EnumCryptoPaymentStatusFilter['in'] },
    },
  });
}

/** Midnight-UTC day index. */
function utcDay(at: Date): number {
  return Math.floor(at.getTime() / 86_400_000);
}

// ─────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────

export interface ActiveRaffleView {
  id: string;
  title: string;
  prizePool: string;
  prizeValue: string | null;
  ticketPrice: string | null;
  endsAt: string;
  status: RaffleStatus;
  totalTickets: number;
  participants: number;
  /** Present only for a signed-in caller. */
  you?: {
    ticketCount: number;
    /** Most recent numbers, newest first — the badges the hub renders. */
    ticketNumbers: number[];
    wageredCredited: string;
    wageredToNextTicket: string;
    checkInTicketAvailable: boolean;
    pendingWagerTickets: number;
    pendingDepositTickets: number;
  };
}

export async function getActiveRaffle(userId?: string): Promise<ActiveRaffleView | null> {
  const raffle = await prisma.raffle.findFirst({
    where: { status: RaffleStatus.ACTIVE },
    orderBy: { endsAt: 'asc' },
  });
  if (!raffle) return null;

  // Wagering counts only from the moment the giveaway opened — see the note on
  // `wageredSince`.
  const since = raffle.createdAt;

  const [totalTickets, participants] = await Promise.all([
    prisma.raffleTicket.count({ where: { raffleId: raffle.id } }),
    prisma.raffleTicket
      .findMany({
        where: { raffleId: raffle.id },
        distinct: ['userId'],
        select: { userId: true },
      })
      .then((rows) => rows.length),
  ]);

  const view: ActiveRaffleView = {
    id: raffle.id,
    title: raffle.title,
    prizePool: raffle.prizePool,
    prizeValue: raffle.prizeValue?.toString() ?? null,
    ticketPrice: raffle.ticketPrice?.toString() ?? null,
    endsAt: raffle.endsAt.toISOString(),
    status: raffle.status,
    totalTickets,
    participants,
  };

  if (!userId) return view;

  const [tickets, entry, sessions, user, deposits] = await Promise.all([
    prisma.raffleTicket.findMany({
      where: { raffleId: raffle.id, userId },
      orderBy: { ticketNumber: 'desc' },
      select: { ticketNumber: true },
    }),
    prisma.raffleEntry.findUnique({
      where: { raffleId_userId: { raffleId: raffle.id, userId } },
      select: { wageredCredited: true, lastCheckInTicketAt: true, depositsCredited: true },
    }),
    wageredSince(userId, since),
    prisma.user.findUnique({ where: { id: userId }, select: { lastCheckInAt: true } }),
    settledDepositsSince(userId, since),
  ]);

  const wagered = sessions;
  const credited = entry?.wageredCredited ?? new D(0);
  const pending = wagered.minus(credited);
  const pendingTickets = pending.lessThanOrEqualTo(0)
    ? 0
    : Number(pending.div(WAGER_PER_TICKET).floor());

  const toNext = pending.lessThanOrEqualTo(0)
    ? WAGER_PER_TICKET
    : WAGER_PER_TICKET.minus(pending.mod(WAGER_PER_TICKET));

  view.you = {
    ticketCount: tickets.length,
    ticketNumbers: tickets.slice(0, 12).map((t) => t.ticketNumber),
    wageredCredited: credited.toFixed(8),
    wageredToNextTicket: toNext.toFixed(2),
    checkInTicketAvailable: checkInTicketOwed(
      user?.lastCheckInAt ?? null,
      entry?.lastCheckInTicketAt ?? null
    ),
    pendingWagerTickets: pendingTickets,
    pendingDepositTickets:
      Math.max(0, deposits - (entry?.depositsCredited ?? 0)) * TICKETS_PER_DEPOSIT,
  };

  return view;
}

/**
 * A check-in ticket is owed when the player has checked in *today* and has not
 * already been given today's ticket. It piggybacks on the existing check-in
 * rather than being a second daily claim — the reward for checking in should be
 * one action, not two buttons that both have to be pressed.
 */
function checkInTicketOwed(lastCheckInAt: Date | null, lastTicketAt: Date | null): boolean {
  if (!lastCheckInAt) return false;
  const today = utcDay(new Date());
  if (utcDay(lastCheckInAt) !== today) return false;
  return !lastTicketAt || utcDay(lastTicketAt) < today;
}

// ─────────────────────────────────────────────
// Claiming
// ─────────────────────────────────────────────

export interface ClaimResult {
  issued: number;
  ticketNumbers: number[];
  totalTickets: number;
  breakdown: { wager: number; checkIn: number; deposit: number };
}

/**
 * Makes sure the player has an entry row, tolerating a concurrent creator.
 *
 * P2002 here means somebody else inserted it a moment ago, which is exactly the
 * state we wanted — so it is success, not an error.
 */
async function ensureEntry(raffleId: string, userId: string): Promise<void> {
  try {
    await prisma.raffleEntry.create({ data: { raffleId, userId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
    throw err;
  }
}

export async function claimTickets(userId: string): Promise<ClaimResult> {
  const raffle = await prisma.raffle.findFirst({
    where: { status: RaffleStatus.ACTIVE },
    orderBy: { endsAt: 'asc' },
    select: { id: true, endsAt: true, createdAt: true },
  });
  if (!raffle) throw new NoActiveRaffleError();
  if (raffle.endsAt <= new Date()) throw new RaffleClosedError();

  // The entry row is created *before* the transaction opens.
  //
  // `upsert` inside the transaction looked equivalent and was not: two
  // concurrent first-claims both find no row, both insert, and the loser hits
  // the unique constraint — which aborts its whole transaction and surfaced as
  // a 500 rather than a clean "nothing to claim". Creating it out here means
  // the loser simply reads the winner's row.
  await ensureEntry(raffle.id, userId);

  return prisma.$transaction(async (tx) => {
    const entry = await tx.raffleEntry.findUniqueOrThrow({
      where: { raffleId_userId: { raffleId: raffle.id, userId } },
      select: {
        id: true,
        wageredCredited: true,
        lastCheckInTicketAt: true,
        depositsCredited: true,
      },
    });

    const [sessions, user, settledDeposits] = await Promise.all([
      tx.gameSession.aggregate({
        _sum: { betAmount: true },
        where: { userId, createdAt: { gte: raffle.createdAt } },
      }),
      tx.user.findUnique({ where: { id: userId }, select: { lastCheckInAt: true } }),
      tx.payment.count({
        where: {
          userId,
          createdAt: { gte: raffle.createdAt },
          status: { in: SETTLED_PAYMENTS as unknown as Prisma.EnumCryptoPaymentStatusFilter['in'] },
        },
      }),
    ]);

    const wagered = sessions._sum.betAmount ?? new D(0);
    const pending = wagered.minus(entry.wageredCredited);
    const wagerTickets = pending.lessThanOrEqualTo(0)
      ? 0
      : Math.min(Number(pending.div(WAGER_PER_TICKET).floor()), MAX_TICKETS_PER_CLAIM);

    const today = utcDay(new Date());
    const wantsCheckIn = checkInTicketOwed(
      user?.lastCheckInAt ?? null,
      entry.lastCheckInTicketAt
    );

    // Deposits: five tickets each, watermarked by how many have already been
    // converted, so a settled deposit pays exactly once.
    const uncredited = Math.max(0, settledDeposits - entry.depositsCredited);
    const depositTickets = Math.min(uncredited * TICKETS_PER_DEPOSIT, MAX_TICKETS_PER_CLAIM);

    const total = wagerTickets + (wantsCheckIn ? 1 : 0) + depositTickets;
    if (total === 0) {
      const toNext = pending.lessThanOrEqualTo(0)
        ? WAGER_PER_TICKET
        : WAGER_PER_TICKET.minus(pending.mod(WAGER_PER_TICKET));
      throw new NothingToClaimError(toNext.toFixed(2));
    }

    // Move the watermarks *first*, each with a predicate that matches only the
    // state we read. A concurrent claim that got there first fails the match,
    // and this one rolls back rather than minting duplicate tickets.
    if (wagerTickets > 0) {
      const consumed = WAGER_PER_TICKET.mul(wagerTickets);
      const moved = await tx.raffleEntry.updateMany({
        where: { id: entry.id, wageredCredited: entry.wageredCredited },
        data: { wageredCredited: entry.wageredCredited.plus(consumed) },
      });
      if (moved.count !== 1) throw new NothingToClaimError('0.00');
    }
    if (depositTickets > 0) {
      const moved = await tx.raffleEntry.updateMany({
        where: { id: entry.id, depositsCredited: entry.depositsCredited },
        data: { depositsCredited: entry.depositsCredited + uncredited },
      });
      if (moved.count !== 1) throw new NothingToClaimError('0.00');
    }
    if (wantsCheckIn) {
      const moved = await tx.raffleEntry.updateMany({
        where: {
          id: entry.id,
          OR: [
            { lastCheckInTicketAt: null },
            { lastCheckInTicketAt: { lt: new Date(today * 86_400_000) } },
          ],
        },
        data: { lastCheckInTicketAt: new Date() },
      });
      if (moved.count !== 1) throw new NothingToClaimError('0.00');
    }

    // Allocate a contiguous block. The increment returns the *new* counter, so
    // the block is [counter - total + 1, counter].
    const counter = await tx.raffle.update({
      where: { id: raffle.id },
      data: { ticketCounter: { increment: total } },
      select: { ticketCounter: true },
    });
    const firstNumber = counter.ticketCounter - total + 1;

    // Sources are laid out in blocks so each ticket records how it was earned.
    const sourceFor = (i: number): TicketSource => {
      if (i < wagerTickets) return 'WAGER';
      if (i < wagerTickets + depositTickets) return 'DEPOSIT';
      return 'DAILY_LOGIN';
    };
    const rows = Array.from({ length: total }, (_, i) => ({
      raffleId: raffle.id,
      userId,
      ticketNumber: firstNumber + i,
      source: sourceFor(i) as string,
    }));
    await tx.raffleTicket.createMany({ data: rows });

    const totalTickets = await tx.raffleTicket.count({
      where: { raffleId: raffle.id, userId },
    });

    return {
      issued: total,
      ticketNumbers: rows.map((r) => r.ticketNumber),
      totalTickets,
      breakdown: {
        wager: wagerTickets,
        checkIn: wantsCheckIn ? 1 : 0,
        deposit: depositTickets,
      },
    };
  });
}

// ─────────────────────────────────────────────
// Leaderboard and history
// ─────────────────────────────────────────────

export interface LeaderboardRow {
  rank: number;
  /** Masked — a giveaway board is not a reason to publish addresses. */
  player: string;
  tickets: number;
}

export interface RecentTicket {
  player: string;
  ticketNumber: number;
  createdAt: string;
}

export interface PastWinner {
  title: string;
  prizePool: string;
  winningTicketNumber: number | null;
  player: string | null;
  drawnAt: string | null;
}

/** `ab***@domain` — enough to recognise yourself, not enough to identify others. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`;
}

export async function getLeaderboard(limit = 10): Promise<{
  raffleId: string | null;
  leaders: LeaderboardRow[];
  recent: RecentTicket[];
  past: PastWinner[];
}> {
  const raffle = await prisma.raffle.findFirst({
    where: { status: RaffleStatus.ACTIVE },
    orderBy: { endsAt: 'asc' },
    select: { id: true },
  });

  const [grouped, recentRows, pastRaffles] = await Promise.all([
    raffle
      ? prisma.raffleTicket.groupBy({
          by: ['userId'],
          where: { raffleId: raffle.id },
          _count: { _all: true },
          orderBy: { _count: { userId: 'desc' } },
          take: limit,
        })
      : Promise.resolve([]),
    raffle
      ? prisma.raffleTicket.findMany({
          where: { raffleId: raffle.id },
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: {
            ticketNumber: true,
            createdAt: true,
            user: { select: { email: true } },
          },
        })
      : Promise.resolve([]),
    prisma.raffle.findMany({
      where: { status: RaffleStatus.COMPLETED },
      orderBy: { drawnAt: 'desc' },
      take: 5,
      select: {
        title: true,
        prizePool: true,
        winningTicketNumber: true,
        winnerUserId: true,
        drawnAt: true,
      },
    }),
  ]);

  const leaderIds = grouped.map((row) => row.userId);
  const winnerIds = pastRaffles.map((r) => r.winnerUserId).filter((id): id is string => !!id);
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set([...leaderIds, ...winnerIds])] } },
    select: { id: true, email: true },
  });
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  return {
    raffleId: raffle?.id ?? null,
    leaders: grouped.map((row, i) => ({
      rank: i + 1,
      player: maskEmail(emailById.get(row.userId) ?? 'unknown@'),
      tickets: row._count._all,
    })),
    recent: recentRows.map((row) => ({
      player: maskEmail(row.user.email),
      ticketNumber: row.ticketNumber,
      createdAt: row.createdAt.toISOString(),
    })),
    past: pastRaffles.map((r) => ({
      title: r.title,
      prizePool: r.prizePool,
      winningTicketNumber: r.winningTicketNumber,
      player: r.winnerUserId ? maskEmail(emailById.get(r.winnerUserId) ?? 'unknown@') : null,
      drawnAt: r.drawnAt?.toISOString() ?? null,
    })),
  };
}
