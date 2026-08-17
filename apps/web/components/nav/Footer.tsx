'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useLanguage } from '@/components/providers/LanguageProvider';

interface FooterLink {
  key: string;
  href: string;
  external?: boolean;
}

interface FooterColumn {
  key: string;
  links: readonly FooterLink[];
}

const TELEGRAM_URL = 'https://t.me/frigat';

const COLUMNS: readonly FooterColumn[] = [
  {
    key: 'footer.brand',
    links: [
      { key: 'footer.aboutUs', href: '/about' },
      { key: 'footer.faq', href: '/faq' },
      { key: 'footer.support', href: '/support' },
      { key: 'footer.affiliates', href: '/affiliates' },
    ],
  },
  {
    key: 'footer.games',
    links: [
      { key: 'nav.crash', href: '/games/crash' },
      { key: 'nav.mines', href: '/games/mines' },
      { key: 'nav.roulette', href: '/games/roulette' },
      { key: 'nav.coinflip', href: '/games/coinflip' },
      { key: 'nav.plinko', href: '/games/plinko' },
      { key: 'nav.dice', href: '/games/dice' },
    ],
  },
  {
    key: 'footer.fair',
    links: [
      { key: 'footer.verifier', href: '/provably-fair/verify' },
      { key: 'footer.calcRules', href: '/provably-fair/calculation' },
      { key: 'footer.serverSeedHash', href: '/provably-fair/server-seed' },
      { key: 'footer.clientSeedGuide', href: '/provably-fair/client-seed' },
    ],
  },
  {
    key: 'footer.info',
    links: [
      { key: 'footer.architecture', href: '/architecture' },
      { key: 'footer.rules', href: '/rules' },
      { key: 'footer.promotions', href: '/promotions' },
      { key: 'footer.partnerProgram', href: '/partner-program' },
      // The /legal/* routes these three used to point at were never built, so
      // every one of them 404'd. /rules carries the same material in anchored
      // sections, which is a real destination rather than a dead link.
      { key: 'footer.terms', href: '/rules#terms' },
      { key: 'footer.responsible', href: '/rules#age' },
      { key: 'footer.gameRules', href: '/rules#game-rules' },
    ],
  },
  {
    key: 'footer.community',
    links: [
      { key: 'footer.revshare', href: '/affiliates/revshare' },
      { key: 'footer.referralDashboard', href: '/referrals' },
      { key: 'footer.telegram', href: TELEGRAM_URL, external: true },
    ],
  },
] as const;

const SOCIALS = [
  {
    name: 'Telegram',
    href: TELEGRAM_URL,
    path: 'M21.9 4.3 2.9 11.6c-1 .4-1 1.8 0 2.2l4.6 1.5 1.8 5.5c.3.8 1.3 1 1.9.4l2.6-2.5 4.6 3.4c.7.5 1.7.1 1.9-.7l3.4-15.6c.2-.9-.7-1.7-1.8-1.5ZM8.6 15.1l9.5-5.9-7.6 6.9-.4 3.3-1.5-4.3Z',
  },
  {
    name: 'X',
    href: 'https://x.com/frigat',
    path: 'M17.7 3h3.3l-7.2 8.3L22.3 21h-6.6l-5.2-6.4L4.6 21H1.3l7.7-8.8L1.7 3h6.8l4.7 5.9L17.7 3Zm-1.2 16h1.8L7.6 4.9H5.7L16.5 19Z',
  },
  {
    name: 'Discord',
    href: 'https://discord.gg/frigat',
    path: 'M19.3 5.6a16.7 16.7 0 0 0-4.1-1.3l-.3.5a12 12 0 0 1 3.6 1.5 15.7 15.7 0 0 0-4.9-.8h-3.2a15.7 15.7 0 0 0-4.9.8 12 12 0 0 1 3.6-1.5l-.3-.5a16.7 16.7 0 0 0-4.1 1.3C2.5 9 1.8 12.3 2 15.6a16.7 16.7 0 0 0 5 2.6l.9-1.4c-.8-.3-1.6-.7-2.3-1.2l.6-.4a11.9 11.9 0 0 0 10.3 0l.6.4c-.7.5-1.4.9-2.3 1.2l.9 1.4a16.7 16.7 0 0 0 5-2.6c.3-3.8-.5-7.1-2.4-10Zm-9.1 8.1c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm5.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z',
  },
  {
    name: 'Instagram',
    href: 'https://instagram.com/frigat',
    path: 'M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.3-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2-.1-1.3-.1-1.7-.1-4.9s0-3.6.1-4.9c.1-1.2.3-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4 1.3-.1 1.7-.1 4.9-.1Zm0 5.8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6.6a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2Zm5.1-6.7a.9.9 0 1 1-1.9 0 .9.9 0 0 1 1.9 0Z',
  },
] as const;

function SocialIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function useCurrentYear() {
  const [year, setYear] = useState(2026);
  useEffect(() => setYear(new Date().getFullYear()), []);
  return year;
}

export function Footer() {
  const { t } = useLanguage();
  const year = useCurrentYear();

  return (
    <footer className="foot" aria-label={t('footer.aria')}>
      <div className="foot__inner">
        <div className="foot__lede">
          <span className="foot__brand">FRIGAT</span>
          <p className="foot__tagline">{t('footer.tagline')}</p>
        </div>

        <nav className="foot__grid">
          {COLUMNS.map((column) => (
            <div className="foot__col" key={column.key}>
              <h2 className="foot__head">{t(column.key)}</h2>
              <ul className="foot__list">
                {column.links.map((link) => (
                  <li key={link.key}>
                    {link.external ? (
                      <a
                        className="foot__link"
                        href={link.href}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {t(link.key)}
                      </a>
                    ) : (
                      <Link className="foot__link" href={link.href}>
                        {t(link.key)}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="foot__bar">
          <p className="foot__copy">
            <span>{t('footer.copyright', { year })}</span>
            <span className="foot__disclaimer">{t('footer.disclaimer')}</span>
          </p>

          <div className="foot__meta">
            <ul className="foot__social" aria-label={t('footer.followUs')}>
              {SOCIALS.map((social) => (
                <li key={social.name}>
                  <a
                    className="foot__social-link"
                    href={social.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={social.name}
                    title={social.name}
                  >
                    <SocialIcon path={social.path} />
                  </a>
                </li>
              ))}
            </ul>

          </div>
        </div>
      </div>
    </footer>
  );
}
