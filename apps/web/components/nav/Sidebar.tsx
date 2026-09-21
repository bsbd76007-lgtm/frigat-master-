'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GAME_ICONS } from '@/components/icons';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CrownIcon,
  GiftIcon,
  GridIcon,
  HeadphonesIcon,
  ShieldCheckIcon,
  UserPlusIcon,
} from '@/components/icons/ui';
import { useLanguage } from '@/components/providers/LanguageProvider';

import { openPanel } from '@/lib/appPanels';
import { NAV_GROUPS } from '@/lib/navigation';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

/**
 * One rendered size for every glyph in the rail.
 *
 * The chevrons used to draw at 16 while the categories drew at 18. With a
 * viewBox-relative stroke that is two different weights in one column, which
 * is the exact wobble this rail has been fixed for twice. One number, one
 * weight.
 */
const RAIL_ICON_PX = 18;

/** Remembers the collapsed rail between visits. */
const COLLAPSE_KEY = 'frigat.rail.collapsed';

/**
 * Fixed left rail: casino sections over the game list.
 *
 * Only routes that exist are linked. There is no Sports product here, so no
 * Sports entry — a nav item leading to a 404 is worse than an absent one, and
 * on a casino it also advertises a product the platform cannot take a bet on.
 * Support opens the chat panel that already exists rather than a new page.
 */
