'use client';

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
