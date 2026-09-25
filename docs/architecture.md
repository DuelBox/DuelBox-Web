# Architecture

Four layers, and one question that decides which of them a change belongs in:

**How many games does this change serve?** One game's rules go in that game. Something two
games would both need goes in the SDK or the engine. If a change to `apps/web` would have to
be repeated for the hundred-and-eighth game, it is in the wrong place.

That is not a style preference. All seven games built before the shared palette existed had
invented their own seat colours — four palettes, two of them disagreeing about which player
was the warm colour, so the scoreboard named a colour that was not on the board. One
`SEAT_PALETTE` in the engine fixed all seven. The same fix after 107 games exist would have
been 107 corrections.

## The layers

```
                      the browser
                           │
 ┌─────────────────────────┴──────────────────────────┐
 │ apps/web — the shell                               │
 │                                                    │
 │  routes: /  /games  /games/[slug]  /play/[slug]     │
 │          /how-to-play  /privacy  /terms             │
 │                                                    │
 │  components/GameHost   owns canvas, listeners,      │
 │                        resize, loop, renderer       │
 │  data/registry.ts      id → dynamic import()        │
 │  data/catalogue.generated.ts   metadata, no code    │
 └───────────┬────────────────────────────┬───────────┘
             │ Game contract              │ engine types
             ▼                            ▼
 ┌───────────────────────────┐  ┌────────────────────────────┐
 │ packages/game-sdk         │  │ packages/engine            │
 │                           │  │                            │
 │ contract.ts  Game,        │  │ loop.ts     fixed timestep │
 │              GameModule   │  │ seat.ts     seats, zones,  │
 │ manifest.ts  schema       │  │             rotation       │
 │ match.ts     the match    │  │ input.ts    pointer, keys  │
 │              state machine│  │ renderer.ts logical units  │
 │ win-conditions.ts         │  │ collision.ts, vec2.ts      │
 │ bot-judgement.ts          │  │ viewport.ts letterboxing   │
 │ search-budget.ts          │  │ rng.ts      seeded only    │
 │ player-text.ts            │  │ palette.ts  SEAT_PALETTE   │
 │ gesture.ts                │  │ audio.ts, synth.ts         │
 └───────────┬───────────────┘  └────────────┬───────────────┘
             │                               │
             └───────────────┬───────────────┘
                             ▼
            ┌────────────────────────────────────┐
            │ packages/games/<id>                │
            │                                    │
            │ manifest.ts  what the shell reads   │
            │ rules.ts     the simulation, pure   │
            │ game.ts      input and drawing      │
            │ index.ts     export default module  │
            │ SPEC.md      written from the code  │
            └────────────────────────────────────┘
```

Dependencies point one way only. A game imports the SDK and the engine; neither imports a
game. The shell imports all three. Nothing imports the shell.

## The contract, in full

`packages/game-sdk/src/contract.ts` is short on purpose — the shell loads, runs, pauses,
scores and unloads a game through it and nothing else, which is why adding the
hundred-and-eighth game costs the shell no changes.

```ts
interface Game {
  init(context: GameContext): void;
  update(fixedDeltaSeconds: number, input: InputState): void;
  render(renderer: Renderer, alpha: number): void;
  onPause(): void;
  onResume(): void;
  getScore(): MatchScore;
  getActiveSeat?(): SeatId | null; // real-time games have no turns; null means the same
  destroy(): void;
}

interface GameModule {
  readonly manifest: GameManifest;
  create(): Game;
}
```

`GameContext` is everything the game is allowed to know: its manifest, a seeded `Rng`, the
presentation, which seat is local, which seat opens this round, and each seat's bot
difficulty or `null` for a human. Notice what is absent — no clock, no `window`, no device,
no viewport in pixels. A game that needs one of those is asking the wrong layer.

## Where the boundary actually is

The single most common mistake is putting shell work inside a game. Countdown, HUD, pause,
result, rematch, seat rotation, difficulty selection and tournament reporting all come from
the SDK and the shell. **A bespoke version of any of those inside a game package is a bug**,
not a local variation.

