# DuelBox — project plan

A browser-based collection of two-player mini-games. Two people, one device, one
browser tab, no download, no account. Original implementations of game genres that
are free to reimplement.

**Scale:** 101 games · 1,699 issues · 5 milestones.

This plan is derived from **playing the reference app**, not from imagining it.
The observations are in `docs/reference-analysis.md`; the catalog in
`data/catalog.yaml`; the backlog in `data/platform_issues.yaml` and
`data/game_templates.yaml`.

---

## What we may and may not take

| Element | Protected? | What that means here |
|---|---|---|
| Rules and mechanics | No | Air hockey, sumo, tic-tac-toe, mini golf are all free to build |
| Genre concepts | No | "Two-player games on one device" is not ownable |
| Source code | Yes | Never decompile, never reuse |
| Art, sprites, animation | Yes | Ours, original, licence recorded |
| Sound and music | Yes | Ours or properly licensed |
| Exact UI layouts | Yes | We design our own |
| Game and app names | Often | Renamed the risky ones in the catalog |

The emulator is a **research tool for observing gameplay**, never an extraction
tool. That boundary is stated in `CLAUDE.md`, in `CONTRIBUTING.md`, and in every
per-game research issue.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript strict | A client-rendered games portal earns no organic traffic; SSG/SSR is the whole discovery strategy |
| Styling | Tailwind v4 over CSS custom-property tokens | One token source shared by shell CSS and canvas drawing code |
| Game engine | Custom, Canvas2D, fixed timestep | 101 small games do not need a physics library, and React must never enter a game loop |
| 3D landing | React Three Fiber, landing route only | Isolated structurally, asserted in CI, never in a game bundle |
| State | Zustand for the shell | Games hold their own state; the shell holds session and settings |
| Testing | Vitest and Playwright | Rules headless, journeys across three browsers |
| Packaging | pnpm workspaces | Each game is an independently loadable chunk |
| Hosting | Vercel edge with preview deploys | Two-player feel cannot be reviewed from a diff |

## Architecture

```
apps/web              shell, routing, landing, catalog, game host
packages/engine       fixed-timestep loop, renderer, collision, input, seats, audio
packages/game-sdk     the Game contract, match flow, HUD, win conditions, bots
packages/games/*      101 folders, each its own chunk
packages/ui           shared components
```

Games supply a simulation and a win condition. The SDK supplies countdown, HUD,
pause, result, rematch, seat rotation, difficulty, and tournament reporting.

---

## How people play: three configurations

| Configuration | Devices | Presentation | What makes it hard |
|---|---|---|---|
| Shared screen | One phone, tablet, or laptop | Shared-screen, two seats | Touch ownership per seat; 180° rotation; hands colliding |
| Cross-device | Two devices, any mix — phone vs laptop, tablet vs phone | Single-seat on each | Input parity; shared logical viewport; lockstep; clock sync |
| Solo | One device | Single-seat | Score attack, personal bests, no opponent |

Cross-device is the constraint that reaches furthest back into the engine. It is
why simulation runs in fixed logical units rather than pixels, why both clients
letterbox to a negotiated shared viewport rather than filling their screens, and
why the RNG is seeded and the timestep fixed. None of that can be retrofitted.

## Every screen, deliberately

Phone, large phone, tablet portrait, tablet landscape, laptop, desktop, ultrawide.
Each is a designed layout, not one layout stretched. Games render from a fixed
logical resolution scaled to fit with letterboxing, clear of notches and home
indicators, unaffected by mobile browser chrome appearing mid-match, and preserving
match state exactly across rotation, resize, and fold.

## The five hard things, all confirmed by observation

1. **Two players, one screen, no OS player separation.** A touch belongs to the
   seat it *started* in and keeps that ownership across the midline. Every touch
   game is subtly broken if this is wrong.
2. **Seat rotation.** The reference app rotates the play area 180° and recolours it
   to the active player so each person reads it upright. This must be an engine
   concept, not a per-game hack.
3. **Fixed timestep.** Physics must behave identically at 60, 90, and 120Hz.
   Retrofitting means rewriting every game.
4. **A bot for nearly every game.** The reference app offers vs-bot almost
   everywhere, so the AI interface belongs in the game contract.
5. **Ergonomics.** Two people holding one phone is a physical problem that only
   moderated playtests with real pairs surface.

## Observed product model

- **Three play modes**, declared per game: vs Friend, vs Bot, Solo score attack.
  Not every game has all three, so the manifest declares which.
- **Red is player one, blue is player two**, on every screen, in every game.
- **One pre-game screen for all games**: rules in a sentence, how-to-play video,
  mode buttons, favourite star, and sometimes a per-game options gear.
- **HUD anchored to the screen edges** — score pill on one side, exit on the other,
  rotated so both seats can read it, never overlapping the play area.
- **Tournament**: seven random games, a progress track ending in a trophy.
- **Win conditions seen**: first to N, lead by 2, reduce health to zero, highest
  accumulated score at the end. All belong in a shared helper, not in each game.

## Where we beat the reference app

The catalog is one flat scroll of 101 cards with no search, no categories, and no
filters. Ours gets search, category filters, sort, favourites, recently played,
animated card previews, per-game indexable pages, offline play, and installability.

## Milestones

| | Contents |
|---|---|
| **M0 Foundation** | Repo, CI, tokens, engine loop, seats, collision, input, SDK contract |
| **M1 Playable Shell** | Shell routes, game host, match flow, HUD, tournament, first games |
| **M2 Game Catalog** | The 101 games, bots, audio, i18n, accessibility |
| **M3 Premium Site** | 3D landing, motion, SEO, PWA, analytics, legal, launch |
| **M4 Online** | Remote multiplayer, accounts, leaderboards, live ops |

## Files

```
docs/reference-analysis.md    what was observed by playing, and what it implies
data/catalog.yaml             101 games with archetype, category, and observed rules
data/platform_issues.yaml     198 granular website and platform issues
data/game_templates.yaml      14 issues per game, generated per archetype
scripts/seed.py               creates everything via gh, idempotent, resumable
prompts/build-iteration.md    the per-issue build loop prompt
CLAUDE_CODE_LOOP.md           the three loops
CLAUDE.md                     repo constitution
```

Add a game by appending to `catalog.yaml` and rerunning the seeder — it generates
that game's 14 issues and skips everything that already exists.
