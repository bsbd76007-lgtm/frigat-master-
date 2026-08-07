'use client';

/**
 * FRIGAT — One-shot stylesheet injection.
 *
 * These game components ship self-contained so they can be dropped into any
 * styling stack. Inline `style` props cannot express `:hover`, `:focus-visible`,
 * media queries or scrollbar pseudo-elements, so each component declares a real
 * stylesheet and injects it into <head> exactly once per document.
 *
 * Consumers who already have a design system can ignore the defaults entirely
 * and target the stable `fg-*` class names, or pass their own `className`.
 */

import { useEffect } from 'react';

const injected = new Set<string>();

export function useInjectedStyles(id: string, css: string): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (injected.has(id) || document.getElementById(id)) {
      injected.add(id);
      return;
    }
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
    injected.add(id);
  }, [id, css]);
}
