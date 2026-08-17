'use client';

import AviaMasters from '@/components/games/AviaMasters';

/**
 * /games/avia-masters
 *
 * The route sits in the (dashboard) group so it inherits the navbar, sidebar,
 * sign-in gate and the providers the board depends on — `useGameSocket` throws
 * outside them. The parenthesised segment is a layout group, not part of the
 * path, so the URL is /games/avia-masters.
 *
 * AviaMasters carries its own canvas, telemetry and betting panel. It reads the
 * wallet to size the stake and never debits it: the run is rolled in the
 * browser, so this page must not be treated as a real-stakes game until an
 * engine under apps/server/src/engines/ owns the outcome.
 */
export default function AviaMastersPage() {
  return <AviaMasters />;
}
