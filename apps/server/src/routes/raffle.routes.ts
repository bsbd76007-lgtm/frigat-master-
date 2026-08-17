/**
 * FRIGAT — Giveaway API.
 *
 * `active` is readable signed out (a giveaway nobody can see is not a
 * giveaway); the per-player block is attached only when there is a session.
 * Claiming always requires one.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { identityFromRequest } from '../http/auth';
import {
  claimTickets,
  getActiveRaffle,
  getLeaderboard,
  NoActiveRaffleError,
  NothingToClaimError,
  RAFFLE_TASKS,
  RaffleClosedError,
  TICKETS_PER_DEPOSIT,
  WAGER_PER_TICKET,
} from '../services/raffle.service';

export function registerRaffleRoutes(app: FastifyInstance) {
  /**
   * GET /api/raffles/active
   *
   * Countdown is served as the raw `endsAt` timestamp rather than a
   * seconds-remaining number: a client that renders "04:12:59" from a duration
   * computed on the server drifts the moment the response is cached or the tab
   * sleeps. The browser can subtract from its own clock.
   */
  app.get('/api/raffles/active', async (req, reply) => {
    const identity = identityFromRequest(req);
    const raffle = await getActiveRaffle(identity?.userId);

    // The task board ships with the raffle so the hub renders one source of
    // truth: a task the server will not pay cannot appear as claimable.
    const meta = {
      wagerPerTicket: WAGER_PER_TICKET.toString(),
      ticketsPerDeposit: TICKETS_PER_DEPOSIT,
      tasks: RAFFLE_TASKS,
    };
    return reply.send({ raffle: raffle ?? null, ...meta });
  });

  /**
   * POST /api/raffles/claim-ticket
   *
   * Takes no arguments on purpose. The server works out what is owed from
   * wagering and today's check-in; a client-supplied count would be a request
   * to print tickets.
   */
  const claimHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    try {
      const result = await claimTickets(identity.userId);
      req.log.info(
        { userId: identity.userId, issued: result.issued, breakdown: result.breakdown },
        'raffle tickets issued'
      );
      return reply.send({ success: true, ...result });
    } catch (err) {
      if (err instanceof NoActiveRaffleError) {
        return reply.code(404).send({
          error: 'no_active_raffle',
          message: 'There is no giveaway running right now.',
        });
      }
      if (err instanceof RaffleClosedError) {
        return reply.code(409).send({
          error: 'raffle_closed',
          message: 'This giveaway has closed.',
        });
      }
      if (err instanceof NothingToClaimError) {
        return reply.code(409).send({
          error: 'nothing_to_claim',
          message: `No tickets to claim yet — wager ${err.wageredToNext} more for the next one.`,
          wageredToNextTicket: err.wageredToNext,
        });
      }
      throw err;
    }
  };

  // `/claim` is the documented path; `/claim-ticket` predates it and is kept so
  // an older client does not 404. One handler, so they cannot diverge.
  app.post('/api/raffles/claim', claimHandler);
  app.post('/api/raffles/claim-ticket', claimHandler);

  /** GET /api/raffles/leaderboard — top holders, a live ticker, and past draws. */
  app.get<{ Querystring: { limit?: string } }>(
    '/api/raffles/leaderboard',
    async (req, reply) => {
      const raw = Number(req.query.limit ?? 10);
      const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 10;
      return reply.send(await getLeaderboard(limit));
    }
  );
}

export default registerRaffleRoutes;
