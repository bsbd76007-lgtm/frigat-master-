/**
 * FRIGAT — Player seed routes
 *
 * Backs the Provably Fair dialog: read the active commitment, and rotate into a
 * fresh pair with a client seed of the player's choosing.
 *
 * The active pair's `serverSeed` is never serialised here. Publishing it while
 * it can still decide outcomes would let a player compute results before
 * betting — only the hash goes out until the pair is retired by a rotation.
 *
 * Scoped to the caller's own token; there is deliberately no `:userId`.
 */

import type { FastifyInstance } from 'fastify';
import { identityFromRequest } from './auth';
import {
  getActiveSeed,
  setClientSeed,
  rotateSeed,
  InvalidClientSeedError,
} from '../services/provableFair.service';

export function registerSeedRoutes(app: FastifyInstance) {
  // ── Active seed pair ───────────────────────
  app.get('/api/seeds/active', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const seed = await getActiveSeed(identity.userId);
    return {
      clientSeed: seed.clientSeed,
      hashedServerSeed: seed.hashedServerSeed,
      nonce: seed.nonce,
    };
  });

  app.post<{ Body: { clientSeed?: string } }>(
    '/api/seeds/rotate',
    async (req, reply) => {
      const identity = identityFromRequest(req);
      if (!identity) return reply.code(401).send({ error: 'unauthorized' });

      const requested = req.body?.clientSeed;

      try {
        const { active, revealed } =
          typeof requested === 'string'
            ? await setClientSeed(identity.userId, requested)
            : await rotateSeed(identity.userId);

        return {
          clientSeed: active.clientSeed,
          hashedServerSeed: active.hashedServerSeed,
          nonce: active.nonce,
          serverSeed: revealed?.serverSeed ?? null,
          previousHashedServerSeed: revealed?.hashedServerSeed ?? null,
          previousClientSeed: revealed?.clientSeed ?? null,
          previousNonce: revealed?.nonce ?? null,
        };
      } catch (err) {
        if (err instanceof InvalidClientSeedError) {
          return reply.code(400).send({ error: 'invalid_client_seed', message: err.message });
        }
        throw err;
      }
    }
  );
}
