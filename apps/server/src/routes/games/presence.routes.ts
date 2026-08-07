/**
 * FRIGAT — Live presence
 *
 * Backs the "N Players Online" chip in the header.
 *
 * The count is the real number of distinct users holding an authenticated
 * socket right now, read straight from the connection registry. It is not
 * padded with a floor, a multiplier, or a random drift — a site that is quiet
 * should look quiet. An inflated presence figure is social proof invented to
 * make a casino feel busier than it is, and players read "1,420 online" as a
 * reason to trust the room.
 *
 * Consequence worth stating: in development this will usually say 1, and with
 * nobody connected it says 0. That is the honest answer, and the UI is built
 * to render it without looking broken.
 */

import type { FastifyInstance } from 'fastify';
import { onlinePlayerCount } from '../../websocket/socket.server';

export function registerPresenceRoutes(app: FastifyInstance) {
  // Public: the header renders before sign-in, and the figure reveals nothing
  // about who is connected — only how many.
  app.get('/api/presence', async () => ({ online: onlinePlayerCount() }));
}
