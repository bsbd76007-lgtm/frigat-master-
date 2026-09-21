import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';

import { prisma } from '../config/prisma';
import { getBalance } from '../services/ledger.service';
import * as avia from '../engines/avia.engine';
import { connect, seedPlayer, startServer, type Frame } from './helpers/socket';

/**
 * Avia Masters, end to end: one BET is one whole flight, settled in the same
 * frame. Every flight is replayed from the seed the server committed to, so the
 * balance after each one is asserted exactly.
 */

let app: FastifyInstance;
let port: number;

beforeAll(async () => {
  ({ app, port } = await startServer());
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const isResult = (f: Frame) => f.type === 'GAME_RESULT' && f.data.gameType === 'AVIA';

describe('avia over the socket', () => {
  it('settles each flight exactly as the seed says — landings pay, ditches do not', async () => {
    const userId = await seedPlayer('1000');
    const p = await connect(port, userId, 'AVIA');
    let expected = new Prisma.Decimal(1000);
    let sawLand = false;
    let sawDitch = false;

    for (let round = 0; round < 40 && !(sawLand && sawDitch); round += 1) {
      p.send('BET', { amount: '5.00', currency: 'USD', params: {} });
      const result = await p.next(isResult);

      const session = await prisma.gameSession.findFirstOrThrow({
        where: { userId, gameType: 'AVIA' },
        orderBy: { createdAt: 'desc' },
      });
      const flight = avia.fly({
        serverSeed: session.serverSeed,
        clientSeed: session.clientSeed,
        nonce: session.nonce,
        hashedServerSeed: '',
      });

      // What the client animates is exactly what the seed produces.
      const data = result.data.resultData as { landed: boolean; events: unknown[] };
      expect(data.landed).toBe(flight.landed);
      expect(data.events).toEqual(flight.events);

      const payout = flight.landed
        ? new Prisma.Decimal(5).mul(flight.flightMultiplier).toDecimalPlaces(8)
        : new Prisma.Decimal(0);
      expected = expected.minus(5).plus(payout);
      expect(new Prisma.Decimal(String(result.data.payout)).equals(payout)).toBe(true);
      expect(await getBalance(userId)).toBe(expected.toString());

      if (flight.landed) sawLand = true;
      else sawDitch = true;
    }

    expect(sawLand && sawDitch).toBe(true);
    p.ws.close();
  });

  it('refuses a stake the wallet cannot cover, and takes nothing', async () => {
    const userId = await seedPlayer('2');
    const p = await connect(port, userId, 'AVIA');
    p.send('BET', { amount: '5.00', currency: 'USD', params: {} });
    const err = await p.next((f) => f.type === 'ERROR');
    expect(err.data.code).toBe('INSUFFICIENT_FUNDS');
    expect(await getBalance(userId)).toBe('2');
    p.ws.close();
  });
});
