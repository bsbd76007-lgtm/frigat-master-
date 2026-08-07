'use client';

/**
 * FRIGAT — Floating chat launcher
 *
 * A circular icon button in the bottom-right corner.
 *
 * On the vertical offset: the bottom dock is also anchored to the bottom of
 * the viewport, and under 640px it spans the full width — a button at the
 * corner would land on top of it. Rather than pick one fixed offset that is
 * wrong at some size, the button tracks the dock's own scroll visibility: it
 * sits above the dock while the dock is showing, and drops to the corner once
 * the dock has slid away. Both use the same hook, so they cannot disagree.
 *
 * The badge is a hover affordance rather than an unread count. There is no
 * unread state to read — ChatSidebar keeps messages in component state and
 * drops them when it unmounts, so a number here would be invented. When the
 * sidebar gains persistence this is where the real count goes.
 */

import { useLanguage } from '@/components/providers/LanguageProvider';
import { useScrollDirection } from '@/hooks/useScrollDirection';

interface ChatFabProps {
  onOpen: () => void;
  hidden?: boolean;
}

export function ChatFab({ onOpen, hidden = false }: ChatFabProps) {
  const { t } = useLanguage();
  const dockVisible = useScrollDirection();

  const className = [
    'chat-fab',
    dockVisible ? 'chat-fab--raised' : '',
    hidden ? 'chat-fab--gone' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      onClick={onOpen}
      aria-label={t('chat.open')}
      title={t('chat.open')}
      // Keeps the button out of the tab order while the panel is open, so
      // focus does not land on a control the player cannot see.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- React 18 drops inert={true}; see BottomDock
      {...(hidden ? ({ inert: '' } as any) : {})}
    >
      {/* Headset: reads as support rather than as a peer-to-peer chat, which
          is what this room actually is. */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 13.5v-1.6a8 8 0 0 1 16 0v1.6" />
        <path d="M4 13.2h2.1a1 1 0 0 1 1 1v3.4a1 1 0 0 1-1 1H5.4A1.4 1.4 0 0 1 4 17.2z" />
        <path d="M20 13.2h-2.1a1 1 0 0 0-1 1v3.4a1 1 0 0 0 1 1h.7a1.4 1.4 0 0 0 1.4-1.4z" />
        <path d="M20 18.2v.6a2.6 2.6 0 0 1-2.6 2.6H13" />
      </svg>
      <span className="chat-fab__badge" aria-hidden="true" />
    </button>
  );
}

export default ChatFab;
