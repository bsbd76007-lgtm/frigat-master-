import type { FastifyInstance } from 'fastify';

import { prisma } from '../config/prisma';

/**
 * Health probes.
 *
 * `GET /api/health` reports whether this instance can actually serve traffic,
 * which means asking the database, not just answering. A probe that returns
 * 200 from the event loop alone stays green while Postgres is unreachable, so
 * a load balancer keeps routing bets at an instance that cannot settle them.
 *
 * On failure it answers 503 with no error detail: the probe is public, and a
 * driver message names the host and database. The reason is logged instead.
 *
 * `/health` and `/ready` in index.ts predate this and stay for any deployment
 * already pointed at them — liveness and readiness respectively.
 */
export function registerHealthRoutes(app: FastifyInstance) {
  app.get('/api/health', async (_req, reply) => {
    const startedAt = Date.now();

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      app.log.error({ err }, 'health check: database unreachable');
      return reply.status(503).send({
        status: 'unhealthy',
        database: 'down',
        ts: Date.now(),
      });
    }

    return {
      status: 'ok',
      database: 'up',
      latencyMs: Date.now() - startedAt,
      ts: Date.now(),
    };
  });
}
