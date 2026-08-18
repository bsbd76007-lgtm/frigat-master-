import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';

import { config } from './config';
import { prisma } from './config/prisma';
import { version as SERVER_VERSION } from '../package.json';
import { registerSocketServer } from './websocket/socket.server';
import { registerSessionGuard } from './http/auth';
import { registerHealthRoutes } from './routes/health.routes';
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

/**
 * Builds the fully-wired app without binding a port.
 *
 * Split out of bootstrap so tests can drive real routes through
 * `app.inject()` — same CORS, same hooks, same handlers, no socket. Anything
 * registered here is therefore covered by the integration suite; anything
 * added only in bootstrap is not.
 */
export async function buildApp(options: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: options.logger === false ? false : {
      level: config.env === 'production' ? 'info' : 'debug',
      transport:
        config.env === 'production'
          ? undefined
          : { target: 'pino-pretty', options: { colorize: true } },
    },
  });

  // Browser calls come from the Next app on another origin. The allow-list is
  // explicit — a wildcard here would let any site read admin JSON using a
  // victim admin's token, and `credentials: true` makes a wildcard illegal in
  // every browser anyway.
  //
  // Resolved per request rather than handed in as a static array so a rejected
  // origin can be logged: a frontend that has been deployed to a new URL fails
  // as a silent browser-side CORS error with nothing in the server log to say
  // why, and that is a genuinely expensive hour to lose.
  await app.register(cors, {
    origin(origin, cb) {
      // Requests with no Origin header are not browser cross-site calls:
      // gateway webhooks, uptime probes and curl all arrive this way. CORS
      // exists to stop one *site* spending another site's credentials, so
      // there is nothing here to withhold.
      if (!origin) return cb(null, true);
      if (config.webOrigins.includes(origin)) return cb(null, true);

      app.log.warn(
        { origin, allowed: config.webOrigins },
        'CORS: rejected an origin that is not on the allow-list'
      );
      // `false`, not an error: the response simply carries no CORS headers and
      // the browser blocks it. Throwing would turn a misconfigured origin into
      // a 500 and bury the cause.
      cb(null, false);
    },
    credentials: true,
    // PUT and OPTIONS join the list the routes actually use: OPTIONS so the
    // preflight reply advertises itself, PUT so adding one later is not a
    // mystery CORS failure.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // The web app sends exactly these two; anything else should have to be
    // added here deliberately.
    allowedHeaders: ['Content-Type', 'Authorization'],
    // Cache the preflight for a day — every authenticated call is preceded by
    // one, and the session guard below costs a database round trip.
    maxAge: 86_400,
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
    server: 'Frigat API',
    version: SERVER_VERSION,
  }));

  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));
  app.get('/ready', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ready' };
  });

  // Public credential endpoints (register / login). Unauthenticated by design.
  // Before every route: verifies the token's signature *and* that its
  // tokenVersion still matches the account. Registered here rather than per
  // route so a new endpoint cannot forget it.
  registerSessionGuard(app);

  registerHealthRoutes(app);

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

  return app;
}

async function bootstrap() {
  const app = await buildApp();

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
  app.log.info(`Frigat server listening on ${config.host}:${config.port}`);
}

// Only when this file *is* the process entry point. Importing it for
// `buildApp` — which the integration tests do — must not bind a port or
// install signal handlers, or every test run would start a real server and
// fight whatever is already on :4000.
if (require.main === module) {
  bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal: failed to start server', err);
    process.exit(1);
  });
}
