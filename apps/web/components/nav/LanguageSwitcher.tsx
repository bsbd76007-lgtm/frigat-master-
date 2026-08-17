'use client';

import {

  LOCALES,
  useLanguage,
  type Locale,
} from '@/components/providers/LanguageProvider';

/**
 * Language switch — a segmented EN | RU pill.
 *
 * With two locales a dropdown costs a click to show one alternative, so both
 * sit in view and the active one is highlighted. It is a radiogroup rather
 * than a menu: two mutually exclusive options with one selected is exactly
 * what that role describes, and arrow keys move between them for free.
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLanguage();

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = LOCALES[(index + delta + LOCALES.length) % LOCALES.length];
    setLocale(next.code as Locale);
  };

  return (
    <div className="lang" role="radiogroup" aria-label={t('header.language')}>
      {LOCALES.map((item, index) => {
        const active = item.code === locale;
        return (
          <button
            key={item.code}
            type="button"
            role="radio"
            aria-checked={active}
            // Only the active pill is a tab stop; arrows move within the group.
            tabIndex={active ? 0 : -1}
            className={active ? 'lang__pill lang__pill--on' : 'lang__pill'}
            onClick={() => setLocale(item.code as Locale)}
            onKeyDown={(event) => onKeyDown(event, index)}
            title={item.label}
            lang={item.code}
          >
            {item.short}
          </button>
        );
      })}
    </div>
  );
}
