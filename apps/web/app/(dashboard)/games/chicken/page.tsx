'use client';

import ChickenRoad from '@/components/games/ChickenRoad';

/**
 * /games/chicken
 *
 * The route sits in the (dashboard) group so it inherits the navbar, sidebar
 * and sign-in gate every other game page gets — the URL is still
 * /games/chicken, since a parenthesised segment is a layout group and not part
 * of the path.
 *
 * Nothing else is needed here: ChickenRoad carries its own board, betting panel
 * and state. Every hop is decided and settled server-side (chicken.engine.ts,
 * via the game socket); the board only animates what the server reports.
 */
export default function ChickenPage() {
  return <ChickenRoad />;
}
