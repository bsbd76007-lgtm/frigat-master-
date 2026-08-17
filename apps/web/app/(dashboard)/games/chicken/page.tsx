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
 * and state, and reads the wallet only to display it. The crossing roll still
 * happens in the browser, so this page must not be treated as a real-stakes game
 * until hazard generation moves server-side — nothing here debits the ledger.
 */
export default function ChickenPage() {
  return <ChickenRoad />;
}
