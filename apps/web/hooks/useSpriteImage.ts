'use client';

import { useEffect, useRef } from 'react';

export function useSpriteImage(
  dataUri: string
): React.MutableRefObject<HTMLImageElement | null> {
  const ref = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const image = new window.Image();
    let cancelled = false;

    image.onload = () => {
      if (!cancelled) ref.current = image;
    };
    image.onerror = () => {
      if (!cancelled) ref.current = null;
    };
    image.src = dataUri;

    return () => {
      cancelled = true;
      ref.current = null;
    };
  }, [dataUri]);

  return ref;
}

export default useSpriteImage;
