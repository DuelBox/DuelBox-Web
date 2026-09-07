# DuelBox

A browser collection of two-player mini-games played by two people on one device, in one
tab. No accounts, no install, offline-capable. 107 games, one shell, one chunk each.

Two people sit on opposite sides of a phone and share it. That single sentence decides most
of the architecture: a touch belongs to the **seat** it started in, a turn-based board
**rotates 180°** so whoever has the move reads it upright, and no simulation value is ever
expressed in pixels — because a phone and a laptop must step the identical match.

Live at <https://duelbox.github.io/DuelBox-Web/>.

## Layout

```
apps/web            site shell, routing, landing, catalog, game host
packages/engine     loop, renderer, physics, input, seats, audio, palette
packages/game-sdk   the Game contract every game implements, and the match machine
packages/games/*    one folder per game, one lazily-loaded chunk per game
data/               the catalog, as YAML, and its generated form
docs/               research, design docs, ADRs
e2e/                Playwright specs, run against the built static site
scripts/            catalog generation, scaffolding, and the build-time guards
```

`CLAUDE.md` lists `packages/ui` in the same table. It has never existed — shared components
live in `apps/web/src/components/`.

[`docs/architecture.md`](docs/architecture.md) has the shell / SDK / engine / game diagram
and, more usefully, the rule for deciding which of the four a change belongs in.

## Getting started

```bash
pnpm install
pnpm dev            # :3000, with its own .next-dev so a build cannot clobber it
```

`package.json` requires Node >= 20; CI and the deploy both run Node 22, so build on 22. pnpm
comes from the pinned `packageManager` field. Do not pass a `version:` to `pnpm/action-setup`
in CI — with `packageManager` pinned the action treats it as a conflict and refuses to
install, which cost this repository 45 consecutive red runs.

## The gate

Run all of it before claiming a change is done. CI runs the same six, in this order.

```bash
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e
```

`format:check` is first because it is the cheapest and it is the one that gets skipped. CI
failed on it for every commit until 20 August 2026 while local runs of the other five
passed, so the repository looked green from both directions and was not.

`pnpm build` is not just a build. It runs the manifest validator, emits the host config,
and then the header check, the zero-cost guard, the bundle secret scan, the asset licence
check and the size budget — see `package.json`. Any one of them can fail it.

Three things run **nightly** and the gate above does not cover them
([`.github/workflows/nightly.yml`](.github/workflows/nightly.yml)): Firefox, the deep
seat-balance sweep at three bot tiers, and the 70% coverage floor. A change that drops
coverage merges green and is caught the next morning. That is a deliberate trade, and the
reasoning is in the header of that file.

## Adding a game

```bash
pnpm create-game <id>                    # scaffolds packages/games/<id> from data/catalog.yaml
node scripts/register-game.mjs <id>      # wires it into the four places the shell reads
```

Then write `rules.ts` (the simulation, pure and deterministic), `game.ts` (input and
drawing), and both test files. `packages/games/ping-pong` is the worked example, and
`docs/game-spec-template.md` is the pattern for its `SPEC.md`.

Both scripts edit shared files, so run them yourself before dispatching parallel work — two
agents running them at once race. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the full
walkthrough, the branch and commit conventions, and the research scope boundary.

## The rules that are not negotiable

`CLAUDE.md` is the constitution: original assets only, never extract from an APK, seeded RNG
in simulation, logical units rather than pixels, no branch on device type, colour is never
the only signal. Read it before touching engine, input or SDK code, along with
[`docs/reference-analysis.md`](docs/reference-analysis.md).

The habit that keeps them honest is cheaper than the rules themselves: **when a rule matters,
run the thing that is supposed to enforce it and watch it fail on purpose.** Six guards in
this repository were found claiming something nothing ran — `pnpm size` falling through to
the system `size(1)`, the asset-licence check CLAUDE.md said CI enforced, CI itself red
behind another workflow's green tick, a balance harness that promised a band it did not
assert, the coverage gate nothing invoked, and the React hook rules. Five of the six were
found in a single day, by looking.

## Where to read next

| Document | What it settles |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | The eleven rules, and the two ideas the product rests on |
| [`docs/architecture.md`](docs/architecture.md) | Shell, SDK, engine, games — and which one a change belongs in |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to work here, and the research scope boundary |
| [`docs/presentation.md`](docs/presentation.md) | Shared-screen and single-seat |
| [`docs/input-parity.md`](docs/input-parity.md) | Where hardware rather than skill would decide a match |
| [`docs/responsive.md`](docs/responsive.md) | Canvas letterboxing and the four device classes |
| [`docs/deploy.md`](docs/deploy.md) | The artefact, the hosts, and which headers survive |
| [`docs/release-runbook.md`](docs/release-runbook.md) | Releasing, verifying, and rolling back |
| [`docs/incident-response.md`](docs/incident-response.md) | What an incident is here, and what is not |
| [`docs/interface-voice.md`](docs/interface-voice.md) | How the product talks |
| [`docs/privacy-policy.md`](docs/privacy-policy.md) | What is collected, and how that was verified |
| [`SECURITY.md`](SECURITY.md) | Reporting a vulnerability, and what is in scope |
| [`docs/parallel-work.md`](docs/parallel-work.md) | Running several agents in one repository |

## Licence

No licence file exists yet. Until one does, the default applies: all rights reserved, and
nothing here is granted for reuse. That is a gap, not a position — it is worth closing
before the first outside contribution arrives.
