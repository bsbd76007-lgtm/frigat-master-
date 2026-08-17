'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { apiJson, ApiError } from '@/lib/api';
import { useScrollDirection } from '@/hooks/useScrollDirection';
import { useInjectedStyles } from '@/lib/useInjectedStyles';

/**
 * FRIGAT — Live support widget
 *
 * A launcher and a panel. Opening it restores the player's open ticket from
 * `GET /api/support/me`, sending posts to `POST /api/support/message`, and
 * `SUPPORT_MESSAGE` frames on the existing game socket stream replies in.
 *
 * The POST response is not appended directly: the same message arrives as a
 * socket frame, and adding both would double it. Frames are keyed by message
 * id and ignored if already present, so a reconnect that replays one is
 * harmless.
 */

export interface SupportMessage {
  id: string;
  ticketId: string;
  sender: 'USER' | 'ADMIN';
  text: string;
  createdAt: string;
}

interface MeResponse {
  ticket: { id: string; status: string; userEmail: string } | null;
  messages: SupportMessage[];
}

/**
 * Server error codes are wire identifiers, not copy. Mapping them explicitly
 * keeps a raw key like `message_too_long` out of the panel; anything unmapped
 * falls back to the generic line, so a new server code degrades to a sentence
 * rather than leaking itself into the UI.
 */
const ERROR_KEYS: Record<string, string> = {
  empty_message: 'support.errorEmpty',
  message_too_long: 'support.errorTooLong',
  email_required: 'support.errorEmail',
  ticket_required: 'support.errorTicket',
  ticket_not_found: 'support.errorTicket',
  unauthorized: 'support.errorAuth',
  user_not_found: 'support.errorAuth',
};

const STYLE_ID = 'fg-support-chat-styles';

const CSS = `
/* Bottom-right launcher. It used to sit stacked above the community chat's
   own button; with that gone it takes the corner directly, so the -136px that
   cleared the other launcher is now just the dock lift. */
.sup__fab { position: fixed; right: 24px; bottom: 24px; z-index: 998;
  display: flex; align-items: center; gap: 8px; padding: 11px 16px;
  font: inherit; font-size: 13px; font-weight: 700; color: var(--fg-bg);
  background: var(--fg-accent); border: none; border-radius: 999px;
  cursor: pointer; box-shadow: 0 12px 28px rgba(245, 158, 11, .28);
  --sup-lift: 0px; --sup-hide: 0px;
  transform: translateY(calc(var(--sup-lift) + var(--sup-hide)));
  transition: transform .3s ease-in-out, opacity .3s ease-in-out, filter .15s ease; }
.sup__fab--raised { --sup-lift: -136px; }
/* Leaves with the dock on the way down, and goes inert so it cannot be
   tabbed to or clicked while it is off-screen. */
.sup__fab--hidden { --sup-hide: 140px; opacity: 0; pointer-events: none; }
.sup__fab:hover { filter: brightness(1.08); }
.sup__fab:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(245, 158, 11, .4); }
.sup__fab[hidden] { display: none; }
.sup__fab-dot { display: grid; place-items: center; min-width: 18px; height: 18px;
  padding: 0 5px; font-size: 11px; font-weight: 800; color: #fff;
  background: var(--fg-red); border-radius: 999px; }

/* Above the dock's z-index, not below it: at 950 the launcher punched a hole
   through the open panel. */
.sup__panel { position: fixed; right: 24px; bottom: 24px; z-index: 1000;
  display: flex; flex-direction: column; width: min(360px, calc(100vw - 32px));
  height: min(520px, calc(100vh - 120px));
  background: var(--fg-panel); border: 1px solid var(--fg-line);
  border-radius: 16px; overflow: hidden;
  box-shadow: 0 24px 60px rgba(0, 0, 0, .55); }
@media (max-width: 560px) { .sup__panel { right: 12px; left: 12px; width: auto; } }
@media (prefers-reduced-motion: reduce) { .sup__fab { transition: filter .15s ease; } }

.sup__head { display: flex; align-items: flex-start; justify-content: space-between;
  gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--fg-line); }
.sup__title { margin: 0; font-size: 14px; font-weight: 800; color: var(--fg-text); }
.sup__sub { margin: 3px 0 0; font-size: 11.5px; color: var(--fg-muted); }
.sup__close { width: 28px; height: 28px; display: grid; place-items: center;
  color: var(--fg-muted); background: transparent; border: 1px solid var(--fg-line);
  border-radius: 8px; cursor: pointer; }
.sup__close:hover { color: var(--fg-text); background: var(--fg-hover); }
.sup__close:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(245, 158, 11, .35); }

.sup__body { flex: 1 1 auto; overflow-y: auto; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 10px; }
.sup__empty { margin: auto; max-width: 240px; font-size: 12.5px; line-height: 1.55;
  text-align: center; color: var(--fg-muted); }
.sup__msg { max-width: 82%; padding: 9px 12px; font-size: 13px; line-height: 1.45;
  border-radius: 12px; word-break: break-word; white-space: pre-wrap; }
.sup__msg--user { align-self: flex-end; color: var(--fg-bg);
  background: var(--fg-accent); border-bottom-right-radius: 4px; }
.sup__msg--admin { align-self: flex-start; color: var(--fg-text);
  background: var(--fg-panel-2); border: 1px solid var(--fg-line);
  border-bottom-left-radius: 4px; }
.sup__meta { display: block; margin-top: 3px; font-size: 10px; opacity: .7; }

.sup__foot { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--fg-line); }
.sup__input { flex: 1 1 auto; min-width: 0; padding: 10px 12px; font: inherit;
  font-size: 13px; color: var(--fg-text); background: var(--fg-panel-2);
  border: 1px solid var(--fg-line); border-radius: 10px; outline: none; resize: none; }
.sup__input:focus-visible { border-color: var(--fg-accent);
  box-shadow: 0 0 0 3px rgba(245, 158, 11, .16); }
.sup__send { flex: 0 0 auto; padding: 0 16px; font: inherit; font-size: 13px;
  font-weight: 700; color: var(--fg-bg); background: var(--fg-accent);
  border: none; border-radius: 10px; cursor: pointer; }
.sup__send:disabled { opacity: .45; cursor: not-allowed; }
.sup__send:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(245, 158, 11, .4); }
.sup__error { margin: 0; padding: 0 16px 10px; font-size: 12px; color: var(--fg-red); }

@media (prefers-reduced-motion: reduce) { .sup__fab { transition: none; } }
`;

