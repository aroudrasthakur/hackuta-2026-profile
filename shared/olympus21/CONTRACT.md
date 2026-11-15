# Olympus 21: module contract

> **Arcade note (2026-11-15):** the arcade runs only the live server
> (`convex/arcade/olympus21.ts`, poker-style matchmaking, humans only, rules in
> `live.ts`). There is no mock adapter, LAN sandbox or phone QR pairing; §8's
> `admin/o21Tables` design is replaced by `arcade/olympus21`. The engine's bots
> remain only to drive the engine's seeded simulation tests; no live table
> seats one.

Olympus 21 is a 2–4 player card game. Each turn you play a card that matches the top card's color or rank, or a Wild. Number cards add to one shared count. Land the count on exactly 21 and you win; push it past 21 and you're out for the round. Each player picks their own bet, and side pots mean you can win from each opponent at most what you bet yourself.

This file is the contract between three parts that are built in parallel:

| Part | Files | Owner |
| --- | --- | --- |
| Rules + engine + bots | `shared/olympus21/*.js`, `tests/o21*.test.mjs` | rules |
| SPA (table + hand screens) | `olympus21/**` | spa |

Everything is plain browser/Node ES modules (no build step, no dependencies), like `minigame/` and `shared/minigame/`. Node ≥ 20. Tests use `node --test` (`npm test` runs `tests/**/*.test.mjs`).

## 1. Rules (`shared/olympus21/rules.js`)

Card codes: color letter + rank. Colors `R` (Ares), `B` (Poseidon), `G` (Athena), `Y` (Zeus). Ranks `1`–`9`, `S` (Skip, "Nobody"), `R` (Reverse, "Charybdis"), `+2` (Sirens). Wild is `W` (Odysseus). Examples: `R7`, `YS`, `BR`, `G+2`, `W`.

```js
export const COLORS = ["R", "B", "G", "Y"];
export const TARGET = 21;
export function buildDeck(): string[]                // 100 cards: per color 1–9 ×2, S ×2, R ×2, +2 ×2; plus W ×4
export function shuffle(cards, rng): string[]        // Fisher–Yates, rng() in [0,1), returns a new array
export const colorOf = (card) => card === "W" ? null : card[0];
export const rankOf  = (card) => card === "W" ? "W" : card.slice(1);
export function valueOf(card): number                // number cards their value; S, R, +2, W add 0
export function canPlay(card, topCard, activeColor): boolean   // W, or same color as activeColor, or same rank as topCard
export function legalCards(hand, topCard, activeColor): string[]
export function scorePlay(count, card): { count, outcome: "win" | "bust" | "continue" }  // bust resets count to 0
export function nextSeat(liveSeats, from, direction, skipOne = false): number   // must handle `from` not in liveSeats, both directions
export function autoMove(hand, topCard, activeColor): { kind: "play", card, color } | { kind: "draw" }  // lowest-value legal card; Wild keeps activeColor
```

`nextSeat` when `from` is not in `liveSeats` (it just busted or left): start from the gap it left. Going up (`direction 1`), the next seat is the first live seat above `from`, wrapping to the lowest. Going down (`-1`), it is the first live seat below `from`, wrapping to the highest.

## 2. Wagers (`shared/olympus21/wagers.js`)

```js
export const MIN_WAGER = 10;
export function resolveWagers(players: { seat, balance, lossRoom, pick: number|null }[]): { wagers: { seat, wager, picked }[], sittingOut: number[] }
  // can't afford MIN_WAGER (min(balance, lossRoom) < 10) → sittingOut
  // pick clamped to [10, floor(min(balance, lossRoom))]
  // no pick → floor(average of clamped picks), clamped to their own range; nobody picked → 10
export function buildPots(wagers): { amount, eligible: number[], level }[]   // poker-style layers
export function settlePots(wagers, winnerSeats): { payouts: Record<seat, number>, deltas: Record<seat, number> }
  // each layer split among eligible winners (remainder 1 pt at a time in seat order);
  // a layer no winner is eligible for is refunded to its eligible players the same way.
  // sum(deltas) === 0 always.
```

## 3. Engine (`shared/olympus21/engine.js`)

One table as a mutable plain object. The engine owns all timers, driven by `tick(now)`; hosts call `tick` every ~200 ms and after each command. It never reads the clock or `Math.random` itself.

