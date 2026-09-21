import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { Prisma, Role } from '@prisma/client';

import { buildApp } from '../../index';
import { config } from '../../config';
import { prisma } from '../../config/prisma';

/**
 * A real server on an ephemeral port and real players on real sockets, for the
 * tests that have to prove the money path end to end rather than the maths.
 */

export type Frame = { type: string; data: Record<string, unknown> };

export async function startServer(): Promise<{ app: FastifyInstance; port: number }> {
  const app = await buildApp({ logger: false });
  await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, port: (app.server.address() as AddressInfo).port };
}

export async function seedPlayer(balance = '100') {
  const user = await prisma.user.create({
    data: {
      email: `sock-${Math.random().toString(16).slice(2)}@test.local`,
      passwordHash: 'x',
      role: Role.USER,
      wallets: { create: { currency: 'USD', balance: new Prisma.Decimal(balance) } },
    },
    select: { id: true },
  });
  return user.id;
}

/** A connected player: every frame is queued, and `next` waits for a match. */
export async function connect(port: number, userId: string, gameType: string) {
  const token = jwt.sign({ userId, role: 'USER', tv: 0 }, config.jwtSecret, {
    expiresIn: '5m',
  });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
  const frames: Frame[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (raw) => {
    frames.push(JSON.parse(raw.toString()) as Frame);
    waiters.splice(0).forEach((wake) => wake());
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const send = (type: string, payload: Record<string, unknown> = {}) =>
    ws.send(JSON.stringify({ type, gameType, payload }));

  /** Removes and returns the first queued frame matching `match`. */
  const next = async (match: (f: Frame) => boolean, ms = 3000): Promise<Frame> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = frames.findIndex(match);
      if (i >= 0) return frames.splice(i, 1)[0];
      if (Date.now() > deadline) {
        throw new Error(`no matching frame; queued: ${JSON.stringify(frames)}`);
      }
      await new Promise<void>((wake) => {
        waiters.push(wake);
        setTimeout(wake, 50);
      });
    }
  };

  // The socket refuses actions until the database has confirmed the session,
  // so poll until a harmless request is answered by anything but NOT_READY.
  // RESUME is that request for games that support it; for the rest the answer
  // is an ERROR that is not NOT_READY, which is just as good a signal.
  for (;;) {
    ws.send(JSON.stringify({ type: 'RESUME', gameType, payload: {} }));
    const f = await next(
      (x) => x.type === 'RESUME_NONE' || x.type === 'BET_ACCEPTED' || x.type === 'ERROR'
    );
    if (f.type === 'BET_ACCEPTED') frames.unshift(f);
    if (f.data.code !== 'NOT_READY') break;
    await new Promise((r) => setTimeout(r, 20));
  }

  return { ws, send, next, frames };
}
