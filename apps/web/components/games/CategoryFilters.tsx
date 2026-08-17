'use client';

import { useRef } from 'react';

import { useLanguage } from '@/components/providers/LanguageProvider';

import { CATEGORIES, type GameCategory } from '@/lib/gameCatalogue';

interface CategoryFiltersProps {
  value: GameCategory;
  onChange: (next: GameCategory) => void;
  onSearch?: () => void;
}

export function CategoryFilters({
  value,
  onChange,
  onSearch,
}: CategoryFiltersProps) {
  const { t } = useLanguage();
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();

    const index = CATEGORIES.findIndex((entry) => entry.id === value);
    const next =
      CATEGORIES[(index + delta + CATEGORIES.length) % CATEGORIES.length];
    onChange(next.id);

    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]'
    );
    buttons?.[CATEGORIES.indexOf(next)]?.focus();
  };

  return (
    <div className="pills">
      {onSearch && (
        <button
          type="button"
          className="pills__search"
          onClick={onSearch}
          aria-label={t('home.filters.search')}
          title={t('home.filters.search')}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
            <circle
              cx="10.5"
              cy="10.5"
              r="6.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            />
            <path
              d="M15.5 15.5 21 21"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}

      <div
        className="pills__row"
        ref={listRef}
        role="tablist"
        aria-label={t('home.heading')}
        onKeyDown={onKeyDown}
      >
        {CATEGORIES.map((entry) => {
          const active = entry.id === value;
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={active ? 'pills__pill pills__pill--on' : 'pills__pill'}
              onClick={() => onChange(entry.id)}
            >
              <span className="pills__icon" aria-hidden="true">
                <Icon size={15} />
              </span>
              {t(entry.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default CategoryFilters;
