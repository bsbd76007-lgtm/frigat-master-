import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How it works — FRIGAT',
  description:
    'How a FRIGAT round is decided: committed seeds, server-side outcomes, and an exact-decimal ledger you can audit.',
};

/**
 * /architecture — public "how it works" showcase.
 *
 * Trust content, not an engineering reference: it explains the properties a
 * player can *check* (the seed commitment, that the browser never decides a
 * result, that balances move in exact decimal) without describing internals
 * that are nobody's business from the outside.
 *
 * Every claim on this page is one the codebase actually holds to, including the
 * uncomfortable one at the bottom — the two practice boards roll in the browser
 * and are marked as such rather than quietly included in "server-decided".
 */
export default function ArchitecturePage() {
  return (
    <>
      <h1 className="info__title">How it works</h1>
      <p className="info__lede">
        A casino asks you to trust that the result was not chosen after you
        placed the bet. FRIGAT is built so you do not have to take that on
        faith: the outcome of every round is committed to before you play, and
        you can check it afterwards yourself.
      </p>

      <section className="info__section">
        <h2>The life of a round</h2>
        <p>
          Four steps, in this order, every time. The order is the point — the
          result exists before your browser draws a single frame of it.
        </p>

        <div className="info__table-wrap" style={{ marginTop: 6 }}>
          <svg
            viewBox="0 0 760 150"
            width="100%"
            height="150"
            role="img"
            aria-label="Round flow: committed seed, server engine resolves, ledger settles, client animates"
            style={{ minWidth: 620 }}
          >
            {[
              { x: 8, title: 'Committed', line1: 'seed pair fixed,', line2: 'hash published' },
              { x: 200, title: 'Resolved', line1: 'engine derives the', line2: 'outcome server-side' },
              { x: 392, title: 'Settled', line1: 'ledger debits and', line2: 'credits atomically' },
              { x: 584, title: 'Animated', line1: 'client draws a result', line2: 'it was handed' },
            ].map((step, i) => (
              <g key={step.title}>
                <rect
                  x={step.x}
                  y={30}
                  width={168}
                  height={86}
                  rx={10}
                  fill="var(--fg-panel-2)"
                  stroke={i === 3 ? 'var(--fg-line-2)' : 'var(--fg-accent)'}
                  strokeWidth={i === 3 ? 1 : 1.5}
                  strokeOpacity={i === 3 ? 1 : 0.55}
                />
                <text
                  x={step.x + 16}
                  y={56}
                  fill="var(--fg-text)"
                  fontSize="14"
                  fontWeight="800"
                >
                  {i + 1}. {step.title}
                </text>
                <text x={step.x + 16} y={78} fill="var(--fg-muted)" fontSize="11.5">
                  {step.line1}
                </text>
                <text x={step.x + 16} y={95} fill="var(--fg-muted)" fontSize="11.5">
                  {step.line2}
                </text>
                {i < 3 && (
                  <path
                    d={`M${step.x + 174} 73 L${step.x + 190} 73`}
                    stroke="var(--fg-accent)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    markerEnd="url(#arrow)"
                  />
                )}
              </g>
            ))}
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 8 8"
                refX="6"
                refY="4"
                markerWidth="5"
                markerHeight="5"
                orient="auto"
              >
                <path d="M0 0 L8 4 L0 8 z" fill="var(--fg-accent)" />
              </marker>
            </defs>
          </svg>
        </div>
      </section>

      <section className="info__section">
        <h2>1 · The seed is committed before you bet</h2>
        <p>
          Each account holds a seed pair. The <b>server seed</b> is generated for
          you and kept secret while the pair is live — but its SHA-256 hash is
          published to you immediately. That hash is a promise: it fixes the seed
          without revealing it.
        </p>
        <p>
          The <b>client seed</b> is yours and you can change it whenever you
          like. A <b>nonce</b> counts up with every bet, so the same pair never
          produces the same roll twice. Outcome = f(server seed, your seed,
          nonce) — and two of those three are yours.
        </p>
        <p>
          A live server seed is never sent to a browser. Anyone holding it could
          compute every future round on that pair, which is why it is disclosed
          only when the pair is rotated.
        </p>
      </section>

      <section className="info__section">
        <h2>2 · The server decides, the browser draws</h2>
        <p>
          Every result is computed on the server from the committed seed before
          your client renders a frame. The reels, the curve, the cards — those
          are choreography over a result that already exists.
        </p>
        <p>
          A message from your browser never carries an outcome. It carries an
          intent — this stake, this game, this target — and the server answers
          with what happened. That is why a modified client, a slow connection
          or a closed tab cannot change what a round paid.
        </p>
      </section>

      <section className="info__section">
        <h2>3 · Money moves in exact decimal</h2>
        <p>
          Balances are stored and transported as exact decimal values to eight
          places, never as floating-point numbers. Floats are fine for graphics
          and wrong for money: they lose fractions of a cent, and those
          fractions are somebody&apos;s.
        </p>
        <p>
          A stake is debited and a win credited inside a single database
          transaction. Either both happen or neither does — there is no window
          in which your stake has left but the result has not landed.
        </p>
      </section>

      <section className="info__section">
        <h2>4 · Check it yourself</h2>
        <p>
          Open the fairness dialog on any game. It shows the hash you were given,
          your client seed and the current nonce. Rotate the pair and the server
          seed is revealed:
        </p>
        <ul className="info__list">
          <li>
            Hash the revealed server seed and compare it against the commitment
            you were shown before you played. If they match, the seed cannot have
            been swapped after the fact.
          </li>
          <li>
            Re-derive any round from the revealed seed, your client seed and that
            round&apos;s nonce, and confirm it produces the result you were paid
            on.
          </li>
        </ul>
        <p>
          Both checks are arithmetic anyone can run — they do not depend on
          trusting this page. <Link href="/rules#fair">The full policy is in the rules</Link>.
        </p>
      </section>

      <section className="info__section">
        <h2>Where this does not apply yet</h2>
        <p>
          Two boards — <b>Chicken Road</b> and <b>Avia Masters</b> — currently
          roll their outcomes in the browser and settle no money. They are
          labelled as practice on the board itself and cannot be played for
          stakes. They will join the scheme above when their engines move
          server-side; until then they are not covered by any of it, and we would
          rather say so here than let the claim quietly cover them.
        </p>
      </section>

      <p className="info__lede" style={{ marginTop: 24 }}>
        <Link className="info__cta" href="/">
          Go to the casino
        </Link>{' '}
        <Link className="info__cta info__cta--ghost" href="/rules">
          Read the rules
        </Link>
      </p>
    </>
  );
}
