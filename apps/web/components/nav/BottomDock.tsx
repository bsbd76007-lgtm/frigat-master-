'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useLanguage } from '@/components/providers/LanguageProvider';
import { DOCK_ICONS } from '@/components/icons/DockIcons';

import { useScrollDirection } from '@/hooks/useScrollDirection';
import { DOCK_ITEMS, type DockItem } from '@/lib/navigation';
import { openPanel } from '@/lib/appPanels';
import type { GameCategory } from '@/lib/gameCatalogue';

interface BottomDockProps {
  category?: GameCategory;
  onCategoryChange?: (next: GameCategory) => void;
}

export function BottomDock({ category, onCategoryChange }: BottomDockProps) {
  const { t, locale } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const visible = useScrollDirection();

  const onHome = pathname === '/';
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  // A route-backed item is active when that route is open; a filter-backed
  // one only while the home grid is actually showing its category.
  const activeIndex = DOCK_ITEMS.findIndex((item) =>
    item.href ? pathname === item.href : onHome && item.category === category
  );

  const measure = useCallback(() => {
    const el = activeIndex >= 0 ? itemRefs.current[activeIndex] : null;
    const list = listRef.current;
    if (!el || !list) {
      setPill(null);
      return;
    }
    setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeIndex]);

  useLayoutEffect(() => {
    measure();
  }, [measure, locale]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (listRef.current) observer.observe(listRef.current);
    return () => observer.disconnect();
  }, [measure]);

  const activate = (item: DockItem) => {
    if (item.panel) {
      openPanel(item.panel);
      return;
    }
    if (item.href) {
      router.push(item.href);
      return;
    }
    if (!item.category) return;
    // Filtering only means anything on the grid; from a game page, navigate
    // home first so the tap is never a no-op.
    if (onHome && onCategoryChange) onCategoryChange(item.category);
    else router.push('/');
  };

  return (
    <nav
      className={visible ? 'dock2' : 'dock2 dock2--hidden'}
      aria-label={t('dock.aria')}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
      {...(visible ? {} : ({ inert: '' } as any))}
    >
      <ul className="dock2__list" ref={listRef}>
        {/* Purely decorative: the active item carries aria-current. Rendered
            before the items so it sits underneath them. */}
        {pill && (
          <li
            className="dock2__pill"
            aria-hidden="true"
            style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
          />
        )}

        {DOCK_ITEMS.map((item, i) => {
          const Icon = DOCK_ICONS[item.id];
          const active = i === activeIndex;
          const label = t(item.labelKey);
          return (
            <li key={item.id}>
              <button
                type="button"
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                className={active ? 'dock2__item dock2__item--on' : 'dock2__item'}
                aria-current={active ? 'page' : undefined}
                aria-label={label}
                onClick={() => activate(item)}
              >
                <span className="dock2__icon">
                  <Icon size={20} />
                </span>
                <span className="dock2__label">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default BottomDock;
