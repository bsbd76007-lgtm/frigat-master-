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
import { registerRewardsRoutes } from './routes/rewards.routes';
import { registerRaffleRoutes } from './routes/raffle.routes';
import { registerSeedRoutes } from './http/seed.routes';
import { registerAuthRoutes } from './routes/auth.routes';
import { registerPaymentRoutes } from './routes/payment.routes';
import { registerSupportRoutes } from './routes/support.routes';
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

  /**
   * Response hardening headers.
   *
   * Written by hand rather than pulling in Helmet: this service answers JSON
   * and upgrades WebSockets, so most of Helmet's surface (CSP for documents,
   * DNS prefetch, IE download options) is inert here, and a short explicit list
   * is easier to audit than a plugin's defaults.
   *
   * `frame-ancestors 'none'` and X-Frame-Options both appear because the API
   * should never be framed and the two are read by different generations of
   * browser. HSTS is production-only: sending it over plain HTTP in local
   * development would pin localhost to https for six months.
   */
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );
    // Nothing here is a browser-cacheable document, and several endpoints
    // return balances — a shared cache holding one player's is worse than slow.
    reply.header('Cache-Control', 'no-store');
    if (config.env === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    return payload;
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

  registerSupportRoutes(app);

  registerReferralRoutes(app);
  registerVipRoutes(app);
  registerStreakRoutes(app);
  registerRewardsRoutes(app);
  registerRaffleRoutes(app);

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