export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useLanguage();

  // Collapse is desktop chrome and independent of `open`, which is the mobile
  // drawer. Read after mount so the server-rendered markup cannot disagree
  // with localStorage and hydrate mismatched.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* no-op */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* no-op */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // The drawer overlays the page on mobile, so the body must not scroll under
  // it. Desktop keeps its scroll: there the rail is docked, not overlaid.
  useEffect(() => {
    if (!open) return;
    const mobile = window.matchMedia('(max-width: 1024px)').matches;
    if (!mobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      {open && <div className="rail__scrim" onClick={onClose} aria-hidden="true" />}

      <aside
        className={`rail${open ? ' rail--open' : ''}${collapsed ? ' rail--mini' : ''}`}
        aria-label={t('nav.aria')}
      >
        {/* Rail header. The navbar is hidden behind the drawer on mobile, so
            without this the open drawer carried no brand at all. */}
        <Link className="rail__brand" href="/" onClick={onClose} aria-label={t('nav.homeAria')}>
          {/* Monogram only, keyed out of frigat-model.jpg. The full asset
              spells "FRIGAT" beneath the mark, which set the brand name twice
              next to the label below. Already white with real transparency, so
              it needs none of .brandmark's invert treatment. */}
          <Image
            src="/frigat-monogram.png"
            alt=""
            width={400}
            height={345}
            className="rail__mark"
          />
          {/* Hidden by CSS in the collapsed rail, kept in the DOM so the
              destination is still announced. */}
          <span className="rail__word">Frigat</span>
        </Link>

        <div className="rail__scroll">
          <nav className="rail__section">
            <RailLink
              href="/"
              active={pathname === '/'}
              onNavigate={onClose}
              icon={<RailIcon name="casino" />}
              label="Casino"
            />
            <RailLink
              href="/vip"
              active={pathname === '/vip'}
              onNavigate={onClose}
              icon={<RailIcon name="vip" />}
              label="VIP Club"
            />
            <RailLink
              href="/referrals"
              active={pathname === '/referrals'}
              onNavigate={onClose}
              icon={<RailIcon name="referrals" />}
              label={t('nav.referrals')}
            />
            <RailLink
              href="/freemoney"
              active={pathname === '/freemoney'}
              onNavigate={onClose}
              icon={<RailIcon name="rewards" />}
              label={t('nav.freeMoney')}
            />
            <RailLink
              href="/architecture"
              active={pathname === '/architecture'}
              onNavigate={onClose}
              icon={<RailIcon name="architecture" />}
              label={t('nav.architecture')}
            />
          </nav>

          <div className="rail__divider" />

          {/* Grouped by catalogue category. See NAV_GROUPS for why there is no
              Sports section. */}
          {NAV_GROUPS.map((group) => (
            <div className="rail__group" key={group.id}>
              <p className="rail__heading">{group.label}</p>
              <nav className="rail__section">
                {group.games.map((game) => {
                  const href = `/games/${game.slug}`;
                  const Icon = GAME_ICONS[game.slug as keyof typeof GAME_ICONS];
                  return (
                    <RailLink
                      key={game.slug}
                      href={href}
                      active={pathname === href}
                      onNavigate={onClose}
                      icon={
                        <span className="rail__game-icon">
                          {Icon ? <Icon size={18} /> : null}
                        </span>
                      }
                      label={t(game.labelKey)}
                    />
                  );
                })}
              </nav>
            </div>
          ))}
        </div>

        {/* Anchored to the bottom of the rail, out of the scrolling region, so
            support is reachable without scrolling past every game. */}
        <div className="rail__foot">
          <button
            type="button"
            className="rail__link rail__link--support"
            title={t('support.open')}
            onClick={() => {
              openPanel('support');
              onClose();
            }}
          >
            <RailIcon name="support" />
            <span className="rail__label">{t('support.open')}</span>
          </button>

          <button
            type="button"
            className="rail__collapse"
            onClick={toggleCollapsed}
            aria-pressed={collapsed}
            title={collapsed ? t('nav.expandMenu') : t('nav.collapseMenu')}
            aria-label={collapsed ? t('nav.expandMenu') : t('nav.collapseMenu')}
          >
            {collapsed ? (
              <ChevronRightIcon size={RAIL_ICON_PX} aria-hidden="true" />
            ) : (
              <ChevronLeftIcon size={RAIL_ICON_PX} aria-hidden="true" />
            )}
            <span className="rail__label">{t('nav.collapse')}</span>
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * One rail row. The label is always rendered — the collapsed rail hides it in
 * CSS rather than dropping it from the DOM, so a screen reader still announces
 * the destination and `title` gives sighted users a tooltip in mini mode.
 */
type RailIconName = keyof typeof RAIL_ICONS;

/** Name -> glyph. Adding a rail entry means adding a line here, not an SVG. */
const RAIL_ICONS = {
  casino: GridIcon,
  vip: CrownIcon,
  referrals: UserPlusIcon,
  rewards: GiftIcon,
  architecture: ShieldCheckIcon,
  support: HeadphonesIcon,
} as const;

function RailLink({
  href,
  active,
  onNavigate,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  onNavigate: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`rail__link${active ? ' rail__link--on' : ''}`}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={label}
    >
      {icon}
      <span className="rail__label">{label}</span>
    </Link>
  );
}

/**
 * Category icons, drawn in components/icons/ui.
 *
 * These were six hand-drawn SVGs with their own stroke weights and optical
 * sizes, which is why the rail never looked settled — a 2.6 stroke sitting
 * next to a 2 reads as a wobble down the column even though every icon is
 * "18px". They then spent a while as lucide-react, which fixed the wobble by
 * importing someone else's drawing style; these are the same fix without the
 * dependency.
 *
 * Every rail glyph renders at RAIL_ICON_PX, and the shared Glyph draws at 2
 * units on a 24 viewBox, so the whole column resolves to one identical stroke
 * weight. That equality is why the size is a constant here rather than a
 * number typed at each call site — it is load-bearing, not incidental.
 *
 * The bespoke game icons in components/icons/ stay: those are 48px colour
 * illustrations for individual titles, not monochrome category glyphs, and
 * nothing about their weight has to match this column.
 */
function RailIcon({ name }: { name: RailIconName }) {
  const Icon = RAIL_ICONS[name];
  return <Icon size={RAIL_ICON_PX} aria-hidden="true" />;
}

export default Sidebar;
