/**
 * FRIGAT — Live support
 *
 *   POST /api/support/message   send a message (player or admin)
 *   GET  /api/support/me        the caller's own open ticket + history
 *   GET  /api/support/tickets   the admin queue (ADMIN only)
 *   POST /api/support/close     close a ticket (ADMIN only)
 *
 * Persist first, then broadcast: the socket frame is a courtesy for clients
 * that happen to be connected, never the record. A dropped frame costs a
 * refresh; a message that was broadcast but not written would be lost for
 * good, and support threads are the last place to be casual about that.
 */

import type { FastifyInstance } from 'fastify';
import { SupportSender, SupportStatus } from '@prisma/client';

import { prisma } from '../config/prisma';
import { identityFromRequest, requireAdmin } from '../http/auth';
import { pushSupportEvent } from '../websocket/socket.server';

/** Long enough for a real problem description, short enough to bound a row. */
const MAX_TEXT = 2000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface SendBody {
  text?: string;
  /** Admins must name the ticket they are replying to. */
  ticketId?: string;
  /** Only used when a signed-out visitor opens a ticket. */
  email?: string;
}

function messageView(row: {
  id: string;
  ticketId: string;
  sender: SupportSender;
  text: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    sender: row.sender,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
  };
}

export function registerSupportRoutes(app: FastifyInstance) {
  /**
   * One open ticket per player. Reusing it is what makes the widget a
   * conversation instead of a stack of one-line tickets.
   */
  async function openTicketFor(userId: string, email: string) {
    const existing = await prisma.supportTicket.findFirst({
      where: { userId, status: SupportStatus.OPEN },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) return existing;
    return prisma.supportTicket.create({
      data: { userId, userEmail: email, status: SupportStatus.OPEN },
    });
  }

  app.post<{ Body: SendBody }>('/api/support/message', async (req, reply) => {
    const identity = identityFromRequest(req);
    const text = String(req.body?.text ?? '').trim();

    if (!text) return reply.code(400).send({ error: 'empty_message' });
    if (text.length > MAX_TEXT) return reply.code(400).send({ error: 'message_too_long' });

    // ── Admin reply ──
    // Dispatched on intent, not on role. A named ticket is a staff reply; no
    // ticket is someone opening their own thread. Branching on the role alone
    // meant an admin using the player widget posted into this arm with nothing
    // to reply to and got `ticket_required` — staff have player accounts too.
    const ticketId = String(req.body?.ticketId ?? '');

    if (identity?.role === 'ADMIN' && ticketId) {
      const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
      if (!ticket) return reply.code(404).send({ error: 'ticket_not_found' });

      const [message] = await prisma.$transaction([
        prisma.supportMessage.create({
          data: { ticketId, sender: SupportSender.ADMIN, text },
        }),
        // Bumps updatedAt, which is how the queue sorts.
        prisma.supportTicket.update({
          where: { id: ticketId },
          data: { status: SupportStatus.OPEN },
        }),
      ]);

      pushSupportEvent('SUPPORT_MESSAGE', messageView(message), ticket.userId);
      return { message: messageView(message) };
    }

    // ── Player message ──
    if (!identity) {
      // A guest still gets through, but only with somewhere to reply to.
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      if (!EMAIL.test(email)) return reply.code(400).send({ error: 'email_required' });

      const ticket = await prisma.supportTicket.create({
        data: { userEmail: email, status: SupportStatus.OPEN },
      });
      const message = await prisma.supportMessage.create({
        data: { ticketId: ticket.id, sender: SupportSender.USER, text },
      });

      pushSupportEvent('SUPPORT_TICKET', { ticketId: ticket.id, userEmail: email }, null);
      pushSupportEvent('SUPPORT_MESSAGE', messageView(message), null);
      return { ticketId: ticket.id, message: messageView(message) };
    }

    const user = await prisma.user.findUnique({
      where: { id: identity.userId },
      select: { email: true },
    });
    if (!user) return reply.code(404).send({ error: 'user_not_found' });

    const ticket = await openTicketFor(identity.userId, user.email);
    const isFirstMessage = ticket.createdAt.getTime() === ticket.updatedAt.getTime();

    const [message] = await prisma.$transaction([
      prisma.supportMessage.create({
        data: { ticketId: ticket.id, sender: SupportSender.USER, text },
      }),
      prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { status: SupportStatus.OPEN },
      }),
    ]);

    if (isFirstMessage) {
      pushSupportEvent(
        'SUPPORT_TICKET',
        { ticketId: ticket.id, userEmail: ticket.userEmail },
        identity.userId
      );
    }
    pushSupportEvent('SUPPORT_MESSAGE', messageView(message), identity.userId);

    return { ticketId: ticket.id, message: messageView(message) };
  });

  /** The caller's own thread — the widget restores from this on open. */
  app.get('/api/support/me', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const ticket = await prisma.supportTicket.findFirst({
      where: { userId: identity.userId, status: SupportStatus.OPEN },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!ticket) return { ticket: null, messages: [] };
    return {
      ticket: { id: ticket.id, status: ticket.status, userEmail: ticket.userEmail },
      messages: ticket.messages.map(messageView),
    };
  });

  /**
   * The admin queue. Open tickets by default, newest activity first, each with
   * its full history so selecting a thread needs no second round trip.
   */
  app.get<{ Querystring: { status?: string; take?: string } }>(
    '/api/support/tickets',
    { preHandler: requireAdmin },
    async (req) => {
      const status =
        req.query.status === 'CLOSED'
          ? SupportStatus.CLOSED
          : req.query.status === 'ALL'
            ? undefined
            : SupportStatus.OPEN;

      const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 200);

      const tickets = await prisma.supportTicket.findMany({
        where: status ? { status } : undefined,
        orderBy: { updatedAt: 'desc' },
        take,
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });

      return {
        tickets: tickets.map((ticket) => ({
          id: ticket.id,
          userId: ticket.userId,
          userEmail: ticket.userEmail,
          status: ticket.status,
          createdAt: ticket.createdAt.toISOString(),
          updatedAt: ticket.updatedAt.toISOString(),
          messages: ticket.messages.map(messageView),
        })),
      };
    }
  );

  app.post<{ Body: { ticketId?: string } }>(
    '/api/support/close',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const ticketId = String(req.body?.ticketId ?? '');
      if (!ticketId) return reply.code(400).send({ error: 'ticket_required' });

      const ticket = await prisma.supportTicket
        .update({ where: { id: ticketId }, data: { status: SupportStatus.CLOSED } })
        .catch(() => null);
      if (!ticket) return reply.code(404).send({ error: 'ticket_not_found' });

      pushSupportEvent(
        'SUPPORT_TICKET',
        { ticketId: ticket.id, userEmail: ticket.userEmail, status: ticket.status },
        ticket.userId
      );
      return { ticket: { id: ticket.id, status: ticket.status } };
    }
  );
}
