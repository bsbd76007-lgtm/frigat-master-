import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Rules — FRIGAT',
  description:
    'Terms of service, provably fair policy, age restriction, anti-money-laundering summary and game rules.',
};

/**
 * /rules
 *
 * Section ids are load-bearing: the footer links to #terms, #fair, #age, #aml
 * and #game-rules directly, which is what let those columns stop pointing at
 * /legal/* routes that were never built.
 *
 * The content describes how this platform actually behaves — the seed
 * commitment scheme, the ledger, the engines — rather than boilerplate. The
 * one thing it deliberately does not do is present itself as a reviewed legal
 * instrument; see the note at the top of the page.
 */
export default function RulesPage() {
  return (
    <>
      <h1 className="info__title">Rules &amp; policies</h1>
      <p className="info__lede">
        How play is settled, how outcomes can be checked, and the conditions
        every account agrees to. If something here contradicts what the software
        does, the software is the bug — tell support.
      </p>

      <p className="info__note">
        <b>Draft.</b>
        <span>
          These are the house rules as the platform is currently built. They are
          a plain-English description of live behaviour, not a lawyer-reviewed
          terms of service, privacy policy or licence condition. Have them
          reviewed before the site takes real money in any regulated market.
        </span>
      </p>

      <section className="info__section" id="terms">
        <h2>Terms of service</h2>
        <p>
          Opening an account means you accept these rules. One account per
          person. Accounts are personal: you may not sell, share or transfer
          one, and you are responsible for everything done with your
          credentials.
        </p>
        <h3>Stakes and settlement</h3>
        <ul className="info__list">
          <li>
            <b>Every outcome is decided by the server.</b> The browser animates
            a result it has already been given; nothing you can do in the client
            changes what was rolled.
          </li>
          <li>
            <b>Balances move only through the ledger.</b> A stake is debited
            when the bet is accepted and a win is credited when the round
            settles, both inside a single database transaction.
          </li>
          <li>
            <b>A settled round is final.</b> Where a round is interrupted —
            connection lost mid-hand, server restarted — it settles on the
            outcome already committed to, not on what was on screen.
          </li>
          <li>
            <b>Table limits</b> apply per game and are shown on each bet
            control. Bets outside them are rejected before any money moves.
          </li>
        </ul>
        <h3>Suspension</h3>
        <p>
          Accounts may be frozen where there is evidence of collusion, abuse of
          bonuses, automated play against the game APIs, or where required by
          the AML checks below. A frozen account can still sign in and read its
          history; it cannot place bets or withdraw until the matter is closed.
        </p>
      </section>

      <section className="info__section" id="fair">
        <h2>Provably fair</h2>
        <p>
          Every result comes from a seed pair that is committed to before you
          bet, so the house cannot pick an outcome after seeing your stake and
          you cannot predict one before placing it.
        </p>
        <ul className="info__list">
          <li>
            <b>Server seed.</b> Generated for you and kept secret while the pair
            is live. Its SHA-256 hash is published immediately — that hash is
            the commitment.
          </li>
          <li>
            <b>Client seed.</b> Yours, and changeable at any time from the
            fairness dialog.
          </li>
          <li>
            <b>Nonce.</b> Increments once per bet, so the same pair never
            produces the same roll twice.
          </li>
          <li>
            <b>Reveal.</b> The server seed is disclosed when the pair is
            rotated. Hash it and compare against the commitment you were given
            at the start — if they match, the seed could not have been swapped
            mid-pair.
          </li>
        </ul>
        <p>
          A live server seed is never sent to a browser. Sending one would let
          the holder compute every future round on that pair, which is why the
          reveal only happens on rotation. Rotate your pair whenever you like
          from the fairness dialog on any game.
        </p>
      </section>

      <section className="info__section" id="age">
        <h2>Age restriction</h2>
        <p className="info__note info__note--age">
          <b>18+</b>
          <span>
            This service is for adults only. You must be at least 18, or the
            legal gambling age where you live if that is higher. Accounts found
            to belong to minors are closed and stakes are returned.
          </span>
        </p>
        <p>
          Gambling can be addictive. Set limits before you play, treat losses as
          the cost of the entertainment rather than something to chase, and stop
          when it stops being fun. If it has become a problem, contact support
          to have your account closed — a request to close for that reason is
          never refused and never delayed.
        </p>
      </section>

      <section className="info__section" id="aml">
        <h2>Anti-money-laundering (summary)</h2>
        <p>
          Deposits and withdrawals are monitored. The purpose of these controls
          is to stop the platform being used to move the proceeds of crime, and
          they apply to every account regardless of size or standing.
        </p>
        <ul className="info__list">
          <li>
            <b>Source of funds.</b> We may ask where deposited funds came from,
            and hold a withdrawal until the answer is satisfactory.
          </li>
          <li>
            <b>Identity checks.</b> Verification may be required before a
            withdrawal is released, and may be re-run if account activity
            changes materially.
          </li>
          <li>
            <b>Withdrawal route.</b> Funds return the way they arrived wherever
            possible. Third-party withdrawal addresses are not accepted.
          </li>
          <li>
            <b>Pass-through.</b> Depositing and immediately withdrawing with
            little or no play is treated as a money-transmission attempt, not as
            gambling, and is escalated for review.
          </li>
          <li>
            <b>Reporting.</b> Suspicious activity is reported to the relevant
            authority. We are not permitted to tell you when such a report has
            been made.
          </li>
        </ul>
      </section>

      <section className="info__section" id="game-rules">
        <h2>Game rules</h2>
        <p>
          Each game states its own limits and payouts on the board. The shared
          rules are:
        </p>
        <ul className="info__list">
          <li>
            <b>Crash.</b> A multiplier climbs from 1.00x until it breaks. Cash
            out before the break to take the stake times the multiplier at the
            moment you pressed; if it breaks first, the stake is lost.
          </li>
          <li>
            <b>Mines.</b> Reveal tiles on a grid for a rising multiplier. Any
            mine ends the round. Cash out at any point to bank the current
            value.
          </li>
          <li>
            <b>Dice &amp; Limbo.</b> Pick a target; the payout is priced off the
            chance of hitting it, so a longer shot pays more.
          </li>
          <li>
            <b>Roulette, Keno, Coinflip, Plinko.</b> Standard rules with the
            paytable shown on each board.
          </li>
          <li>
            <b>Slots.</b> Five reels, five fixed paylines. Wins pay left to
            right from reel one; the paytable is on the board.
          </li>
          <li>
            <b>Practice boards.</b> Chicken Road and Avia Masters currently roll
            their outcomes in the browser and settle no money. They are marked
            as practice on the board itself and cannot be played for stakes.
          </li>
        </ul>
        <p>
          Malfunction voids all pays and plays. Where a defect causes a payout
          the paytable does not support, the round is corrected and the ledger
          adjusted, with the adjustment recorded against your account.
        </p>
      </section>

      <p className="info__lede" style={{ marginTop: 24 }}>
        Questions about any of this? <Link href="/promotions">See current promotions</Link>{' '}
        or reach support from the sidebar.
      </p>
    </>
  );
}
