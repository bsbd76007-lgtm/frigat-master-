import type { FastifyInstance } from 'fastify';
import { onlinePlayerCount } from '../../websocket/socket.server';

export function registerPresenceRoutes(app: FastifyInstance) {
  app.get('/api/presence', async () => ({ online: onlinePlayerCount() }));
}
