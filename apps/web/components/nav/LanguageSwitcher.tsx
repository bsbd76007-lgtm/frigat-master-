'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { LOCALES, useLanguage, type Locale } from '@/components/providers/LanguageProvider';
import { GlobeIcon } from '@/components/icons/ui';
function Caret() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" focusable="false">
      <path
        d="M6 9l6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LanguageSwitcher() {
  const { locale, option, setLocale, t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const close = useCallback((refocus = false) => {
    setIsOpen(false);
    if (refocus) {
      rootRef.current?.querySelector<HTMLButtonElement>('.lang__trigger')?.focus();
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const index = LOCALES.findIndex((item) => item.code === locale);
    itemsRef.current[index < 0 ? 0 : index]?.focus();
  }, [isOpen, locale]);

  const choose = (next: Locale) => {
    setLocale(next);
    close(true);
  };

  const onMenuKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = LOCALES.length - 1;
    let next: number | null = null;

    if (event.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'Escape' || event.key === 'Tab') {
      close(event.key === 'Escape');
      return;
    }

    if (next !== null) {
      event.preventDefault();
      itemsRef.current[next]?.focus();
    }
  };

  return (
    <div className="lang" ref={rootRef}>
      <button
        type="button"
        className="lang__trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={`${t('header.language')}: ${option.label}`}
        onClick={() => setIsOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !isOpen) {
            event.preventDefault();
            setIsOpen(true);
          }
        }}
      >
        {/* A globe, not the active locale's flag. A flag names a country, and
            these are languages: 🇬🇧 for English is wrong for most of the people
            who read it, and the Persian entry would put a flag on a language
            spoken across several states. The globe says "language" without
            making a claim about nationality — and unlike the emoji it renders
            identically everywhere, including the Windows fonts that drop flag
            glyphs entirely. */}
        <span className="lang__globe" aria-hidden="true">
          <GlobeIcon size={15} />
        </span>
        <span className="lang__code">{option.short}</span>
        <span className={isOpen ? 'lang__caret lang__caret--up' : 'lang__caret'}>
          <Caret />
        </span>
      </button>

      {isOpen && (
        <div className="lang__menu" id={menuId} role="menu" aria-label={t('header.language')}>
          {LOCALES.map((item, index) => (
            <button
              key={item.code}
              type="button"
              role="menuitemradio"
              aria-checked={item.code === locale}
              className={
                item.code === locale ? 'lang__item lang__item--on' : 'lang__item'
              }
              ref={(node) => {
                itemsRef.current[index] = node;
              }}
              onClick={() => choose(item.code)}
              onKeyDown={(event) => onMenuKeyDown(event, index)}
              lang={item.code}
              dir={item.dir}
            >
              <span className="lang__flag" aria-hidden="true">
                {item.flag}
              </span>
              <span className="lang__code">{item.short}</span>
              <span className="lang__label">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
