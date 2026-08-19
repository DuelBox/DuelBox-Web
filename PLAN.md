# DuelBox — project plan

Web-based collection of two-player mini-games. Two people, one device, one browser
tab, no download, no account. Original implementations of public-domain game genres.

**Scale:** 44 games · ~575 issues · ~2,600 story points · 5 milestones.

---

## What we can and cannot take from the reference app

| Element | Protected? | What that means here |
|---|---|---|
| Rules and mechanics | No | Pong, air hockey, sumo push, tic-tac-toe are all free to build |
| Genre concepts | No | "Collection of two-player games on one device" is not ownable |
| Source code | Yes | Never decompile, never reuse |
| Art, sprites, animations | Yes | Commission or create originals |
| Sound and music | Yes | Original or properly licensed, with the licence recorded |
| Specific UI layouts | Yes | Design your own |
| Game and app names | Often | Renamed the risky ones in the catalog |
| Level and stage layouts | Yes | Design your own |

Names changed to avoid live trademarks: **Drop Four** (not Connect Four),
**Reversi** (not Othello), **Sea Battle** (not Battleship), **Light Trails**
(not Tron light cycles).

The emulator is a **research tool for observing gameplay**, not an extraction
tool. Loop 1 in `CLAUDE_CODE_LOOP.md` carries that boundary explicitly.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Build | Vite + pnpm workspaces | Per-game code splitting is the requirement |
| Language | TypeScript, strict | Physics code with loose typing is a bug farm |
| Framework | React for shell, none inside games | Games run on raw canvas |
| Rendering | Canvas2D default, WebGL where needed | Most games don't need WebGL |
| Physics | Custom | Matter.js/Planck are heavier than 44 simple games need |
| 3D landing | React Three Fiber | Isolated to the landing route, never loaded in-game |
| Site rendering | SSG/SSR | A client-rendered games site is invisible to search |
| Backend | Edge functions + Postgres | Only needed from M3 |
| Offline | Service worker | Strongest differentiator against browser games portals |

---

## Architecture

```
apps/web              shell, routing, landing, catalog
packages/engine       fixed-timestep loop, renderer, collision, input, audio
packages/game-sdk     the Game contract + shared match flow, HUD, difficulty
packages/games/*      44 folders, each an independently loaded chunk
packages/ui           shared components
packages/analytics    event layer
```

Games supply simulation and a win condition. The SDK supplies countdown, HUD,
result screen, rematch, pause, difficulty scaffolding, and tournament reporting.

## The three technically hard things

1. **Two players, one browser, no OS player separation.** A touch belongs to
   P1 or P2 based on which zone it *started* in, and keeps that ownership even
   when the finger crosses the midline. Design doc first, code second.
2. **Fixed timestep.** Fixed accumulator with interpolated rendering, from day
   one — retrofitting it means rewriting every game.
3. **Ergonomics.** Two people holding one 6-inch phone is a physical problem.
   Only moderated playtests with real pairs surface it.

## Design direction

**Signature: the seam.** One diagonal split dividing P1 from P2 territory,
carried from the landing hero through the catalog into the live game HUDs.

```
--ink     #08090F    --p1    #FF3B6B
--surface #12141F    --p2    #21E6C1
--paper   #E8E6DF    --gold  #FFC94A
```

Display **Archivo Expanded**, body **Inter Tight**, scores and timers
**JetBrains Mono**. The 3D landing is an arcade cabinet split along the seam;
scroll drives a fixed camera spline — no scroll-jacking. Budget: LCP under 2.5s
on 4G; low-end devices get a designed static hero.

## Milestones

| | Contents | Points |
|---|---|---|
| **M0 Foundation** | Repo, engine loop, collision, input abstraction, SDK contract | ~180 |
| **M1 First Playable** | Shell, match flow, 6 launch games, tournament | ~520 |
| **M2 Catalog** | Remaining 38 games, AI, audio, a11y, i18n | ~1,100 |
| **M3 Launch** | 3D landing, SEO, PWA, analytics, monetization, legal | ~600 |
| **M4 Online** | Remote multiplayer, accounts, leaderboards, live ops | ~250 |

**Launch six:** Ping Pong (paddle), Air Hockey (impulse physics), Tic Tac Toe
(board + AI), Sumo Push (arena physics), Drop Four (minimax), Quick Draw
(input latency) — covering the full technical range so the remaining 38 are
variations on solved problems.

## Files

```
data/games.yaml                  44 game specs
data/issues.yaml                 platform issues, 5 milestones, labels
data/game_issue_templates.yaml   8 templates × 44 games = 352 issues
scripts/seed_issues.py           creates everything via gh CLI, idempotent
scripts/run-loop.sh              build loop driver
prompts/build-iteration.md       per-iteration build prompt
CLAUDE_CODE_LOOP.md              the three loops
CLAUDE.md                        repo constitution
```

Add a game by appending to `games.yaml` and rerunning the seeder — it generates
8 new issues and skips everything that already exists.
