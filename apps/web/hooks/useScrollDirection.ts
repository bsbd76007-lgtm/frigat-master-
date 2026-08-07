'use client';

import { useEffect, useRef, useState } from 'react';

const HIDE_AFTER = 100;
const TOP_ZONE = 20;
const UP_GRACE = 6;

export function useScrollDirection(): boolean {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    lastY.current = window.scrollY;

    const evaluate = () => {
      frame.current = null;
      const y = window.scrollY;
      const previous = lastY.current;
      lastY.current = y;

      if (y < TOP_ZONE) {
        setVisible(true);
        return;
      }
      if (y > previous && y > HIDE_AFTER) {
        setVisible(false);
        return;
      }
      if (previous - y > UP_GRACE) setVisible(true);
    };

    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(evaluate);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, []);

  return visible;
}

export default useScrollDirection;
