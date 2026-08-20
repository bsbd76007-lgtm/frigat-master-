'use client';

/**
 * FRIGAT — /architecture, client half.
 *
 * Split out of page.tsx for the same reason as RulesContent: `metadata` is a
 * server-component export, `t()` needs the client-side LanguageProvider, and
 * one file cannot be both.
 *
 * Every claim here is one the codebase actually holds to, including the
 * uncomfortable one at the bottom — the two practice boards roll in the browser
 * and are marked as such rather than quietly included in "server-decided".
 */

import Link from 'next/link';

import { useLanguage } from '@/components/providers/LanguageProvider';

export function ArchitectureContent() {
  const { t } = useLanguage();

  // Built inside the component so the labels re-read on a locale switch; a
  // module-level constant would freeze whichever language rendered first.
  const steps = [
    { x: 8, title: t('arch.step1'), line1: t('arch.step1a'), line2: t('arch.step1b') },
    { x: 200, title: t('arch.step2'), line1: t('arch.step2a'), line2: t('arch.step2b') },
    { x: 392, title: t('arch.step3'), line1: t('arch.step3a'), line2: t('arch.step3b') },
    { x: 584, title: t('arch.step4'), line1: t('arch.step4a'), line2: t('arch.step4b') },
  ];

  return (
    <>
      <h1 className="info__title">{t('arch.title')}</h1>
      <p className="info__lede">{t('arch.lede')}</p>

      <section className="info__section">
        <h2>{t('arch.lifeTitle')}</h2>
        <p>{t('arch.lifeBody')}</p>

        <div className="info__table-wrap" style={{ marginTop: 6 }}>
          <svg
            viewBox="0 0 760 150"
            width="100%"
            height="150"
            role="img"
            aria-label={t('arch.diagramAria')}
            style={{ minWidth: 620 }}
          >
            {steps.map((step, i) => (
              <g key={step.title}>
                <rect
                  x={step.x}
                  y={30}
                  width={168}
                  height={86}
                  rx={10}
                  fill="var(--fg-panel-2)"
                  stroke={i === 3 ? 'var(--fg-line-2)' : 'var(--fg-accent)'}
                  strokeWidth={i === 3 ? 1 : 1.5}
                  strokeOpacity={i === 3 ? 1 : 0.55}
                />
                <text
                  x={step.x + 16}
                  y={56}
                  fill="var(--fg-text)"
                  fontSize="14"
                  fontWeight="800"
                >
                  {i + 1}. {step.title}
                </text>
                <text x={step.x + 16} y={78} fill="var(--fg-muted)" fontSize="11.5">
                  {step.line1}
                </text>
                <text x={step.x + 16} y={95} fill="var(--fg-muted)" fontSize="11.5">
                  {step.line2}
                </text>
                {i < 3 && (
                  <path
                    d={`M${step.x + 174} 73 L${step.x + 190} 73`}
                    stroke="var(--fg-accent)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    markerEnd="url(#arrow)"
                  />
                )}
              </g>
            ))}
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 8 8"
                refX="6"
                refY="4"
                markerWidth="5"
                markerHeight="5"
                orient="auto"
              >
                <path d="M0 0 L8 4 L0 8 z" fill="var(--fg-accent)" />
              </marker>
            </defs>
          </svg>
        </div>
      </section>

      <section className="info__section">
        <h2>{t('arch.s1Title')}</h2>
        <p>
          {t('arch.s1p1a')} <b>{t('arch.s1p1b')}</b> {t('arch.s1p1c')}
        </p>
        <p>
          {t('arch.s1p2a')} <b>{t('arch.s1p2b')}</b> {t('arch.s1p2c')}{' '}
          <b>{t('arch.s1p2d')}</b> {t('arch.s1p2e')}
        </p>
        <p>{t('arch.s1p3')}</p>
      </section>

      <section className="info__section">
        <h2>{t('arch.s2Title')}</h2>
        <p>{t('arch.s2p1')}</p>
        <p>{t('arch.s2p2')}</p>
      </section>

      <section className="info__section">
        <h2>{t('arch.s3Title')}</h2>
        <p>{t('arch.s3p1')}</p>
        <p>{t('arch.s3p2')}</p>
      </section>

      <section className="info__section">
        <h2>{t('arch.s4Title')}</h2>
        <p>{t('arch.s4p1')}</p>
        <ul className="info__list">
          <li>{t('arch.s4li1')}</li>
          <li>{t('arch.s4li2')}</li>
        </ul>
        <p>
          {t('arch.s4p2')} <Link href="/rules#fair">{t('arch.s4Link')}</Link>.
        </p>
      </section>

      <section className="info__section">
        <h2>{t('arch.gapTitle')}</h2>
        <p>
          {t('arch.gapBodyA')} <b>{t('games.chicken.name')}</b> {t('arch.gapBodyB')}{' '}
          <b>{t('games.avia-masters.name')}</b> — {t('arch.gapBodyC')}
        </p>
      </section>

      <p className="info__lede" style={{ marginTop: 24 }}>
        <Link className="info__cta" href="/">
          {t('arch.ctaCasino')}
        </Link>{' '}
        <Link className="info__cta info__cta--ghost" href="/rules">
          {t('arch.ctaRules')}
        </Link>
      </p>
    </>
  );
}
