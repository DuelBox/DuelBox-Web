# Secure coding standard

Rules specific to this codebase, each with the reason it exists. A standard nobody can
remember is a standard nobody follows, so this is short and every rule earns its place by
mapping to something in `docs/threat-model.md`.

Where a rule can be enforced by a tool it is, and the tool is named. A rule that depends
on someone remembering is a rule that will eventually be forgotten.

## 1. Treat everything crossing a boundary as hostile

A boundary is anywhere data arrives from outside this process: `localStorage`, a URL, a
peer connection, a parsed file, a `postMessage`.

```ts
// Wrong — trusts the shape, and inherits __proto__ if it is there.
const state = JSON.parse(raw) as SaveState;

// Right — validate into a fresh object with known keys.
const parsed: unknown = JSON.parse(raw);
if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
const state = { round: asNumber((parsed as Record<string, unknown>).round) };
```

Never spread or merge a parsed object. `{ ...JSON.parse(raw) }` is how `__proto__`
reaches your prototype chain and corrupts every object in the runtime.

*Threat model §4. Not tool-enforceable — this one is on reviewers.*

## 2. All player text goes through `sanitisePlayerName`

At **every** boundary, not once at the entry point. It is idempotent precisely so that
applying it again is free, which means nobody has to reason about whether it already ran.

```ts
import { sanitisePlayerName } from '@duelbox/game-sdk';
const { text } = sanitisePlayerName(fromPeer);
```

It is an allowlist — letters, marks, digits, and a little punctuation — because every
sanitiser that ever fell did so by finding something a blocklist did not name. Do not add
characters to it to fix a bug report without understanding what the character can do
downstream.

*Threat model §1.*

## 3. No secret ever reaches the client

Anything in `apps/web/out` is public the moment it deploys. Not obfuscated, not minified,
not hidden.

`NEXT_PUBLIC_*` is not a convention, it is the mechanism: Next inlines those and nothing
else. If you want a secret in the browser, the design is wrong — the browser cannot keep
one. Move the operation behind something that can.

*Enforced by `scripts/check-bundle-secrets.mjs`, inside `pnpm build`. Threat model
requirement 4.*

## 4. Gameplay never touches the network

The simulation, the bots and the physics run on the player's device. Not a preference — it
is what makes the site nearly free to host and removes a round trip from every input.

*Enforced by `scripts/check-zero-cost.mjs`. Threat model requirement 5.*

## 5. Randomness in gameplay is seeded, always

`Math.random()` breaks replays, deterministic tests, and any future lockstep netcode. Use
the `Rng` from `@duelbox/engine`.

This is a security rule and not only a correctness one: a deterministic, replayable match
is the foundation any future cheat detection would need. Lose determinism and you lose the
ability to verify a result at all.

*Enforced by ESLint in `packages/{engine,game-sdk,games}`.*

## 6. Simulation code never reads the device

No `window`, `document`, `devicePixelRatio`, `screen`, `navigator`,
`requestAnimationFrame`, `performance`, or `matchMedia` in the engine, the SDK, or any
game. The host reads them and passes logical units in.

*Enforced by ESLint. `loop.ts` is the single exemption, for the injectable clock.*

## 7. Never interpolate into markup, a URL, or a canvas label by hand

React escapes what it renders. That is the only place escaping is free.

- `dangerouslySetInnerHTML` — never. There is no case for it here.
- URLs — build with `URLSearchParams` or `encodeURIComponent`, never by concatenation.
- Canvas text — sanitise first; the canvas will happily draw anything and a name is the
  one string a stranger chose.

## 8. Fail closed, and say what failed

A check that cannot run should fail rather than pass. Every guard in `scripts/` names the
property it protects in its failure message, so someone hitting it at 2am learns what
broke rather than what line it broke on.

Beware the check that passes because it found nothing to look at. Two written for this
project initially passed for that reason: one matched a setting inside a comment
explaining why the setting mattered, and one sampled canvas pixels too sparsely to see the
thing it was asserting. **Verify a check fails before trusting that it passes.**

## 9. Dependencies

- Lockfile committed; `--frozen-lockfile` everywhere.
- CI actions pinned to a commit SHA, never a tag — a moving tag is a supply-chain vector.
  Verify the SHA exists before pinning it; a plausible-looking SHA from memory is worse
  than no pin, because it looks reviewed.
- A new direct dependency needs a reason. Transitive weight and maintenance status are
  part of the review, not an afterthought.

*Enforced by `pnpm audit --audit-level=high` and dependency review. Threat model §2.*

## 10. Client-submitted scores are claims

There is no leaderboard, so nothing is at stake yet. The rule exists now so it is decided
before it is expensive: a score arriving from a client is a claim, and treating a claim as
a fact is how every scoreboard on the internet became fiction.

*Threat model §3 and requirement 7.*

## When these rules conflict with shipping

They do not, often. When they seem to, the rule is: **say so in the issue rather than
working around it quietly.** Every one of these came from a real failure mode, and a
deliberate, recorded exception is fine. An undocumented one is how a standard rots.
