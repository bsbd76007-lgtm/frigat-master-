'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Crown,
  Gift,
  Headphones,
  LayoutGrid,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';

import { GAME_ICONS } from '@/components/icons';
import { useLanguage } from '@/components/providers/LanguageProvider';

import { openPanel } from '@/lib/appPanels';
import { NAV_GROUPS } from '@/lib/navigation';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

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
        <Link className="rail__brand" href="/" onClick={onClose} aria-label="FRIGAT home">
          <Image
            src="/frigat-model.jpg"
            alt="FRIGAT"
            width={1034}
            height={808}
            className="brandmark"
          />
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
            title="Support"
            onClick={() => {
              openPanel('support');
              onClose();
            }}
          >
            <RailIcon name="support" />
            <span className="rail__label">Support</span>
          </button>

          <button
            type="button"
            className="rail__collapse"
            onClick={toggleCollapsed}
            aria-pressed={collapsed}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            {collapsed ? (
              <ChevronRight size={16} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" />
            ) : (
              <ChevronLeft size={16} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" />
            )}
            <span className="rail__label">Collapse</span>
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
  casino: LayoutGrid,
  vip: Crown,
  referrals: UserPlus,
  rewards: Gift,
  architecture: ShieldCheck,
  support: Headphones,
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
 * Category icons, from lucide-react's outline set.
 *
 * These were six hand-drawn SVGs with their own stroke weights and optical
 * sizes, which is why the rail never looked settled — a 2.6 stroke sitting
 * next to a 2 reads as a wobble down the column even though every icon is
 * "18px". One family, one weight, one size fixes that by construction.
 *
 * The bespoke game icons in components/icons/ stay: those are brand artwork
 * for individual titles, not category glyphs, and lucide has no Plinko.
 */
function RailIcon({ name }: { name: RailIconName }) {
  const Icon = RAIL_ICONS[name];
  // absoluteStrokeWidth keeps the stroke at 2 device-independent pixels
  // regardless of the box, so the icons stay optically equal to each other.
  return <Icon size={18} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" />;
}

export default Sidebar;
