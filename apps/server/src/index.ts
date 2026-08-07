import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';

import { config } from './config';
import { prisma } from './config/prisma';
import { version as SERVER_VERSION } from '../package.json';
import { registerSocketServer } from './websocket/socket.server';
import { registerAdminRoutes } from './http/admin.routes';
import { registerAdminUserRoutes } from './http/adminUsers.routes';
import { registerAdminRiskRoutes } from './http/adminRisk.routes';
import { registerWalletRoutes } from './http/wallet.routes';
import { registerReferralRoutes } from './http/referral.routes';
import { registerVipRoutes } from './http/vip.routes';
import { registerStreakRoutes } from './http/streak.routes';
import { registerSeedRoutes } from './http/seed.routes';
import { registerAuthRoutes } from './routes/auth.routes';
import { registerPaymentRoutes } from './routes/payment.routes';
import { registerGameRoutes } from './routes/games';

async function bootstrap() {
  const app = Fastify({
    logger: {
      level: config.env === 'production' ? 'info' : 'debug',
      transport:
        config.env === 'production'
          ? undefined
          : { target: 'pino-pretty', options: { colorize: true } },
    },
  });

  // Browser calls come from the Next app on another origin. The allow-list is
  // explicit — a wildcard here would let any site read admin JSON using a
  // victim admin's token.
  await app.register(cors, {
    origin: config.webOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  await app.register(websocket, {
    options: { maxPayload: 1 << 20 /* 1 MiB */ },
  });

  app.get('/', async () => ({
    status: 'ok',
    server: 'FRIGAT API',
    version: SERVER_VERSION,
  }));

  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));
  app.get('/ready', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ready' };
  });

  // Public credential endpoints (register / login). Unauthenticated by design.
  registerAuthRoutes(app);

  registerAdminRoutes(app);
  registerAdminUserRoutes(app);
  registerAdminRiskRoutes(app);
  registerWalletRoutes(app);

  registerPaymentRoutes(app);

  registerReferralRoutes(app);
  registerVipRoutes(app);
  registerStreakRoutes(app);

  // Player-scoped provably-fair seeds (read active pair, rotate).
  registerSeedRoutes(app);

  registerGameRoutes(app);

  registerSocketServer(app);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received — shutting down`);
    try {
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`FRIGAT server listening on ${config.host}:${config.port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal: failed to start server', err);
  process.exit(1);
});
