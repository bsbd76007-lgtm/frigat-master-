'use client';

/**
 * FRIGAT — Scroll-direction visibility
 *
 * Returns whether a bottom-anchored floating element should be showing:
 * hidden once the player scrolls down past a threshold, shown again the moment
 * they scroll up, and always shown at the very top of the page.
 *
 * The listener is passive and does no work of its own — it only stores the
 * latest offset and asks for an animation frame. Reading `scrollY` is cheap,
 * but reacting to every scroll event on a long page means dozens of state
 * updates a second, each one a React render; coalescing to one per frame keeps
 * this off the main thread's critical path during a flick scroll.
 *
 * `UP_GRACE` exists because trackpads and phone rubber-banding emit tiny
 * upward deltas in the middle of a downward scroll. Without it the dock
 * flickers back into view a few times on the way down.
 */

import { useEffect, useRef, useState } from 'react';

const HIDE_AFTER = 100;
const TOP_ZONE = 20;
const UP_GRACE = 6;

export function useScrollDirection(): boolean {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    // Start from wherever the page already is — a reload restores scroll
    // position, so assuming 0 would read the first event as a large jump.
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
