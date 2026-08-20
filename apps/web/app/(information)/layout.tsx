'use client';

/**
 * FRIGAT — Information pages shell
 *
 * `(information)` is a route group, so it is stripped from the URL: this layout
 * serves /rules, /promotions and /partner-program.
 *
 * Deliberately *not* inside `(dashboard)`. That group gates its content on a
 * token read from localStorage, and these pages have to be readable signed out
 * — house rules and an age restriction that only appear once you already have
 * an account are worth nothing. The providers these pages need (theme,
 * language) live in the root layout, and the root layout also renders the
 * footer, so the sitemap is unchanged here.
 *
 * ── On the header ──────────────────────────────────────────────────────────
 * This is a slim public bar, not the dashboard `Navbar`. That component reads
 * `useGameSocket`, whose provider is mounted in the dashboard layout, so
 * rendering it here throws — and throws during prerender, which fails the build
 * rather than one request. It also carries a cashier and a balance, neither of
 * which means anything to a signed-out reader. The bar below is built from the
 * same tokens, so it matches without depending on a live socket.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useInjectedStyles } from '@/lib/useInjectedStyles';
import { useLanguage } from '@/components/providers/LanguageProvider';

const NAV = [
  { href: '/architecture', label: 'How it works' },
  { href: '/promotions', label: 'Promotions' },
  { href: '/partner-program', label: 'Partner program' },
  { href: '/rules', label: 'Rules' },
] as const;

const STYLE_ID = 'fg-information-styles';

const CSS = `
/* Public header, mirroring .dash__header's treatment so the two chromes read as
   one site. */
.infobar { position: sticky; top: 0; z-index: 40; display: flex; align-items: center;
  gap: 18px; flex-wrap: wrap; padding: 10px 18px;
  background: var(--fg-grain), var(--fg-plate), var(--fg-header);
  border-bottom: 1px solid var(--fg-line); backdrop-filter: blur(8px); }
.infobar__brand { display: inline-flex; align-items: center; flex: none;
  font-size: 17px; font-weight: 900; letter-spacing: -.02em; color: var(--fg-text); }
.infobar__nav { display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  margin-inline: auto; }
.infobar__link { padding: 7px 11px; font-size: 13px; font-weight: 600;
  color: var(--fg-muted); border-radius: 8px;
  transition: background-color .15s var(--fg-ease), color .15s var(--fg-ease); }
.infobar__link:hover { color: var(--fg-text); background: var(--fg-hover); }
.infobar__link--on { color: var(--fg-text); background: var(--fg-hover); }
.infobar__cta { flex: none; padding: 8px 16px; font-size: 12.5px; font-weight: 800;
  color: var(--fg-bg); background: var(--fg-accent); border-radius: 999px;
  transition: filter .15s ease, transform .15s ease; }
.infobar__cta:hover { filter: brightness(1.06); transform: translateY(-1px); }

.info { width: 100%; max-width: 940px; margin-inline: auto; padding: 28px 18px 56px;
  box-sizing: border-box; color: var(--fg-text); }

.info__title { margin: 0 0 6px; font-size: 30px; font-weight: 800; letter-spacing: -.02em;
  color: var(--fg-text); }
.info__lede { margin: 0 0 26px; max-width: 70ch; font-size: 14.5px; line-height: 1.65;
  color: var(--fg-muted); }

/* Anchored sections: the footer links straight to these ids, so they need a
   scroll offset clear of the sticky header. */
.info__section { scroll-margin-top: 76px; margin-bottom: 18px; padding: 20px;
  background: var(--fg-panel); border: 1px solid transparent; border-radius: 12px; }
.info__section h2 { margin: 0 0 10px; font-size: 17px; font-weight: 800;
  color: var(--fg-text); }
.info__section h3 { margin: 16px 0 6px; font-size: 13.5px; font-weight: 700;
  color: var(--fg-text); }
.info__section p { margin: 0 0 10px; max-width: 74ch; font-size: 13.5px; line-height: 1.7;
  color: var(--fg-muted); }
.info__section p:last-child { margin-bottom: 0; }
.info__section a { color: var(--fg-accent); }
.info__section a:hover { text-decoration: underline; }

.info__list { margin: 0 0 10px; padding-left: 18px; }
.info__list li { margin-bottom: 6px; font-size: 13.5px; line-height: 1.65;
  color: var(--fg-muted); }
.info__list li:last-child { margin-bottom: 0; }
.info__list b { color: var(--fg-text); font-weight: 700; }

/* Callout for anything a reader must not skim past. */
.info__note { display: flex; gap: 10px; margin: 0 0 18px; padding: 13px 15px;
  font-size: 13px; line-height: 1.6; color: var(--fg-muted);
  background: rgba(224, 176, 85, .08); border: 1px solid rgba(224, 176, 85, .3);
  border-radius: 10px; }
.info__note b { color: var(--fg-gold); }
.info__note--age { background: rgba(240, 97, 109, .08);
  border-color: rgba(240, 97, 109, .35); }
.info__note--age b { color: var(--fg-red); }

.info__grid { display: grid; gap: 14px; grid-template-columns: 1fr; }
@media (min-width: 720px) { .info__grid { grid-template-columns: 1fr 1fr; } }

.info__card { display: flex; flex-direction: column; gap: 8px; padding: 18px;
  background: var(--fg-panel); border: 1px solid transparent; border-radius: 12px; }
.info__card h3 { margin: 0; font-size: 15px; font-weight: 800; color: var(--fg-text); }
.info__card p { margin: 0; font-size: 13px; line-height: 1.6; color: var(--fg-muted); }
.info__card-foot { display: flex; align-items: center; gap: 10px; margin-top: auto;
  padding-top: 12px; }

.info__tag { align-self: flex-start; padding: 3px 9px; font-size: 10.5px; font-weight: 800;
  letter-spacing: .06em; text-transform: uppercase; border-radius: 999px;
  color: var(--fg-bg); background: var(--fg-accent); }
.info__tag--soon { color: var(--fg-muted); background: var(--fg-hover); }

.info__cta { display: inline-flex; align-items: center; justify-content: center;
  padding: 9px 16px; font: inherit; font-size: 13px; font-weight: 800;
  color: var(--fg-bg); background: var(--fg-accent); border: 0; border-radius: 8px;
  cursor: pointer; transition: filter .15s ease, transform .15s ease; }
.info__cta:hover { filter: brightness(1.06); transform: translateY(-1px); }
.info__cta:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(245, 158, 11, .4); }
.info__cta--ghost { color: var(--fg-text); background: var(--fg-hover); }

.info__table { width: 100%; border-collapse: collapse; font-size: 13px; }
.info__table th, .info__table td { padding: 9px 10px; text-align: left;
  border-bottom: 1px solid var(--fg-line); }
.info__table th { font-size: 10.5px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: var(--fg-dim); }
.info__table td { color: var(--fg-muted); }
.info__table td b { color: var(--fg-text); }
.info__table tr:last-child td { border-bottom: 0; }
.info__table-wrap { overflow-x: auto; }
`;

export default function InformationLayout({ children }: { children: ReactNode }) {
  useInjectedStyles(STYLE_ID, CSS);
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <>
      <header className="infobar">
        <Link className="infobar__brand" href="/">
          FRIGAT
        </Link>

        <nav className="infobar__nav" aria-label={t('nav.infoAria')}>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`infobar__link${
                pathname === item.href ? ' infobar__link--on' : ''
              }`}
              aria-current={pathname === item.href ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link className="infobar__cta" href="/">
          Play now
        </Link>
      </header>

      <main className="info">{children}</main>
    </>
  );
}
