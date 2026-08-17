'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSocket } from '@/hooks/useSocket';
import { apiJson, ApiError } from '@/lib/api';

/**
 * FRIGAT — Support console (client half)
 *
 * Split view: the queue on the left, the selected thread on the right.
 *
 * On the socket: the admin shell deliberately does not mount
 * GameSocketProvider, because staff should not be running a player game
 * socket. This opens a narrow one for this page only — it subscribes to the
 * two support frames and nothing else — rather than pulling the whole player
 * provider tree into the admin tree. It also polls on a slow interval, so the
 * queue still refreshes if the socket is down.
 */

export interface SupportMessage {
  id: string;
  ticketId: string;
  sender: 'USER' | 'ADMIN';
  text: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string | null;
  userEmail: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
  messages: SupportMessage[];
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws';
/** Backstop for a dropped socket; the socket is the primary path. */
const POLL_MS = 20_000;

function preview(ticket: SupportTicket): string {
  const last = ticket.messages[ticket.messages.length - 1];
  if (!last) return '—';
  return `${last.sender === 'ADMIN' ? 'You: ' : ''}${last.text}`;
}

function when(iso: string): string {
  const date = new Date(iso);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

export function SupportConsole() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Ticket ids with player messages that arrived while unselected. */
  const [unread, setUnread] = useState<Record<string, number>>({});

  const socket = useSocket({ url: WS_URL });
  const { subscribe } = socket;
  const threadRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const load = useCallback(async () => {
    try {
      const body = await apiJson<{ tickets: SupportTicket[] }>('api/support/tickets');
      setTickets(body.tickets ?? []);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not reach the support queue.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Live messages: fold into the right thread and bump it to the top, which is
  // how the queue is ordered server-side too.
  useEffect(
    () =>
      subscribe('SUPPORT_MESSAGE', (data) => {
        const message = data as unknown as SupportMessage;
        if (!message?.id || !message.ticketId) return;

        setTickets((current) => {
          const index = current.findIndex((t) => t.id === message.ticketId);
          // A thread we have never seen — refetch rather than invent a row.
          if (index === -1) {
            void load();
            return current;
          }
          const ticket = current[index];
          if (ticket.messages.some((m) => m.id === message.id)) return current;

          const updated: SupportTicket = {
            ...ticket,
            messages: [...ticket.messages, message],
            updatedAt: message.createdAt,
          };
          return [updated, ...current.filter((_, i) => i !== index)];
        });

        if (message.sender === 'USER' && selectedRef.current !== message.ticketId) {
          setUnread((current) => ({
            ...current,
            [message.ticketId]: (current[message.ticketId] ?? 0) + 1,
          }));
        }
      }),
    [subscribe, load]
  );

  // A brand-new ticket has no row yet.
  useEffect(() => subscribe('SUPPORT_TICKET', () => void load()), [subscribe, load]);

  const selected = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) ?? null,
    [tickets, selectedId]
  );

  useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [selected?.messages.length, selectedId]);

  const select = (id: string) => {
    setSelectedId(id);
    setUnread((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const reply = useCallback(async () => {
    const text = draft.trim();
    if (!text || !selectedId || sending) return;
    setSending(true);
    setError(null);
    try {
      const body = await apiJson<{ message: SupportMessage }>('api/support/message', {
        method: 'POST',
        body: JSON.stringify({ ticketId: selectedId, text }),
      });
      // The socket frame usually lands first; this is the fallback path.
      if (body?.message) {
        setTickets((current) =>
          current.map((ticket) =>
            ticket.id === selectedId &&
            !ticket.messages.some((m) => m.id === body.message.id)
              ? { ...ticket, messages: [...ticket.messages, body.message] }
              : ticket
          )
        );
      }
      setDraft('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that reply.');
    } finally {
      setSending(false);
    }
  }, [draft, selectedId, sending]);

  const closeTicket = useCallback(async () => {
    if (!selectedId) return;
    try {
      await apiJson('api/support/close', {
        method: 'POST',
        body: JSON.stringify({ ticketId: selectedId }),
      });
      setSelectedId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not close that ticket.');
    }
  }, [selectedId, load]);

  return (
    <div className="supadm">
      <aside className="supadm__queue">
        <div className="supadm__queue-head">
          <span>Open tickets</span>
          <b>{tickets.length}</b>
        </div>

        {loading && tickets.length === 0 ? (
          <p className="supadm__hint">Loading…</p>
        ) : tickets.length === 0 ? (
          <p className="supadm__hint">No open tickets.</p>
        ) : (
          <ul className="supadm__list">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <button
                  type="button"
                  className={`supadm__item${ticket.id === selectedId ? ' supadm__item--on' : ''}`}
                  onClick={() => select(ticket.id)}
                  aria-current={ticket.id === selectedId ? 'true' : undefined}
                >
                  <span className="supadm__item-top">
                    <span className="supadm__email">{ticket.userEmail}</span>
                    <span className="supadm__time">{when(ticket.updatedAt)}</span>
                  </span>
                  <span className="supadm__preview">{preview(ticket)}</span>
                  {unread[ticket.id] ? (
                    <span className="supadm__badge">{unread[ticket.id]}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="supadm__thread">
        {!selected ? (
          <p className="supadm__hint supadm__hint--center">
            Select a ticket to read the conversation.
          </p>
        ) : (
          <>
            <header className="supadm__thread-head">
              <div>
                <b>{selected.userEmail}</b>
                <span className="supadm__thread-sub">
                  {selected.userId ? `Account ${selected.userId}` : 'Guest'} ·{' '}
                  {selected.messages.length} messages
                </span>
              </div>
              <button type="button" className="supadm__close-btn" onClick={closeTicket}>
                Close ticket
              </button>
            </header>

            <div className="supadm__messages" ref={threadRef}>
              {selected.messages.map((message) => (
                <div
                  key={message.id}
                  className={`supadm__msg supadm__msg--${message.sender === 'ADMIN' ? 'admin' : 'user'}`}
                >
                  {message.text}
                  <span className="supadm__msg-meta">
                    {message.sender === 'ADMIN' ? 'Support' : selected.userEmail} ·{' '}
                    {when(message.createdAt)}
                  </span>
                </div>
              ))}
            </div>

            <form
              className="supadm__composer"
              onSubmit={(event) => {
                event.preventDefault();
                void reply();
              }}
            >
              <textarea
                className="supadm__input"
                rows={2}
                placeholder="Type a reply…"
                value={draft}
                disabled={sending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void reply();
                  }
                }}
              />
              <button
                type="submit"
                className="supadm__send"
                disabled={sending || !draft.trim()}
              >
                {sending ? 'Sending…' : 'Send reply'}
              </button>
            </form>
          </>
        )}
      </section>

      {error && (
        <p className="supadm__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default SupportConsole;
