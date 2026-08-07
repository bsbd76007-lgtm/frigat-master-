'use client';

import { useRef } from 'react';

import { motion, useReducedMotion } from 'framer-motion';

import { THEMES, useTheme, type Theme } from '@/components/providers/ThemeProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        d="M20.5 14.4A8.5 8.5 0 0 1 9.6 3.5a8.5 8.5 0 1 0 10.9 10.9Z"
        fill="currentColor"
      />
    </svg>
  );
}

function EclipseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 3.75a8.25 8.25 0 0 1 0 16.5Z" fill="currentColor" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4.4" fill="currentColor" />
      <g
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        fill="none"
      >
        <path d="M12 2.4v2.3M12 19.3v2.3M2.4 12h2.3M19.3 12h2.3" />
        <path d="M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
      </g>
    </svg>
  );
}

const OPTIONS: readonly {
  theme: Theme;
  key: string;
  Icon: () => JSX.Element;
}[] = [
  { theme: 'dark', key: 'header.themeDark', Icon: MoonIcon },
  { theme: 'dim', key: 'header.themeDim', Icon: EclipseIcon },
  { theme: 'light', key: 'header.themeLight', Icon: SunIcon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme, ready } = useTheme();
  const { t } = useLanguage();
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const reduceMotion = useReducedMotion();

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = OPTIONS.length - 1;
    let next: number | null = null;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = index === last ? 0 : index + 1;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = index === 0 ? last : index - 1;
    } else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;

    if (next === null) return;
    event.preventDefault();
    setTheme(OPTIONS[next].theme);
    itemsRef.current[next]?.focus();
  };

  return (
    <div className="theme" role="radiogroup" aria-label={t('header.theme')}>
      {OPTIONS.map((option, index) => {
        const active = ready && option.theme === theme;
        const label = t(option.key);
        return (
          <button
            key={option.theme}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            tabIndex={active || (!ready && index === 0) ? 0 : -1}
            className={active ? 'theme__opt theme__opt--on' : 'theme__opt'}
            ref={(node) => {
              itemsRef.current[index] = node;
            }}
            onClick={() => setTheme(option.theme)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {active && (
              <motion.span
                className="theme__pill"
                layoutId="theme-pill"
                aria-hidden="true"
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 460, damping: 34, mass: 0.7 }
                }
              />
            )}
            <span className="theme__icon">
              <option.Icon />
            </span>
          </button>
        );
      })}
    </div>
  );
}