| Concern | Who owns it | Why not the game |
|---|---|---|
| Fixed timestep, interpolation | `engine/loop.ts` | 107 loops would drift apart |
| Which seat a touch belongs to | `engine/seat.ts` | A touch belongs to the seat it *started* in, even after crossing the midline. Ten games shipped with far-side taps dropped before this was one implementation |
| Board rotation for the active seat | `engine/flip.ts`, driven by `seatView()` | In single-seat there is nobody at the far end, so it must never rotate — the game cannot know that |
| Letterboxing to the shared viewport | `engine/viewport.ts` | Rule 9: neither player may see more of the play area than the other |
| Countdown, pause, result, rematch, rounds | `game-sdk/match.ts` | One answer to "is the simulation moving", not two that disagree |
| Whose turn it is, drawn as a banner | the shell, from `getActiveSeat()` | The game answers the question; it never draws the answer |
| Bot error, drawn once and held | `game-sdk/bot-judgement.ts` | Re-rolling a random error every step averages it to zero, so every difficulty tier plays identically. Written wrong three times before it moved here |
| Bot search depth | `game-sdk/search-budget.ts` | A stopwatch makes depth depend on the device, which rule 8 forbids. Nodes are deterministic |
| Seat colours and shapes | `engine/palette.ts` | See the four-palettes story above |
| Canvas, listeners, resize, DPR | `apps/web/src/components/GameHost.tsx` | Everything wall-clock, device and DOM lives here so games never touch any of it |

## How a game gets on screen

1. `/games/[slug]` and `/play/[slug]` are statically exported, one directory per game, from
   `apps/web/src/data/catalogue.generated.ts`. The shell can list, filter and describe all
   107 games while shipping the code for none of them.
2. Pressing play calls the game's loader in `apps/web/src/data/registry.ts` — a dynamic
   `import()`, so opening Tic Tac Toe never downloads the air-hockey physics.
3. `GameHost` builds a `Canvas2DRenderer`, an `InputManager`, a seeded `Rng` and a
   `FixedLoop`, calls `create()` then `init(context)`.
4. The match machine in `game-sdk/match.ts` owns the phase. `GameHost` steps the game only
   while the phase says to; it never decides that itself, and it never pauses itself.
5. `update()` runs at the fixed rate; `render()` runs per frame with an interpolation
   `alpha`. `update` must be deterministic and allocation-free; `render` must not mutate.
6. `destroy()` releases every listener, timer and buffer. The shell asserts no heap growth.

## The generated seam

Three files are generated and must not be hand-edited:

| File | Generated by | From |
|---|---|---|
| `data/catalog.generated.json` | `pnpm catalogue` | `data/catalog.yaml` |
| `apps/web/src/data/catalogue.generated.ts` | the same | the same |
| `apps/web/src/data/game-names.generated.ts` | the same | the same |

`scripts/register-game.mjs` is what wires a scaffolded package into the places the shell
reads — `registry.ts`, `controls.ts`, the root `tsconfig.json` and the web app's
dependencies. It is idempotent, so it is safe to re-run after a rebase.

## Two build graphs per package, and only one sees the tests

Every package has `tsconfig.build.json` (emits `dist`, **excludes** `*.test.ts`) and
`tsconfig.json` (includes the tests, emits nothing). `apps/web` resolves workspace packages
through `exports` → `dist`, so:

- An **engine source edit is invisible** to the cross-game guards in `apps/web/src/data/`
  until `tsc --build` has run. They load games from `dist`, not `src`.
- `tsc --build <pkg>/tsconfig.build.json` says **nothing** about a test file, and Vitest
  transpiles without typechecking, so a green suite says nothing either. Run
  `tsc --noEmit -p <pkg>/tsconfig.json` as well. That is issue #2464, and it has recurred.

## What the architecture buys, stated as constraints

- **No server runtime.** `output: 'export'`; `scripts/check-zero-cost.mjs` fails the build on
  a dynamic route, a server component that needs a request, or gameplay touching the network.
  The whole site is a directory of files.
- **No `Math.random`, `Date`, `window`, `document`, `navigator`, `performance`, `matchMedia`,
  `screen`, `devicePixelRatio` or `requestAnimationFrame`** anywhere in the engine, the SDK or
  a game. ESLint enforces it; `loop.ts` is the single exemption.
- **No simulation value in pixels**, so a phone and a laptop step the identical match. The
  proof is `apps/web/src/data/cross-viewport.test.ts`.
- **One chunk per game**, and `scripts/check-size.mjs` fails a build where a playable game has
  no chunk of its own, or where the shell or a chunk is over `size-budget.json`.
