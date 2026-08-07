'use client';

/**
 * FRIGAT — Floating bottom navigation dock
 *
 * A fixed capsule centred at the bottom of the viewport, with a single active
 * pill that slides between items.
 *
 * How the sliding highlight works: one absolutely-positioned element is
 * measured against the active button and transitioned, rather than each item
 * animating its own background. A per-item background cross-fades — it cannot
 * travel — and travel is what the design asks for. The measurement is redone
 * on resize and on language change, because a longer label ("Избранное" vs
 * "Favorites") moves every item after it.
 *
 * On what each item does: FRIGAT has no sportsbook, no live-dealer feed and no
 * favourites column on the user, and /casino, /sports and /live do not exist
 * as routes. Rather than ship six links to 404s, each item filters the game
 * grid to a real category and lands on an empty state that says so. Casino is
 * the whole catalogue; Menu opens the wallet.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useLanguage } from '@/components/providers/LanguageProvider';
import { DOCK_ICONS } from '@/components/icons/DockIcons';

import { useScrollDirection } from '@/hooks/useScrollDirection';
import { DOCK_ITEMS, type DockItem } from '@/lib/navigation';
import { openPanel } from '@/lib/appPanels';
import type { GameCategory } from '@/lib/gameCatalogue';
interface BottomDockProps {
  category?: GameCategory;
  onCategoryChange?: (next: GameCategory) => void;
}


export function BottomDock({ category, onCategoryChange }: BottomDockProps) {
  const { t, locale } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const visible = useScrollDirection();

  const onHome = pathname === '/';
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  const activeIndex = onHome
    ? Math.max(
        0,
        DOCK_ITEMS.findIndex((item) => item.category && item.category === category)
      )
    : -1;

  const measure = useCallback(() => {
    const el = activeIndex >= 0 ? itemRefs.current[activeIndex] : null;
    const list = listRef.current;
    if (!el || !list) {
      setPill(null);
      return;
    }
    setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeIndex]);

  // Layout effect so the pill is placed in the same frame the active item
  // changes; a passive effect lets it paint at the old position first.
  useLayoutEffect(() => {
    measure();
  }, [measure, locale]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (listRef.current) observer.observe(listRef.current);
    return () => observer.disconnect();
  }, [measure]);

  const activate = (item: DockItem) => {
    if (item.panel) {
      openPanel(item.panel);
      return;
    }
    if (!item.category) return;
    // Filtering only means anything on the grid; from a game page, navigate
    // home first so the tap is never a no-op.
    if (onHome && onCategoryChange) onCategoryChange(item.category);
    else router.push('/');
  };

  return (
    // Hidden state is a class, not an inline transform: the dock's base
    // transform differs per breakpoint (translateX(-50%) on desktop, `none`
    // under 640px where it stretches edge to edge), so a hardcoded
    // `translate(-50%, …)` would shove it half its width off-screen on a
    // phone.
    //
    // `inert` keeps the offscreen dock out of the tab order and away from
    // assistive tech — `pointer-events: none` stops the mouse but leaves six
    // buttons keyboard-focusable behind the fold.
    //
    // The cast is load-bearing on React 18: its DOM layer drops `inert={true}`
    // instead of emitting the attribute, so the boolean form silently does
    // nothing (measured — the buttons stayed focusable). The empty string is
    // the form the HTML spec defines and the one that actually blocks focus.
    // @types/react declares the prop as `boolean`, hence the cast; it can go
    // once this upgrades to React 19, which handles the boolean itself.
    <nav
      className={visible ? 'dock2' : 'dock2 dock2--hidden'}
      aria-label={t('dock.aria')}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
      {...(visible ? {} : ({ inert: '' } as any))}
    >
      <ul className="dock2__list" ref={listRef}>
        {/* Purely decorative: the active item carries aria-current. Rendered
            before the items so it sits underneath them. */}
        {pill && (
          <li
            className="dock2__pill"
            aria-hidden="true"
            style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
          />
        )}

        {DOCK_ITEMS.map((item, i) => {
          const Icon = DOCK_ICONS[item.id];
          const active = i === activeIndex;
          const label = t(item.labelKey);
          return (
            <li key={item.id}>
              <button
                type="button"
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                className={active ? 'dock2__item dock2__item--on' : 'dock2__item'}
                aria-current={active ? 'page' : undefined}
                // The label is hidden on narrow viewports, so the button needs
                // an accessible name that survives that.
                aria-label={label}
                onClick={() => activate(item)}
              >
                <span className="dock2__icon">
                  <Icon size={20} />
                </span>
                <span className="dock2__label">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default BottomDock;
