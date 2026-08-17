'use client';

import SlotMachine from '@/components/games/SlotMachine';

/**
 * /games/slots
 *
 * Inside the (dashboard) group, so the page inherits the navbar, sidebar,
 * sign-in gate and the socket provider — SlotMachine reads the live wallet from
 * `useGameSocket`, and the header balance updates from the BALANCE frame the
 * spin route pushes after settling.
 *
 * Unlike the other instant games, the wager itself goes over REST
 * (`POST /api/games/slots/spin`); the socket is still what carries the balance
 * back. See apps/server/src/routes/games/slots.ts for why.
 */
export default function SlotsPage() {
  return <SlotMachine />;
}