```js
export const DEFAULT_TIMINGS = {
  seatLockMs: 15000,   // after the 2nd player sits (or table full → lock now)
  wagerMs: 60000,
  countdownMs: 5000,
  turnMs: 20000,
  resultMs: 15000,     // settled: the PLAY AGAIN window (section 7)
  botThinkMs: [900, 2600],   // [min, max] delay before a bot acts
};
export const HAND_SIZE = 5;
export const PLAY_CAP = 60;
export const DEFAULT_LOSS_CAP = 100;

export function createTable({ id, maxSeats = 4, timings?, rng, now, lossCap = DEFAULT_LOSS_CAP }): Table

// Commands. All return { ok: true } or { ok: false, code } and never throw on bad input.
export function join(table, { id, name, balance, bot = false }, now)    // codes: TABLE_FULL, ALREADY_SEATED, TABLE_CLOSED
export function leave(table, playerId, now)                              // mid-round: hand folded, bet lost (stays in pots)
export function placeWager(table, playerId, amount, now)                 // codes: NOT_SEATED, WAGERS_CLOSED, BET_TOO_SMALL, BET_TOO_BIG
export function play(table, playerId, card, color, now)                  // codes: NOT_YOUR_TURN, NOT_IN_HAND, DOESNT_MATCH, PICK_A_COLOR
export function draw(table, playerId, now)                               // codes: NOT_YOUR_TURN, MUST_PLAY
export function tick(table, now): boolean                                // advances phases/timeouts/bots; true if anything changed
export function closeTable(table, now)                                   // round ends as "closed" (players still in split); no new round

// Views (plain JSON, safe to send over the network).
export function viewFor(table, playerId | null, now): TableView          // playerId null → spectator (no hand)
export function addListener(table, fn): () => void                       // fn() after any state change (commands and tick)
```

Players persist across rounds while seated: `{ id, name, bot, balance, lostThisWindow }`. On the live server a player's balance is their table chips (the 50-point buy-in). `lossRoom = lossCap - lostThisWindow`.

Round flow: `waiting` → (2+ seated: seat-lock timer, or table full → immediately) `wagering` → `countdown` (bets taken from balances) → `turns` (deal 5 each, flip number card as starter, count = its value, first turn = lowest seat) → `settled` (`result` filled, balances paid) → after `resultMs`, `wagering` again if 2+ seated, else `waiting`. A player who joins mid-round sits as `waiting` until the next wager window. Busted, folded, and sitting-out players are skipped. Round ends: count hits 21 (`"21"`), one live player left (`"last"`), `PLAY_CAP` cards played or both piles empty (`"cap"`), `closeTable` (`"closed"`). For "cap"/"closed", everyone still `playing` splits. Draw pile empty → reshuffle played pile except the top card. Action effects: Skip skips the next player; Reverse flips direction (with 2 live players it acts as Skip); +2 makes the next player draw 2 and lose their turn; a bust cancels the busting card's action and resets the count to 0; the card stays on top. Turn timeout runs `autoMove` for that player; 3 timeouts in a row unseats them after the round.

Bots (`shared/olympus21/bots.js`, used by the engine for players with `bot: true`):

```js
export function botWager(rng, { balance, lossRoom }): number | null   // ~20% null (doesn't pick), else 10/20/25/30/50 within range
export function botMove(hand, topCard, activeColor, count, rng): { kind: "play", card, color } | { kind: "draw" }
  // wins with 21 if possible; else the highest card that stays ≤ 20; else an action/Wild (0); else (all bust) lowest number; draw if nothing legal.
  // Wild color: the color the bot holds most of.
```

## 4. `TableView` (what the SPA renders)

```ts
type Seat = {
  seat: number; playerId: string; name: string; bot: boolean; isMe: boolean;
  wager: number | null;          // during wagering: shown once placed (null = not picked yet)
  picked: boolean;
  cardCount: number;
  state: "waiting" | "playing" | "bust" | "won" | "folded" | "sitting_out";
  pointsDelta: number | null;    // others: only once settled; mine: always
  timeouts: number;
};
type Move = { seq: number; seat: number; name: string;
  kind: "play" | "draw" | "bust" | "win" | "timeout" | "skip" | "reverse" | "plus2" | "wild" | "join" | "leave" | "deal" | "ready";   // ready: "Achilles is ready" (PLAY AGAIN, section 7)
  card?: string; count?: number; color?: string; text: string };   // text: plain sentence, e.g. "Ana played R7 → 14"
type TableView = {
  tableId: string;
  status: "waiting" | "wagering" | "countdown" | "turns" | "settled" | "closed";
  roundNo: number;
  now: number;                   // engine time when the view was built
  deadline: number | null;       // end of the current phase: seat lock, wager window, countdown, turn, or next round
  count: number; target: 21;
  topCard: string | null; activeColor: string | null; direction: 1 | -1;
  drawLeft: number;              // count only
  pot: number;
  pots: { amount: number; eligible: number[]; level: number }[];
  turnSeat: number | null;
  minWager: number; maxSeats: number;
  seats: Seat[];                 // sorted by seat
  lastMoves: Move[];             // newest last, up to 8, seq increasing
  result: null | { reason: "21" | "last" | "cap" | "closed"; winners: number[]; deltas: Record<number, number> };
  me: null | {                   // null for spectators / not seated
    playerId: string; seat: number; balance: number;
    lostThisWindow: number; lossCap: number; maxWager: number;   // maxWager = floor(min(balance, lossRoom))
    wager: number | null; picked: boolean;
    myTurn: boolean; canDraw: boolean;                           // canDraw: my turn and nothing playable
    hand: { card: string; playable: boolean; after: number | "win" | "bust" | null }[];   // after: only when myTurn && playable
    history: { roundNo: number; delta: number; reason: string }[];   // newest last, up to 6
  };
};
```

