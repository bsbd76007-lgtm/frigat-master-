'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { GAME_ICONS } from '@/components/icons';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useSearch } from '@/components/providers/SearchProvider';
import { useInjectedStyles } from '@/lib/useInjectedStyles';

/**
 * Header game search.
 *
 * Typing filters the home grid through the shared search context and opens a
 * dropdown of matches. The dropdown is a combobox: the input keeps focus while
 * arrow keys move a virtual cursor through the list, which is what lets a
 * player type, pick and press Enter without ever leaving the field.
 */

const STYLE_ID = 'fg-header-search-styles';

const CSS = `
/* margin-inline: auto centres the field in whatever space the brand and the
   cashier controls leave, rather than letting it sit hard against the logo.
   Auto margins on a flex item split the free space evenly on both sides, which
   holds at every width without absolute positioning that could overlap the
   controls on a medium screen. */
.hsearch { position: relative; display: flex; align-items: center; gap: 8px;
  flex: 1 1 360px; min-width: 0; max-width: 460px; margin-inline: auto; }
.hsearch__field { display: flex; align-items: center; gap: 8px; flex: 1 1 auto;
  min-width: 0; padding: 0 10px; background: var(--fg-panel-2); border: 1px solid var(--fg-line);
  border-radius: 10px; transition: border-color .15s ease, box-shadow .15s ease; }
.hsearch__field:focus-within { border-color: var(--fg-accent);
  box-shadow: 0 0 0 3px rgba(245, 158, 11, .16); }
.hsearch__icon { display: flex; color: var(--fg-muted); }
.hsearch__input { flex: 1 1 auto; min-width: 0; padding: 9px 0; font: inherit;
  font-size: 13.5px; color: var(--fg-text); background: transparent; border: 0;
  outline: none; }
.hsearch__input::placeholder { color: var(--fg-muted); }
/* The native search affordance duplicates our own clear button. */
.hsearch__input::-webkit-search-cancel-button { display: none; }
.hsearch__clear { display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0; color: var(--fg-muted);
  background: var(--fg-hover); border: 0; border-radius: 50%; cursor: pointer;
  transition: color .15s ease, background .15s ease; }
.hsearch__clear:hover { color: var(--fg-text); background: var(--fg-hover-2); }
.hsearch__clear:focus-visible { outline: none;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, .35); }

.hsearch__menu { position: absolute; top: calc(100% + 8px); left: 0; right: 0;
  z-index: 60; max-height: 340px; overflow-y: auto; padding: 6px;
  background: var(--fg-panel); border: 1px solid var(--fg-line);
  border-radius: 12px; box-shadow: 0 18px 40px rgba(0, 0, 0, .5); }
.hsearch__option { display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 9px 10px; font: inherit; font-size: 13px; font-weight: 600;
  text-align: start; color: var(--fg-muted); background: transparent; border: 0;
  border-radius: 8px; cursor: pointer;
  transition: background .12s ease, color .12s ease; }
.hsearch__option:hover,
.hsearch__option--active { color: var(--fg-text); background: var(--fg-hover); }
.hsearch__option-icon { display: grid; place-items: center; flex: 0 0 auto;
  width: 28px; height: 28px; background: var(--fg-panel-2); border-radius: 7px; }
.hsearch__option-slug { margin-inline-start: auto; font-size: 11px; font-weight: 500;
  color: var(--fg-dim); }
.hsearch__empty { padding: 16px 12px; font-size: 13px; text-align: center;
  color: var(--fg-muted); }

/* Round trigger beside the field — the click affordance for touch/pointer
   users who would otherwise have to press Enter to act on a query. */
.hsearch__submit { flex: 0 0 auto; display: grid; place-items: center;
  width: 36px; height: 36px; padding: 0; color: #94a3b8; background: #1e293b;
  border: 1px solid var(--fg-line); border-radius: 9999px; cursor: pointer;
  transition: color .15s ease, background .15s ease, border-color .15s ease; }
.hsearch__submit:hover { color: #e2e8f0; background: #263349; border-color: var(--fg-line-2); }
.hsearch__submit:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(245, 158, 11, .35); }

@media (max-width: 720px) { .hsearch { flex-basis: 180px; } }
@media (prefers-reduced-motion: reduce) {
  .hsearch__field, .hsearch__clear, .hsearch__option, .hsearch__submit { transition: none; }
}
`;

export function HeaderSearch() {
  useInjectedStyles(STYLE_ID, CSS);

  const { t } = useLanguage();
  const { query, setQuery, clear, matches, isSearching } = useSearch();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Only offer the dropdown once something has been typed; an empty query
  // matches the whole catalogue, which is the grid's job, not a menu's.
  const showMenu = open && isSearching;

  // A shrinking result list must never leave the cursor past the end.
  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!showMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showMenu]);

  const go = useCallback(
    (slug: string) => {
      setOpen(false);
      clear();
      inputRef.current?.blur();
      router.push(`/games/${slug}`);
    },
    [clear, router]
  );

  /**
   * Shared by the form submit and the round trigger button: act on the
   * highlighted match if one is showing, otherwise just open the dropdown so
   * a tap has something to do even before the player has typed anything.
   */
  const submit = useCallback(() => {
    const picked = matches[cursor];
    if (showMenu && picked) {
      go(picked.entry.slug);
      return;
    }
    setOpen(true);
    inputRef.current?.focus();
  }, [showMenu, matches, cursor, go]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // First Escape closes the menu, a second clears the field — the same
      // two-stage behaviour a native search control has.
      if (showMenu) setOpen(false);
      else if (query) clear();
      return;
    }
    if (!showMenu || matches.length === 0) {
      if (event.key === 'ArrowDown' && isSearching) setOpen(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => (c + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => (c - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = matches[cursor];
      if (picked) go(picked.entry.slug);
    }
  };

  const activeId = showMenu && matches[cursor]
    ? `${listId}-${matches[cursor].entry.slug}`
    : undefined;

  return (
    <div className="hsearch" ref={rootRef}>
      <form
        className="hsearch__field"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <span className="hsearch__icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24">
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </span>

        <input
          ref={inputRef}
          className="hsearch__input"
          type="search"
          autoComplete="off"
          placeholder={t('home.filters.search')}
          aria-label={t('home.filters.search')}
          role="combobox"
          aria-expanded={showMenu}
          aria-controls={showMenu ? listId : undefined}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />

        {query && (
          <button
            type="button"
            className="hsearch__clear"
            aria-label={t('search.clear')}
            onClick={() => {
              clear();
              setOpen(false);
              inputRef.current?.focus();
            }}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </form>

      <button
        type="button"
        className="hsearch__submit"
        aria-label={t('home.filters.search')}
        title={t('home.filters.search')}
        onClick={submit}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>

      {showMenu && (
        <div
          className="hsearch__menu"
          id={listId}
          role="listbox"
          aria-label={t('search.results')}
        >
          {matches.length === 0 ? (
            <p className="hsearch__empty">{t('search.empty')}</p>
          ) : (
            matches.map(({ entry, name }, index) => {
              const Icon = GAME_ICONS[entry.slug];
              return (
                <button
                  key={entry.slug}
                  id={`${listId}-${entry.slug}`}
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  className={
                    index === cursor
                      ? 'hsearch__option hsearch__option--active'
                      : 'hsearch__option'
                  }
                  // Pointer-down would fire before the click and blur the
                  // input, closing the menu out from under the tap.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(entry.slug)}
                >
                  <span className="hsearch__option-icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <span>{name}</span>
                  <span className="hsearch__option-slug">/{entry.slug}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default HeaderSearch;
