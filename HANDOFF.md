# DuelBox — handoff prompt

Paste everything below the line into a fresh Claude Code session started in this repo.

---

You are picking up work on **DuelBox**, a browser-based collection of two-player
mini-games. The repo is `DuelBox/DuelBox-Web`, already cloned. Read `CLAUDE.md` first —
it is the constitution and its rules are non-negotiable.

## What this product is

107 two-player games in the browser. Three ways to play, all of which must work for
every game:

1. **One device, together** — two people share one phone, tablet or laptop.
2. **Two devices** — phone against laptop, tablet against phone, anywhere.
3. **Alone** — a bot takes the other seat at three difficulty levels.

Plus a tournament: seven random games with a running head-to-head score, which must work
in all three configurations.

No download, no account, works offline. The target is five million users, so it has to be
secure and cheap to run.

## The single most important constraint: it must cost almost nothing to host

The game runs on the player's device. Simulation, bots and physics are all local; the
origin's only job is to hand over static files once. This is structural, not a preference:

- The site is `output: 'export'` — a directory of static files, no server runtime. A route
  that needs request-time rendering fails the build.
- After a game is cached, replaying it costs **zero requests**.
- Cross-device play must be peer-to-peer (WebRTC) so matches never touch our servers. Only
  the brief signalling handshake may run server-side, and it must fit a free tier.
- Everything degrades to local play when any paid dependency is unavailable.

See the `epic:zero-cost` issues. Do not add a server-side dependency without checking
against them.

## What has already been built and verified

Landed on `main`, all green (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`,
plus `pnpm e2e`):

- **Workspace**: pnpm monorepo, TypeScript strict with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`, ESLint with type-aware rules, Prettier, Vitest, Playwright,
  CI running format/typecheck/lint/test/build/e2e plus a dependency audit.
- **`packages/engine`**: seeded RNG (xoshiro128\*\*, serialisable, sequence pinned by
  checksum), allocation-free vector maths with a scratch pool, the fixed-timestep loop with
  interpolation and a spiral-of-death guard, the seat/rotation system, viewport letterbox
  fitting, collision primitives with swept tests, the two-player input system, and the
  Canvas2D renderer.
- **`packages/game-sdk`**: the `Game` contract, a Zod manifest validated at build time, and
  the shared win conditions (first-to, lead-by, highest-at-time, reduce-to-zero,
  last-standing) each resolving simultaneous outcomes as a draw.
- **`apps/web`**: Next.js 15 static export, design tokens in CSS and TS kept in step by a
  test, the catalogue generated from `data/catalog.yaml`, one indexable page per game, and
  the play route with the shared match flow.
- **Seven playable games**: Tic Tac Toe, Air Hockey, Drop Four, Sumo Push, Memory Match,
  Pull the Rope, Whack a Mole — one per archetype plus extras.

705 unit tests and 8 browser smoke tests pass. 107 issues are closed with evidence.

## Where the work is

**2,344 open issues**, every one written with a why, checkboxed action items and acceptance
criteria. Labels: `epic:*`, `type:*`, `priority:P0`–`P3`, `size:XS`–`L`, `game:<id>`.

Start with `label:ready` — groomed, unblocked issues. `label:launch-five` marks one game
per archetype in M1.

```bash
gh issue list --repo DuelBox/DuelBox-Web --label ready --state open
```

Per game there are 14 issues: research, spec, scaffold, rules, input, simulation, scoring,
rendering, seat-flip or split-layout, match flow, bot, assets, tests, QA — plus responsive,
single-seat presentation, cross-device play and a fairness audit.

## How to add a game

```bash
pnpm create-game <id>          # reads name/category/archetype from the catalogue
# then: add to tsconfig.json references, apps/web/package.json,
#       and apps/web/src/data/registry.ts
pnpm install && pnpm typecheck && pnpm test
```

Every game's real rules are already recorded in `docs/observed-rules.md` — transcribed
from the reference app by playing it. **Do not invent mechanics**; use what is documented.

## The rules that catch people out

1. **Never decompile or extract from any APK.** Reference apps are researched by playing
   them. This is recorded in `CLAUDE.md`, `CONTRIBUTING.md` and every research issue.
2. **No simulation value in pixels.** Games simulate in fixed logical units; only the
   render layer knows the device. A phone and a laptop must step the identical match.
3. **Neither player may see more of the play area than the other.** In remote play both
   devices letterbox to a negotiated shared viewport; surplus screen holds chrome, never
   extra field of view.
4. **No game code branches on device type.**
5. **Never `Math.random()`** in gameplay — seeded RNG only; lint enforces it.
6. **No per-frame allocations** in engine or game `update()`.
7. **Bots never get information, speed or physics a human cannot get.**
8. **Colour is never the only signal** — every player-owned element also differs by shape
   or label, so the board reads in greyscale.

## Originality

The mechanics are reimplemented from scratch — rules are not protected — but the product
must not look like a clone. There is an `epic:originality` set covering the differentiation
brief, our own visual identity, and a pre-launch review that places our screens beside the
reference app's. Art, audio, copy and layout are all ours.

The design is published as a canvas: cartoon cast (Pip in coral is player one, Bo in sky is
player two) with a professional layout, plus a 3D arcade hero concept. Working files are in
`docs/design-canvas/`.

## Security and scale

Issues are mapped individually to OWASP Top 10 categories and CWE/SANS Top 25 entries.
The ones most likely to bite: XSS through player-supplied names, broken access control on
rooms and saves, prototype pollution when deserialising game state or replays, and the
embeddable iframe surface we ship deliberately. Read `epic:security` before writing
anything that handles input, storage or the network.

## Working style expected

- One issue at a time; comment the plan on the issue before writing code.
- Tests alongside the code, never after.
- Verify with `pnpm typecheck && pnpm lint && pnpm test && pnpm build` before opening a PR.
- Close an issue only with evidence: what landed, what was verified, and any decision the
  spec left open.
- If you find a real bug while implementing, fix it and say so plainly rather than
  working around it.

## Useful commands

```bash
pnpm dev            # run the site
pnpm test           # unit tests
pnpm e2e            # browser smoke tests against the static build
pnpm build          # static export to apps/web/out
pnpm catalogue      # regenerate the catalogue from data/catalog.yaml
pnpm create-game    # scaffold a new game
python3 scripts/seed.py --repo DuelBox/DuelBox-Web   # re-seed issues, idempotent
python3 scripts/list_issues.py --repo DuelBox/DuelBox-Web --format md > BACKLOG.md
```

## Where to look

| File | What it holds |
|---|---|
| `CLAUDE.md` | The constitution — read first |
| `docs/reference-analysis.md` | What was observed by playing the reference app |
| `docs/observed-rules.md` | Verbatim rules for all 107 games |
| `docs/input-design.md` | The two-player input model |
| `docs/game-catalog.md` | The catalogue as a readable table |
| `data/catalog.yaml` | Single source of truth for the games |
| `data/platform_issues.yaml` | The platform backlog definitions |
| `data/game_templates.yaml` | The per-game issue templates |
| `BACKLOG.md` | Every issue, grouped |
| `HANDOFF.md` | This file |

Start by reading `CLAUDE.md`, then run
`gh issue list --repo DuelBox/DuelBox-Web --label ready --state open`, pick the
lowest-numbered unblocked issue, and work it to completion.
