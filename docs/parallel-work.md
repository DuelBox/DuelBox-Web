# Running several agents in one repository

The handoff recommends dispatching several agents at once, and it is worth it — the
catalogue's last twenty-six games were built that way. But the recommendation created a
hazard nobody had written down, and it destroyed work three times in one session before
the rules below were worked out. All three failures are recorded in issue #2497.

The single sentence: **file territories isolate, `HEAD` does not.**

## One working directory per branch

Agents can safely share a working directory as long as each is confined to its own
`packages/games/<id>/`. That isolation is real. What is not isolated is `HEAD`: a
`git checkout <other-branch>` run by anybody rewrites the whole tree under every agent at
once. It deleted two packages mid-write — one a 973-line `rules.ts` — and stripped
`registry.ts` and `controls.ts` of their entries.

Use `git worktree add` for any branch-level work while agents are running. A worktree is a
second checkout of the same repository with its own `HEAD`, it is cheap, and it is exactly
what this is for.

Tell every agent, in its brief: **never run a git command that moves `HEAD` or the index** —
no `checkout`, no `reset`, no `stash`, no `commit`. Agents follow that instruction reliably.
The orchestrator is the one that forgets, because the orchestrator is the one with a reason
to change branches.

## Recover one file, not a path

`git checkout <ref> -- packages/games` looks like a recovery and is a **silent revert of
everything else under that path**. It undid a shipped bug fix and 58 test-harness updates,
and was caught only because a test count dropped from 70 to 68. Nothing else would have
noticed.

Recover a specific file with:

```
git show <ref>:<path> > <path>
```

which touches neither the index nor anything else. Two agents worked this out independently
and used it; it should be in the brief rather than rediscovered.

Note also that `git checkout <branch> -- <paths>` leaves what it writes **staged**, so a
later commit can carry along files nobody meant to include. Check `git status` before
committing after any recovery.

## Rebuild before trusting a guard

`pnpm install` is not enough after a tree change. Every workspace package points `main` into
its own `dist/`, so a package whose `dist/` is missing fails to *resolve* — and the
cross-game guards in `apps/web/src/data/` then fail at import, which reads like a missing
dependency rather than a missing build.

After any tree operation, and before believing anything a guard says:

```
npx tsc --build                                   # or per package:
npx tsc --build packages/games/<id>/tsconfig.build.json
```

`apps/web` resolves `@duelbox/engine` through `exports` → `dist` as well, so an **engine
source edit is invisible to the web tests until `tsc --build` runs**. That is a real way to
believe a guard is green.

## The failure worth naming

The reason all of this matters more than ordinary merge trouble: **the guards that stopped
running did not report anything.** A tree operation that silently unloads three cross-game
checks is worse than one that breaks the build, because the build tells you.

Vitest does fail loudly when an `it.each` is handed a completely empty list — `No test found
in suite`, checked rather than assumed. What says nothing is a list that is merely
*shorter*. Six guards in `apps/web/src/data/` build their cases with `it.each(entries)` over
the registry, and every routing assertion is written as "if this id is in the registry, check
it". Remove one loader from `registry.ts` and `bot-parity.test.ts` goes from 325 tests to
322 and stays green.

`routing.test.ts` now closes that: one assertion that every manifest the shell can describe
has a loader, and a ratchet on the registered count. Both were verified by stripping a
loader and watching them go red while `catalogue-agrees.test.ts` and `bot-parity.test.ts`
stayed green.

## Mutation testing is a tree change too

Breaking a thing on purpose to watch a guard go red is the right way to prove a guard works,
and this repository relies on it. In a shared working directory it is also a **tree change**,
and every other agent sees it.

It happened here. A loader was stripped from `registry.ts` for about forty seconds to prove
the new registry guard catches a shortened registry. Another agent ran `controls.test.ts`
inside that window, saw a game in `CONTROLS` with no loader, and reported it as a regression
in its own work. The report was careful and completely wrong, because the ground moved under
it.

So: keep the broken window as short as possible, restore before running anything else, and
prefer mutating a file no agent is reading — or copy the tree to the scratchpad and mutate
there. If an agent reports a failure that does not match what it was working on, check
whether you were mid-mutation before believing it.

The general form: **an agent's failure report is only as good as the tree it ran against.**
When several agents share one directory, a red test is evidence about the tree, not
necessarily about the agent that found it. Ask what else was in flight before acting on it.

## Checklist for a brief

- Name the exact paths the agent may edit, and the paths it may not.
- "Never run any git command that moves HEAD or the index."
- "Use `git show <ref>:<path> > <path>` to recover a file."
- "Run `npx tsc --build packages/games/<id>/tsconfig.build.json` before trusting any
  `apps/web/src/data` guard, **and** `npx tsc --noEmit -p packages/games/<id>/tsconfig.json`
  before claiming the package is clean." Both, not either — see below."
- Say which games other agents own, so a shared-file finding gets reported rather than fixed.
- Forbid `pnpm build`, whole-repo `pnpm test`, and `pnpm e2e` — they are slow, and they will
  pick up every other agent's in-flight work and report it as this agent's failure.

## Two projects per package, and only one of them sees the tests

Every game package has two TypeScript projects, and an agent that runs the wrong one reports
a clean package that is not clean:

- `tsconfig.build.json` emits `dist` and carries `"exclude": ["src/**/*.test.ts"]`. It is what
  `pnpm build` runs and what the cross-game guards need rebuilt. **It never compiles a test
  file.**
- `tsconfig.json` is the default project, *includes* the tests, and emits nothing.

So `npx tsc --build packages/games/<id>/tsconfig.build.json` says nothing at all about a
change to `game.test.ts` — and Vitest transpiles without typechecking, so a green suite says
nothing either. An agent can edit thirty-eight test files, run both of those, see everything
pass, and still have left type errors behind. That is issue #2464, and the second project was
scaffolded specifically to prevent it; it only works if somebody runs it.

It happened again this session, five errors across two packages, found by the repo-wide
`tsconfig.lint.json` pass afterwards. CI would have caught it — `pnpm typecheck` is repo-wide
— so nothing would have shipped. What it costs is a round trip, which is exactly what
parallel work is meant to save.

Run both:

```
npx tsc --build  packages/games/<id>/tsconfig.build.json   # rebuilds dist for the guards
npx tsc --noEmit -p packages/games/<id>/tsconfig.json      # typechecks the tests too
```