## 5. SPA (`olympus21/`)

```js
import { mountOlympus21 } from "/olympus21/index.js";
const unmount = mountOlympus21(el, {
  adapter,                        // see below
  view: "auto",                   // "table" | "hand" | "auto" (auto: hand on narrow screens < 720 px, table + hand tray otherwise)
  playerName: "Riley",            // optional; used by adapter.join
});
```

Adapter (`src/games/olympus-21/adapters/convexAdapter.js`, on `arcade/olympus21`):

```js
{
  getState(): TableView | null,
  subscribe(listener: (view) => void): () => void,
  join(name?): Promise<{ ok, code? }>,
  leave(): Promise<{ ok, code? }>,
  placeWager(amount): Promise<{ ok, code? }>,
  play(card, color?): Promise<{ ok, code? }>,
  draw(): Promise<{ ok, code? }>,
  dispose(): void,
}
```

## 6. Play again (v2)

Rounds no longer roll on automatically. After a round settles, each player taps **PLAY AGAIN** to be dealt into the next one.

Engine:

```js
export function ready(table, playerId, now)   // codes: NOT_SEATED, TABLE_CLOSED. Idempotent.
```

- Every seated player has `ready: boolean`. `join` sets `ready: true` (sitting down is the intent to play).
- When a round settles, every human's `ready` resets to `false`. Bots become ready after a random `botThinkMs` delay during the settled phase, so their READY ticks appear one by one.
- `ready` can be called at any time while seated. During `settled` or `waiting` it counts toward the next round. During `wagering`, `countdown` or `turns`, a player who is sitting this round out is marked to be dealt into the next one.
- **Start rule.** A new wager window opens when at least 2 seated players are ready, and at least one of them is human. A table with no humans at all (bot-only tests and simulations) needs only the 2 ready players.
  - From `settled`: as soon as every seated player is ready, or at `deadline` (`resultMs`, 15 s), whichever comes first.
  - If the start rule isn't met at the deadline, the table goes to `waiting` (no timer) and starts as soon as it is, re-checked on every `ready`, `join` and `leave`.
  - The first round after players sit down uses the seat-lock flow from section 3, counting only ready players.
- Players who aren't ready when a wager window opens stay seated as `sitting_out` for that round: no bet, no cards, no points change. They're skipped like folded players. Their "ready" press during the round deals them into the next round.
- The 3-timeouts kick still applies to players in a round. Sitting out never counts as a timeout.

View additions:

```ts
Seat.ready: boolean;
TableView.tableKey: string;       // unique per created table: `${id}:${createdAtMs}`; a reset table gets a new key
TableView.me.ready: boolean;
```

Adapter addition: `ready(): Promise<{ ok, code? }>`.

## 7. Tutorial (v2, SPA only)

An animated walkthrough by Techno that covers the board (each element and what it means) and the cards (each card and what it does). It auto-plays once per table per browser: localStorage key `o21-tutorial-seen:<tableKey>`, written when the tutorial finishes or is skipped. A **HOW TO PLAY** button replays it at any time. It never plays automatically while it's your turn or while your bet is still open, and it never blocks the game (SKIP always works, and Esc closes it).

## 8. Real backend on peccary (v3)

The same engine runs inside Convex. Peccary tables are **player vs player with real points**; no bots are ever seated (bot winnings would create or destroy real points).

### Files (overlay, copied into the assembled backend by `scripts/assemble-backend.mjs`)

