'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import Link from 'next/link';

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type PanInfo,
  type Variants,
} from 'framer-motion';

import { useLanguage } from '@/components/providers/LanguageProvider';
import { HERO_ART } from '@/components/hero/HeroArt';
export type HeroAction = 'deposit' | 'chat' | 'fairness';

export interface HeroCta {
  labelKey: string;
  href?: string;
  action?: HeroAction;
}

export interface HeroSlide {
  id: string;
  eyebrowKey?: string;
  titleKey: string;
  subtitleKey?: string;
  cta: HeroCta;
  secondaryCta?: HeroCta;
  background: string;
  tint?: string;
  accent?: string;
  art?: 'car' | 'vault';
}

export const DEFAULT_SLIDES: HeroSlide[] = [
  {
    id: 'welcome-bonus',
    eyebrowKey: 'hero.welcomeBonus.eyebrow',
    titleKey: 'hero.welcomeBonus.title',
    subtitleKey: 'hero.welcomeBonus.subtitle',
    cta: { labelKey: 'hero.welcomeBonus.cta', action: 'deposit' },
    secondaryCta: { labelKey: 'hero.welcomeBonus.secondaryCta', href: '/vip' },
    background: 'linear-gradient(135deg, #14161b 0%, #0e0f12 100%)',
    tint:
      'radial-gradient(120% 140% at 78% 30%, rgba(255,107,0,.20) 0%, rgba(255,107,0,.05) 45%, transparent 100%)',
    accent: '#ff6b00',
    art: 'car',
  },
  {
    id: 'joy-points',
    eyebrowKey: 'hero.joyPoints.eyebrow',
    titleKey: 'hero.joyPoints.title',
    subtitleKey: 'hero.joyPoints.subtitle',
    cta: { labelKey: 'hero.joyPoints.cta', href: '/vip' },
    background: 'linear-gradient(135deg, #14161b 0%, #0e0f12 100%)',
    tint:
      'radial-gradient(120% 140% at 82% 22%, rgba(240,193,75,.18) 0%, rgba(255,107,0,.05) 48%, transparent 100%)',
    accent: '#ff6b00',
    art: 'vault',
  },
  {
    id: 'tournaments',
    eyebrowKey: 'hero.tournaments.eyebrow',
    titleKey: 'hero.tournaments.title',
    subtitleKey: 'hero.tournaments.subtitle',
    cta: { labelKey: 'hero.tournaments.cta', href: '/vip' },
    secondaryCta: { labelKey: 'hero.tournaments.secondaryCta', href: '/vip' },
    background:
      'linear-gradient(135deg, #14161b 0%, #0e0f12 100%)',
    tint:
      'radial-gradient(120% 140% at 12% 18%, rgba(255,107,0,.14) 0%, rgba(255,107,0,.04) 45%, transparent 100%)',
    accent: '#ff6b00',
  },
  {
    id: 'rakeback',
    eyebrowKey: 'hero.rakeback.eyebrow',
    titleKey: 'hero.rakeback.title',
    subtitleKey: 'hero.rakeback.subtitle',
    cta: { labelKey: 'hero.rakeback.cta', href: '/vip' },
    background:
      'linear-gradient(135deg, #14161b 0%, #0e0f12 100%)',
    tint:
      'radial-gradient(120% 140% at 88% 12%, rgba(255,107,0,.14) 0%, rgba(255,107,0,.04) 45%, transparent 100%)',
    accent: '#ff6b00',
  },
  {
    id: 'daily-spin',
    eyebrowKey: 'hero.dailySpin.eyebrow',
    titleKey: 'hero.dailySpin.title',
    subtitleKey: 'hero.dailySpin.subtitle',
    cta: { labelKey: 'hero.dailySpin.cta', href: '/vip' },
    background:
      'linear-gradient(135deg, #14161b 0%, #0e0f12 100%)',
    tint:
      'radial-gradient(120% 140% at 50% 100%, rgba(255,107,0,.14) 0%, rgba(255,107,0,.04) 45%, transparent 100%)',
    accent: '#ff6b00',
  },
  {
    id: 'crash-game',
    eyebrowKey: 'hero.crash.eyebrow',
    titleKey: 'hero.crash.title',
    subtitleKey: 'hero.crash.subtitle',
    cta: { labelKey: 'hero.crash.cta', href: '/games/crash' },
    background:
      'linear-gradient(135deg, #14161b 0%, #0e0f12 100%)',
    tint:
      'radial-gradient(120% 140% at 75% 25%, rgba(255,107,0,.14) 0%, rgba(255,107,0,.04) 45%, transparent 100%)',
    accent: '#ff6b00',
  },
  {
    id: 'mines-game',
    eyebrowKey: 'hero.mines.eyebrow',
    titleKey: 'hero.mines.title',
    subtitleKey: 'hero.mines.subtitle',
    cta: { labelKey: 'hero.mines.cta', href: '/games/mines' },
    background:
      'linear-gradient(135deg, #14161b 0%, #0e0f12 100%)',
    tint:
      'radial-gradient(120% 140% at 25% 75%, rgba(255,107,0,.14) 0%, rgba(255,107,0,.04) 45%, transparent 100%)',
    accent: '#ff6b00',
  },
  {
    id: 'crypto-deposits',
    eyebrowKey: 'hero.cryptoDeposits.eyebrow',
    titleKey: 'hero.cryptoDeposits.title',
    subtitleKey: 'hero.cryptoDeposits.subtitle',
    cta: { labelKey: 'hero.cryptoDeposits.cta', action: 'deposit' },
    background:
      'linear-gradient(135deg, #14161b 0%, #0e0f12 100%)',
    tint:
      'radial-gradient(120% 140% at 12% 88%, rgba(255,107,0,.14) 0%, rgba(255,107,0,.04) 45%, transparent 100%)',
    accent: '#ff6b00',
  },
  {
    id: 'community-chat',
    eyebrowKey: 'hero.communityChat.eyebrow',
    titleKey: 'hero.communityChat.title',
    subtitleKey: 'hero.communityChat.subtitle',
    cta: { labelKey: 'hero.communityChat.cta', action: 'chat' },
    background:
      'linear-gradient(135deg, #14161b 0%, #0e0f12 100%)',
    tint:
      'radial-gradient(120% 140% at 88% 88%, rgba(255,107,0,.14) 0%, rgba(255,107,0,.04) 45%, transparent 100%)',
    accent: '#ff6b00',
  },
  {
    id: 'provably-fair',
    eyebrowKey: 'hero.provablyFair.eyebrow',
    titleKey: 'hero.provablyFair.title',
    subtitleKey: 'hero.provablyFair.subtitle',
    cta: { labelKey: 'hero.provablyFair.cta', action: 'fairness' },
    background:
      'linear-gradient(135deg, #14161b 0%, #0e0f12 100%)',
    tint:
      'radial-gradient(120% 140% at 50% 0%, rgba(255,107,0,.14) 0%, rgba(255,107,0,.04) 45%, transparent 100%)',
    accent: '#ff6b00',
  },
];

