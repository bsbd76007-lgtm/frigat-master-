import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';

import { prisma } from '../config/prisma';
import { getBalance } from '../services/ledger.service';
import * as chicken from '../engines/chicken.engine';
import { connect as open, seedPlayer, startServer, type Frame } from './helpers/socket';

/**
 * Chicken Road, end to end over the real socket and a real ledger.
 *
 * The engine tests prove the maths; these prove the money: that the stake is
 * taken once, a cashout pays exactly the ladder, a bust pays nothing, and the
 * races a player can provoke by sending two frames at once cannot debit or pay
 * twice. Each round's fate is predicted from the committed seed, so every
 * assertion is exact rather than statistical.
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

const connect = (userId: string) => open(port, userId, 'CHICKEN');

const isType = (type: string) => (f: Frame) => f.type === type && f.data.gameType !== 'CRASH';
const isError = (f: Frame) => f.type === 'ERROR';

/** The round's bust lane, re-derived from the seed the server committed to. */
async function predictBust(accepted: Frame): Promise<number | null> {
  const pair = await prisma.provableSeed.findFirstOrThrow({
    where: { hashedServerSeed: String(accepted.data.hashedServerSeed) },
  });
  return chicken.bustLane('medium', {
    serverSeed: pair.serverSeed,
    clientSeed: String(accepted.data.clientSeed),
    nonce: Number(accepted.data.nonce),
    hashedServerSeed: pair.hashedServerSeed,
  });
}

describe('chicken over the socket', () => {
  it('rejects an unknown mode without taking the stake', async () => {
    const userId = await seedPlayer();
    const p = await connect(userId);
    p.send('BET', { amount: '10.00', currency: 'USD', params: { mode: 'nitro' } });
    const err = await p.next(isError);
    expect(err.data.code).toBe('BAD_PARAMS');
    expect(await getBalance(userId)).toBe('100');
    p.ws.close();
  });

  it('plays rounds to the seed: busts pay nothing, cashouts pay the ladder', async () => {
    const userId = await seedPlayer('1000');
    const p = await connect(userId);
    let expected = new Prisma.Decimal(1000);
    let sawBust = false;
    let sawCashout = false;

    for (let round = 0; round < 40 && !(sawBust && sawCashout); round += 1) {
      p.send('BET', { amount: '10.00', currency: 'USD', params: { mode: 'medium' } });
      const accepted = await p.next(isType('BET_ACCEPTED'));
      expected = expected.minus(10);
      expect(accepted.data.balance).toBe(expected.toString());

      const bust = await predictBust(accepted);
      // Walk two lanes, then cash out if the seed lets the chicken get there.
      const target = 2;
      let lane = 0;
      let busted = false;
      while (lane < target) {
        p.send('STEP');
        const f = await p.next((x) => isType('STATE_UPDATE')(x) || isType('GAME_RESULT')(x));
        lane += 1;
        if (f.type === 'GAME_RESULT') {
          expect(bust).toBe(lane);
          expect(f.data).toMatchObject({ bust: true, payout: '0', lane });
          busted = true;
          sawBust = true;
          break;
        }
        expect(f.data.lane).toBe(lane);
        expect(f.data.multiplier).toBe(chicken.multiplierAt('medium', lane));
      }

      if (!busted) {
        expect(bust === null || bust > target).toBe(true);
        p.send('CASHOUT');
        const result = await p.next(isType('GAME_RESULT'));
        const payout = new Prisma.Decimal(10).mul(chicken.multiplierAt('medium', target));
        expected = expected.plus(payout);
        expect(result.data).toMatchObject({ win: true, lane: target });
        expect(new Prisma.Decimal(String(result.data.payout)).equals(payout)).toBe(true);
        sawCashout = true;
      }
      expect(await getBalance(userId)).toBe(expected.toString());
    }

    expect(sawBust && sawCashout).toBe(true);
    const sessions = await prisma.gameSession.count({ where: { userId, gameType: 'CHICKEN' } });
    expect(sessions).toBeGreaterThanOrEqual(2);
    p.ws.close();
  });

  it('debits once when two BETs are sent back to back', async () => {
    const userId = await seedPlayer();
    const p = await connect(userId);
    const bet = { amount: '10.00', currency: 'USD', params: { mode: 'medium' } };
    p.send('BET', bet);
    p.send('BET', bet);
    await p.next(isType('BET_ACCEPTED'));
    const err = await p.next(isError);
    expect(err.data.code).toBe('GAME_IN_PROGRESS');
    expect(await getBalance(userId)).toBe('90');
    p.ws.close();
  });

  it('pays once when two CASHOUTs are sent back to back', async () => {
    const userId = await seedPlayer('1000');
    const p = await connect(userId);
    // Retry until a round survives its first lane, so there is something to cash.
    for (;;) {
      p.send('BET', { amount: '10.00', currency: 'USD', params: { mode: 'medium' } });
      await p.next(isType('BET_ACCEPTED'));
      p.send('STEP');
      const f = await p.next((x) => isType('STATE_UPDATE')(x) || isType('GAME_RESULT')(x));
      if (f.type === 'STATE_UPDATE') break;
    }
    const before = new Prisma.Decimal(await getBalance(userId));
    p.send('CASHOUT');
    p.send('CASHOUT');
    await p.next(isType('GAME_RESULT'));
    const err = await p.next(isError);
    expect(err.data.code).toBe('NO_ACTIVE_GAME');
    const paid = new Prisma.Decimal(await getBalance(userId)).minus(before);
    expect(paid.equals(new Prisma.Decimal(10).mul(chicken.multiplierAt('medium', 1)))).toBe(true);
    p.ws.close();
  });

  it('resumes a running round on a fresh connection', async () => {
    const userId = await seedPlayer('1000');
    const first = await connect(userId);
    for (;;) {
      first.send('BET', { amount: '5.00', currency: 'USD', params: { mode: 'medium' } });
      await first.next(isType('BET_ACCEPTED'));
      first.send('STEP');
      const f = await first.next((x) => isType('STATE_UPDATE')(x) || isType('GAME_RESULT')(x));
      if (f.type === 'STATE_UPDATE') break;
    }
    first.ws.close();

    const second = await connect(userId);
    const resumed = await second.next(isType('BET_ACCEPTED'));
    expect(resumed.data).toMatchObject({
      resumed: true,
      mode: 'medium',
      lane: 1,
      amount: '5.00',
      multiplier: chicken.multiplierAt('medium', 1),
    });

    // And the round is really this connection's to finish.
    const before = new Prisma.Decimal(await getBalance(userId));
    second.send('CASHOUT');
    const result = await second.next(isType('GAME_RESULT'));
    expect(result.data).toMatchObject({ win: true, lane: 1 });
    const paid = new Prisma.Decimal(await getBalance(userId)).minus(before);
    expect(paid.equals(new Prisma.Decimal(5).mul(chicken.multiplierAt('medium', 1)))).toBe(true);
    second.ws.close();
  });
});