export interface SupportChatProps {
  /** Lets the sidebar's Support control open this panel from outside. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SupportChat({ open: openProp, onOpenChange }: SupportChatProps = {}) {
  useInjectedStyles(STYLE_ID, CSS);

  const { t } = useLanguage();
  const { token, socket } = useGameSocket();
  const { subscribe } = socket;

  // Own state, mirrored to the parent when it is controlling. The widget still
  // works standalone — the launcher below opens it without anyone's help.
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange]
  );
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  // The same hook the dock uses, so the two move in lockstep instead of
  // drifting apart mid-scroll on separate listeners.
  const dockVisible = useScrollDirection();

  const bodyRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  /** Adds a message unless its id is already on screen. */
  const absorb = useCallback((incoming: SupportMessage) => {
    setMessages((current) =>
      current.some((m) => m.id === incoming.id) ? current : [...current, incoming]
    );
  }, []);

  // Live replies. Subscribed whether or not the panel is open, so the badge
  // can count what arrived while it was closed.
  useEffect(() => {
    if (!token) return;
    return subscribe('SUPPORT_MESSAGE', (data) => {
      const message = data as unknown as SupportMessage;
      if (!message?.id || !message.text) return;
      absorb(message);
      if (message.sender === 'ADMIN' && !openRef.current) {
        setUnread((n) => n + 1);
      }
    });
  }, [subscribe, token, absorb]);

  // Restore the thread when the panel opens.
  useEffect(() => {
    if (!open || !token) return;
    let active = true;
    apiJson<MeResponse>('api/support/me')
      .then((body) => {
        if (!active) return;
        setMessages(body.messages ?? []);
        setUnread(0);
      })
      .catch(() => {
        /* an empty thread is the correct fallback */
      });
    return () => {
      active = false;
    };
  }, [open, token]);

  // Pin to the newest message.
  useEffect(() => {
    if (!open) return;
    const node = bodyRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, open]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      // The socket frame delivers the message; `absorb` dedupes if it wins.
      const body = await apiJson<{ message: SupportMessage }>('api/support/message', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      if (body?.message) absorb(body.message);
      setDraft('');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? t(ERROR_KEYS[err.message] ?? 'support.sendError')
          : t('support.sendError')
      );
    } finally {
      setSending(false);
    }
  }, [draft, sending, absorb, t]);

  // Support is tied to an account, so there is nothing to show signed out.
  if (!token) return null;

  if (!open) {
    return (
      <button
        type="button"
        className={`sup__fab ${dockVisible ? 'sup__fab--raised' : 'sup__fab--hidden'}`}
        onClick={() => {
          setOpen(true);
          setUnread(0);
        }}
        aria-label={t('support.open')}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
        </svg>
        {t('support.open')}
        {unread > 0 && <span className="sup__fab-dot">{unread}</span>}
      </button>
    );
  }

  return (
    <div className="sup__panel" role="dialog" aria-label={t('support.title')}>
      <div className="sup__head">
        <div>
          <h2 className="sup__title">{t('support.title')}</h2>
          <p className="sup__sub">{t('support.subtitle')}</p>
        </div>
        <button
          type="button"
          className="sup__close"
          onClick={() => setOpen(false)}
          aria-label={t('support.close')}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="sup__body" ref={bodyRef}>
        {messages.length === 0 ? (
          <p className="sup__empty">{t('support.empty')}</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`sup__msg sup__msg--${message.sender === 'USER' ? 'user' : 'admin'}`}
            >
              {message.text}
              <span className="sup__meta">
                {message.sender === 'ADMIN' ? t('support.agent') : t('support.you')} ·{' '}
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          ))
        )}
      </div>

      {error && <p className="sup__error">{error}</p>}

      <form
        className="sup__foot"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          className="sup__input"
          rows={1}
          placeholder={t('support.placeholder')}
          value={draft}
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline, as in every chat client.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="sup__send" disabled={sending || !draft.trim()}>
          {/* The first message is also what opens the ticket, which is the one
              send that does real work server-side — say so rather than showing
              the same "Sending…" as every later message. */}
          {sending
            ? t(messages.length === 0 ? 'support.starting' : 'support.sending')
            : t('support.send')}
        </button>
      </form>
    </div>
  );
}

export default SupportChat;