const SWIPE_DISTANCE = 60;
const SWIPE_VELOCITY = 400;

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d={direction === 'left' ? 'M15 5 8 12l7 7' : 'M9 5l7 7-7 7'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeroCtaButton({
  cta,
  className,
  label,
  style,
  onAction,
}: {
  cta: HeroCta;
  className: string;
  label: string;
  style?: React.CSSProperties;
  onAction?: (action: HeroAction) => void;
}) {
  if (cta.action) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        onClick={() => onAction?.(cta.action!)}
      >
        {label}
      </button>
    );
  }
  if (!cta.href) return null;
  return (
    <Link className={className} href={cta.href} style={style}>
      {label}
    </Link>
  );
}

export function HeroCarousel({
  slides = DEFAULT_SLIDES,
  interval = 5000,
  onAction,
}: {
  slides?: HeroSlide[];
  interval?: number;
  onAction?: (action: HeroAction) => void;
}) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [interacting, setInteracting] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);

  const reduceMotion = useReducedMotion();
  const headingId = useId();
  const { t } = useLanguage();

  const count = slides.length;

  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      setDirection(delta >= 0 ? 1 : -1);
      setIndex((current) => (current + delta + count) % count);
    },
    [count]
  );

  const goTo = useCallback(
    (next: number) => {
      setDirection(next > index ? 1 : -1);
      setIndex(next);
    },
    [index]
  );

  useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const paused = interacting || tabHidden || Boolean(reduceMotion);

  useEffect(() => {
    if (paused || count < 2 || interval <= 0) return;
    const timer = window.setTimeout(() => go(1), interval);
    return () => window.clearTimeout(timer);
  }, [index, paused, count, interval, go]);

  if (count === 0) return null;

  const slide = slides[index];
  const accent = slide.accent ?? 'var(--fg-accent)';

  const variants: Variants = reduceMotion
    ? {
        enter: { opacity: 0 },
        center: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        enter: (dir: number) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
        center: { x: 0, opacity: 1 },
        exit: (dir: number) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 0 }),
      };

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    if (offset.x < -SWIPE_DISTANCE || velocity.x < -SWIPE_VELOCITY) go(1);
    else if (offset.x > SWIPE_DISTANCE || velocity.x > SWIPE_VELOCITY) go(-1);
  };

  return (
    <section
      className="hero"
      aria-roledescription="carousel"
      aria-label={t('hero.label')}
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocus={() => setInteracting(true)}
      onBlur={() => setInteracting(false)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(1);
        else if (event.key === 'ArrowLeft') go(-1);
      }}
    >
      <div className="hero__viewport">
        <AnimatePresence initial={false} custom={direction}>
          <motion.article
            key={slide.id}
            className="hero__slide"
            style={{
              background: slide.tint
                ? `${slide.tint}, ${slide.background}`
                : slide.background,
            }}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: 'spring', stiffness: 260, damping: 32 },
              opacity: { duration: 0.28 },
            }}
            drag={reduceMotion ? false : 'x'}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.16}
            onDragEnd={onDragEnd}
            aria-roledescription="slide"
            aria-label={t('hero.position', { position: index + 1, count })}
          >
            <div className="hero__body">
              {slide.eyebrowKey && (
                <span className="hero__eyebrow" style={{ color: accent }}>
                  {t(slide.eyebrowKey)}
                </span>
              )}

              <h2 className="hero__title" id={`${headingId}-${slide.id}`}>
                {t(slide.titleKey)}
              </h2>

              {slide.subtitleKey && <p className="hero__sub">{t(slide.subtitleKey)}</p>}

              <div className="hero__actions">
                <HeroCtaButton
                  cta={slide.cta}
                  className="hero__cta"
                  style={{ background: accent }}
                  label={t(slide.cta.labelKey)}
                  onAction={onAction}
                />
                {slide.secondaryCta && (
                  <HeroCtaButton
                    cta={slide.secondaryCta}
                    className="hero__cta hero__cta--ghost"
                    label={t(slide.secondaryCta.labelKey)}
                    onAction={onAction}
                  />
                )}
              </div>
            </div>

            {slide.art && (() => {
              const Art = HERO_ART[slide.art];
              return (
                <div className="hero__art" aria-hidden="true">
                  <Art accent={accent} />
                </div>
              );
            })()}
          </motion.article>
        </AnimatePresence>

        <div className="hero__pager">
          <button
            type="button"
            className="hero__chevron"
            onClick={() => go(-1)}
            aria-label={t('hero.previous')}
          >
            <Chevron direction="left" />
          </button>

          {/* Not aria-live: the slide count changing every five seconds would
              interrupt a screen reader continuously for no benefit. */}
          <span className="hero__count">
            {index + 1} / {count}
          </span>

          <button
            type="button"
            className="hero__chevron"
            onClick={() => go(1)}
            aria-label={t('hero.next')}
          >
            <Chevron direction="right" />
          </button>
        </div>

        <div className="hero__dots">
          {slides.map((item, position) => (
            <button
              key={item.id}
              type="button"
              className={
                position === index ? 'hero__dot hero__dot--on' : 'hero__dot'
              }
              onClick={() => goTo(position)}
              aria-label={t('hero.goTo', {
                position: position + 1,
                title: t(item.titleKey),
              })}
              aria-current={position === index ? 'true' : undefined}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
