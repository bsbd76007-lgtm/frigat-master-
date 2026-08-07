# 🎰 FRIGAT — Provably Fair Casino Platform

[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![Fastify](https://img.shields.io/badge/Fastify-4-000000?logo=fastify&logoColor=white)](https://fastify.dev)
[![Prisma](https://img.shields.io/badge/Prisma-5-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)

> A full-stack, server-authoritative casino platform with nine in-house game
> engines, a cryptographically verifiable fairness system, and a real-money
> ledger built on exact decimal arithmetic.

---

## 📖 Overview

FRIGAT is an npm-workspaces monorepo split into two applications and one shared
library:

| Workspace | Role | Port |
| --- | --- | --- |
| **`apps/web`** | Next.js 14 App Router frontend (React 18, client components) | `3000` |
| **`apps/server`** | Fastify API + WebSocket game transport | `4000` |
| **`packages/shared`** | Provably-fair primitives and types used by both | — |

The architecture is **server-authoritative by design**. Every outcome — the
crash point, the mine layout, the lane a chicken is hit in — is decided on the
server from a committed seed before the client renders a single frame. The
browser animates a verdict it has already been handed; it never decides one.
Editing the page can change what a player *sees*, never what they are *paid*.

All money movement flows through a single ledger service using
`Decimal(18,8)` — never floating point — so a payout can never drift from the
figure a player was shown.

---

## ✨ Key Features

### 🎲 Nine in-house game engines

No third-party aggregator, no licensed content. Every game is a first-party
engine with its own maths, reachable at `/games/<slug>` and settling through
the audited ledger.

| Game | Engine | RTP | Rendering |
| --- | --- | --- | --- |
| Crash | `crash.engine.ts` | 99.0% | Canvas (`CrashCanvas`) |
| Mines | `mines.engine.ts` | 99.0% | DOM grid |
| Roulette | `roulette.engine.ts` | 97.3% | Canvas (`RouletteCanvas`) |
| Coinflip | `coinflip.engine.ts` | 99.0% | DOM |
| Plinko | `plinko.engine.ts` | 99.0% | Canvas (`PlinkoCanvas`) |
| Dice | `dice.engine.ts` | 99.0% | DOM |
| Limbo | `limbo.engine.ts` | 99.0% | DOM |
| Keno | `keno.engine.ts` | 98.0% | DOM grid |
| Chicken Road | `chicken.engine.ts` | 99.0% | DOM lane board |

> **Note on Roulette's RTP.** 97.3% is not a configured house edge but a
> structural one: a single-zero wheel has 37 pockets and pays 36:1, so
> `36 ÷ 37 = 97.297…`. It is computed, not assumed.

Live RTP is served from **`GET /api/games/rtp`** — the same constants the
engines settle against, so the published figure cannot drift from reality.

### 🐔 Chicken Road

A multi-step crossing game in the same shape as Mines: `BET` opens a round and
fixes the entire road from the seed, `STEP` advances one lane, `CASHOUT`
settles at the running multiplier.

- **Six-lane board** showing the full payout progression, driven by the
  server's own `multiplierTable(difficulty)` — the client computes no payouts.
- **Animated traffic** on a `requestAnimationFrame` loop with per-lane speeds
  and directions, holding 120 FPS through 6× CPU throttling.
- **Round recovery** — a mid-round page reload restores the live round via
  `RESUME` rather than stranding a player with a debited stake.

> The traffic is presentation only. The road is decided at bet time from the
> server seed, so a car's on-screen position cannot make a lane safe or fatal.
> If pixel overlap decided outcomes, pausing the loop in devtools would be an
> exploit.

### 📊 Live bets feed

A two-column feed of real settled rounds — backfilled from
`GET /api/bets/recent` and streamed live over the `LIVE_BET` socket frame.
Every row is a genuine `GameSession`; clicking one opens its fairness record.

Players are shown a stable pseudonymous handle (`Player_a1305f`) derived from a
one-way hash of their user id, because the only human-readable identifier on
the `User` model is an email address that must not be published.

### 🔐 Provably fair

Every round is decided by `HMAC-SHA256(serverSeed, clientSeed:nonce)`. The
hashed server seed is published **before** the bet; the seed itself is revealed
only once its pair is retired — publishing it while active would hand out the
next round's outcome.

The bet-details dialog exposes the commitment, the client seed, and the nonce,
and shows the server seed the moment it is safe to do so.

### 🔥 Daily play streak

Consecutive **UTC calendar days** with at least one settled bet — not a rolling
24-hour window, which would break a streak for a player betting at 23:00 and
then 22:00 the following evening.

- Cashback on the previous day's **net** losses, scaling 3% → 15% by streak
  length, capped per day.
- A paid streak restore, priced per lost day and capped, charged through the
  ledger so it respects the frozen-account gate and lands in transaction
  history.

### 🎡 Daily bonus wheel

One free spin every 24 hours across five weighted segments. The outcome is
drawn on the server and the animation is scheduled to *land* on the returned
segment — a client-side draw would be trivially riggable and would disagree
with the credited balance.

Segment weights are published at **`GET /api/vip/config`**: every prize shown
on the wheel is one a player can actually win.

---

## 🛠 Tech Stack

**Frontend**
- Next.js 14 (App Router) · React 18 · TypeScript 5.5
- Hand-authored CSS with a custom design-token system (three themes:
  `dark` / `dim` / `light`) — **no Tailwind, no CSS framework**
- Framer Motion for transitions; Canvas 2D for Crash, Plinko and Roulette
- i18n across five locales including RTL (en · ru · hy · ka · fa)

**Backend**
- Fastify 4 · `@fastify/websocket` for the game transport
- Prisma 5 ORM · PostgreSQL 16
- Argon2 password hashing · JWT sessions (`jsonwebtoken`, `jose`)
- Cryptomus integration for crypto deposits and payouts

**Shared**
- `@frigat/shared` — provably-fair primitives, game constants, cross-cutting
  types, compiled before either app builds

---

## 🚀 Getting Started

### Prerequisites

| Requirement | Version |
| --- | --- |
| Node.js | `>= 20.0.0` |
| npm | `>= 10` (workspaces) |
| PostgreSQL | `>= 14` (16 recommended) |

### 1. Install

```bash
git clone <repository-url>
cd frigat
npm install
```

Workspaces are installed from the root — do not run `npm install` inside
`apps/*`.

### 2. Environment variables

No `.env.example` ships with the repo yet. Create the files below by hand.

**Root `.env`** — read by the Prisma CLI:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/frigat"
```

**`apps/server/.env`**:

| Key | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Signs session tokens — use a long random value |
| `PORT` | — | API port (defaults to `4000`) |
| `HOST` | — | Bind address (defaults to `0.0.0.0`) |
| `NODE_ENV` | — | `development` \| `production` |
| `REDIS_URL` | — | Reserved for future session/cache use |
| `CRYPTOMUS_MERCHANT_ID` | Payments | Cryptomus merchant identifier |
| `CRYPTOMUS_API_KEY` | Payments | Deposit/invoice API key |
| `CRYPTOMUS_PAYOUT_API_KEY` | Payments | Withdrawal API key |
| `CRYPTOMUS_WEBHOOK_URL` | Payments | Public URL for payment callbacks |
| `CRYPTOMUS_RETURN_URL` | Payments | Post-payment redirect target |

**`apps/web/.env.local`**:

| Key | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | ✅ | e.g. `http://localhost:4000` |
| `NEXT_PUBLIC_WS_URL` | ✅ | e.g. `ws://localhost:4000/ws` |
| `API_URL` | ✅ | Server-side API base for route handlers |
| `JWT_SECRET` | ✅ | Must match the server's, to verify the session cookie |

> ⚠️ **Never commit these files.** `.env` and `.env.*` are gitignored. The
> Cryptomus keys move real money and `JWT_SECRET` grants session forgery — a
> leaked value means rotating credentials, not just a new commit.

### 3. Database setup

```bash
# Apply the existing migrations (recommended)
npx prisma migrate dev

# …or push the schema without generating a migration
npx prisma db push

# Generate the client (run after any schema change)
npm run prisma:generate

# Optional: seed reference data
npm run prisma:seed
```

### 4. Run

The root `dev` script starts **only the API server**. For the full stack, run
both workspaces in separate terminals:

```bash
# Terminal 1 — API + WebSocket on :4000
npm run dev -w apps/server

# Terminal 2 — Next.js frontend on :3000
npm run dev -w apps/web
```

Open **http://localhost:3000**.

### Other commands

| Command | Description |
| --- | --- |
| `npm run build` | Build every workspace |
| `npm run lint` | Lint every workspace |
| `npm test -w apps/server` | Run the engine self-tests |
| `npm run typecheck -w apps/web` | Type-check the frontend |
| `npm run start -w apps/server` | Run the compiled API (`dist/index.js`) |

---

## 📁 Project Structure

```
frigat/
├── apps/
│   ├── server/                  Fastify API + WebSocket transport
│   │   └── src/
│   │       ├── engines/         Nine game engines + provable.ts
│   │       ├── services/        Ledger, bonus, streak, fairness, risk
│   │       ├── http/            REST routes (auth, vip, streak, admin)
│   │       ├── routes/games/    Per-game REST config (rtp, bets, presence)
│   │       ├── websocket/       Socket server, game state, crash rounds
│   │       └── config/          Prisma client, game constants
│   │
│   └── web/                     Next.js 14 App Router frontend
│       ├── app/
│       │   ├── (dashboard)/     Lobby, game routes, VIP, referrals
│       │   ├── (auth)/          Login and registration
│       │   ├── admin/           Operator console
│       │   └── globals.css      Design tokens + all component styles
│       ├── components/
│       │   ├── games/           Game boards, cards, grid, filters
│       │   ├── canvas/          Crash, Plinko, Roulette renderers
│       │   ├── modals/          Wallet, deposit, launcher, bet details
│       │   ├── nav/             Navbar, dock, footer, switchers
│       │   ├── feed/            Live bets, jackpots, presence
│       │   ├── streak/          Streak bar and restore dialog
│       │   ├── icons/           Game and UI icon sets
│       │   └── providers/       Socket, language, theme context
│       ├── hooks/               useSocket, useBalance, useScrollDirection
│       └── lib/                 API client, exact decimal maths, catalogue
│
├── packages/
│   └── shared/                  @frigat/shared — fairness primitives, types
│
└── prisma/
    ├── schema.prisma            11 models
    ├── migrations/              Ordered migration history
    └── seed.ts                  Reference data
```

### Notable modules

| Path | Why it matters |
| --- | --- |
| `apps/server/src/engines/provable.ts` | The HMAC stream every game resolves against |
| `apps/server/src/services/ledger.service.ts` | The single gate all money passes through |
| `apps/server/src/services/provableFair.service.ts` | Seed pairs, nonce, rotation and reveal |
| `apps/web/lib/decimal.ts` | Exact BigInt money maths — no floats reach a balance |
| `apps/web/app/globals.css` | The whole design system in one token file |

---

## 🔒 Security Notes

- **Server-authoritative outcomes.** No client input decides a result. The road,
  the crash point and the mine layout exist before the first frame renders.
- **Exact decimal money.** `Decimal(18,8)` end to end. Payouts are floored, never
  rounded up into money the maths did not earn.
- **Single money gate.** `processBet` enforces the account freeze, wager limits
  and sufficient funds for every game.
- **Idempotent settlement.** Payouts are keyed off the originating bet id, so a
  retried settlement credits a wallet at most once.
- **Conditional seed disclosure.** A server seed is revealed only after its pair
  is retired.

---

## 📄 License

Private and unpublished. All rights reserved.