- `backend/overlay/shared/olympus21/*.js`: **byte-identical copies** of `shared/olympus21/{rules,wagers,bots,engine}.js` (a test enforces it), plus `.d.ts` declarations so `convex dev --typecheck enable` passes.
- `backend/overlay/convex/admin/o21Tables.ts`: hacker-facing query and mutations and the scheduled tick.
- `backend/overlay/convex/admin/o21Windows.ts`: play windows (internal CLI versions required; admin session-token versions like `slotWindows.ts`).
- `backend/overlay/convex/admin/o21Seed.ts`: peccary-only test-account seed (refuses any deployment URL that isn't brazen-peccary-506).
- `backend/overlay/convex/schema.ts`, `backend/overlay/convex/admin/pointsLedger.ts`: **additive edits only** (new tables; one more ledger loop). Never remove or rename a table, field or index.

### Tables (all new)

| Table | Holds |
| --- | --- |
| `o21Windows` | `opensAt`, `closesAt`, `label?`, `cancelledAt?`, `createdAt`; indexes `by_opensAt`, `by_closesAt`. Same rules as slot windows (≤ 6 h, no overlap). |
| `o21Tables` | `windowId`, `tableKey`, `status`, `seatCount`, `state` (the serialized engine table, **secret: no query returns it**), `version`, `wakeAt?`, `createdAt`, `updatedAt`; index `by_window_status`. |
| `o21Hands` | One ledger row per player per round: `checkedInId`, `tableId`, `windowId`, `roundNo`, `wager`, `pointsDelta`, `createdAt`, `settledAt?`; indexes `by_checkedIn_createdAt`, `by_table_round`. `pointsDelta` is `-wager` when bets are taken, and `payout - wager` after settling. `computeLedgerPoints` sums it, so a recomputed balance always equals `checkedIn.points`. |
| `o21Actions` | Dedupe: `checkedInId`, `actionId`, `kind`, `createdAt`; index `by_checkedIn_action`. |

### Balances

Before running any engine command on a table, sync each human player's engine balance from `checkedIn.points`. After it, apply each player's engine balance change to `checkedIn.points` with `pointBalancePatch`, and write or patch their `o21Hands` row for the round, in the same mutation. `lostThisWindow` comes from summing the player's settled `o21Hands` deltas in the window (losses only). Loss cap: 100 per window.

### Timers

Engine timers are driven by a scheduled internal mutation `admin/o21Tables:tick({ tableId })`. After every mutation and tick, compute the table's next wake time (the engine exports `nextWakeAt(table)`: the earliest of `deadline` and any pending bot or ready timer) and schedule `tick` for it unless a tick is already scheduled at or before that time (`wakeAt`). A tick that finds nothing due does nothing. When the window closes, `closeTable` runs.

### Public API (Convex function names)

```ts
// query: everything one hacker's screen needs. Never returns other players' cards or the piles.
admin/o21Tables:getMyTable({ nowBucket?: number }) → {
  status: "no_window" | "teaser" | "live" | "closed";
  window: { opensAt: number; closesAt: number } | null;
  player: { signedIn: boolean; eligible: boolean; checkedIn: boolean; name: string | null; balance: number };
  view: TableView | null;           // section 4 shape, from engine.viewFor; null when not seated
  serverNow: number;
}
// mutations: every one takes a client-generated actionId (dedupe) and returns { ok: boolean, code?: string, serverNow: number }
admin/o21Tables:join({ actionId, name? })         // auto-match: a live-window table with a free seat in "waiting"/"wagering"/"settled", else a new table
admin/o21Tables:leave({ actionId })
admin/o21Tables:placeWager({ actionId, amount })
admin/o21Tables:play({ actionId, card, color? })
admin/o21Tables:draw({ actionId })
admin/o21Tables:ready({ actionId })
// error codes: the engine's, plus NOT_SIGNED_IN, NOT_ELIGIBLE, NOT_CHECKED_IN, NO_WINDOW, DUPLICATE (an already-seen actionId returns { ok: true })

admin/o21Windows:createO21WindowInternal({ opensAt, closesAt, label? }) · cancelO21WindowInternal({ windowId }) · listO21WindowsInternal({})
admin/o21Seed:seedTestPlayersInternal({ players: { email, password, name }[], points: number })   // peccary only; idempotent (an existing account gets its points set and stays checked in)
```

Eligibility uses the same helpers as slots (`getAuthUser`, `isParticipantEligible`, `checkedInForParticipant`). The player's display name is their first name if it's known, otherwise the part of their email before the @.

### SPA adapter

`olympus21/adapters/convexAdapter.js`: `createConvexAdapter({ client, onError? })`, where `client` is a `ConvexClient` from `convex/browser` that is already signed in (the arcade's signed-in `ConvexReactClient`, through `reactClientBridge.ts`). It implements the section 5 adapter on top of `onUpdate(getMyTable)` and the mutations, adding `actionId`s and keeping a clock offset from `serverNow`. It also exposes `getStatus()` → `{ status, window, player }` for the host. The SPA shows "No table open right now" (with the next opening time) when `status` isn't `"live"` and the player isn't seated, and "Sign in on peccary" / "Not checked in" messages from `player`.
