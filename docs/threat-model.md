# Threat model

What can actually go wrong here, ranked by whether it is likely rather than by whether it
is frightening.

The shape of this product decides most of it. DuelBox is a static site with no server
runtime, no accounts, no database, and no secrets. That removes whole categories of risk
outright — there is no login to break, no session to steal, no query to inject, no
privilege to escalate. What remains is smaller and more specific than a generic web
threat model would suggest, and pretending otherwise would bury the four things that
genuinely matter under thirty that do not.

## What we are protecting

1. **The player's device and browser session.** They arrived to play a game. Nothing we
   ship should be able to run code they did not ask for.
2. **The integrity of a match.** A game decided by cheating is not a game.
3. **The origin's reputation.** `duelbox` serving malware, once, to anyone, is the
   failure that ends the product.
4. **Nothing else.** We hold no personal data. That is a property to defend, not a stage
   to grow out of.

## Who would attack this, and why

**The opponent.** By far the most likely, and the least dramatic. Two people playing a
game, one of whom would rather win. Motivated, present, and holding the other device.

**A vandal.** Someone who finds an XSS in a player name and wants their alert box seen.
Low skill, high volume, and the reason a name field is the most dangerous input we will
ever accept.

**A supply-chain attacker.** Not targeting us — targeting whoever depends on a package
they have compromised. We are collateral. This is the most realistic route to serving
malware from our own domain, and it requires no mistake on our part at all.

**Not in scope: a targeted attacker with resources.** There is nothing here worth that.
No data, no money, no leverage. A model that pretends otherwise wastes effort that should
go to the three above.

## The risks that matter

### 1. Cross-site scripting through a player name — highest priority

The only free text this product will ever accept, chosen by one person, stored, sent over
a peer connection, and rendered on a stranger's device. Every one of those is a boundary,
and the last one means an attacker's payload runs on a victim's machine.

**Mitigated.** `sanitisePlayerName` in the SDK permits letters, marks, digits and a small
set of punctuation, and rejects everything else — an allowlist, because every sanitiser
that ever fell did so by finding something a blocklist did not name. It strips control
characters, bidi overrides and zero-width characters, and is idempotent so it can be
applied at every boundary rather than trusted to have run at one.

**Residual.** No name field exists yet, so nothing calls it. The risk arrives with the
feature; the tool exists first deliberately, so the feature uses it rather than inventing
its own.

### 2. A compromised dependency — highest likelihood

A games site pulls in a lot of npm. A compromised transitive package is the most plausible
route to serving malware from our domain to five million people, and it needs no mistake
from us.

**Mitigated.** Committed lockfile, `--frozen-lockfile` everywhere, advisory scanning per
PR and nightly, dependency review on every PR failing on high severity, and all CI actions
SHA-pinned rather than tag-pinned — a moving tag is a supply-chain vector in itself.

**Residual.** We would not detect a package compromised *before* an advisory is published.
Nothing does. The nightly scan narrows the window; it does not close it.

### 3. Cheating in a local match

The simulation runs on the player's device, so a player can modify it. This is unavoidable
and mostly harmless: both players are in the same room, and a cheat nobody can hide from
the person sitting opposite is not much of a cheat.

**It stops being harmless the moment there is a leaderboard.** A client-submitted score is
a claim, not a fact, and treating it as a fact is how every scoreboard on the internet
became fiction.

**Mitigated.** Nothing to cheat for yet — there is no persistent score. Deterministic
simulation and seeded RNG mean a match is replayable, which is the foundation any future
verification would need.

**Residual, and a decision for later.** #2388 covers treating submitted scores as
untrusted. Until then, no leaderboard.

### 4. Prototype pollution through deserialised state

Saved games, replays and peer messages are all parsed. A crafted `__proto__` key in any of
them corrupts every object in the runtime.

**Mitigated for what exists.** `last-mode.ts` validates rather than trusts what it reads
from storage — another tab, an older version, or a user with the console open can all put
something unexpected there — and copies known keys into a fresh object rather than
spreading the parsed one.

**Residual.** Replays and peer messages do not exist yet. When they do, the same rule must
hold: parse into a fresh object with known keys, never merge or spread.

### 5. The embeddable iframe surface

Deliberately shipped, so deliberately a surface. `postMessage` without an origin check
accepts instructions from any page that embeds us.

**Not mitigated. Not built.** #2372 owns it. The rule when it lands: check `event.origin`
against an allowlist, never trust `event.source`, and treat the message payload with the
same suspicion as a peer's.

### 6. Third-party runtime dependencies

We fetch three typefaces from Google's CDN on every cold load. That is a request to
someone else's server on the critical path, and it sends every visitor's IP and
User-Agent there.

**Not mitigated.** #187 covers self-hosting them. Play survives a blocked font, so this is
a privacy and availability issue rather than a functional one — but "offline-capable" is a
product claim, and today it is not quite true.

## What the architecture removes

Worth naming, because these are the categories a generic model would spend most of its
length on:

- **No authentication** — nothing to break into, no session to hijack, no password to
  leak.
- **No database** — no SQL injection, no ORM misuse, no backup to exfiltrate.
- **No server runtime** — no SSRF, no deserialisation of request bodies, no server-side
  template injection, no request smuggling.
- **No user data** — a breach has nothing to take.
- **No file uploads, no comments, no profiles, no messaging.**

Each of these becomes live the day the feature does. `epic:security` has an issue for each
in advance so the decision is made when it is cheap.

## Requirements this yields

1. All player-supplied text passes `sanitisePlayerName` before being stored, rendered or
   transmitted. **Applied at every boundary, not once at the entry point** — which is why
   it is idempotent.
2. Nothing parsed from storage, a replay, or a peer is trusted. Validate into a fresh
   object with known keys.
3. High-severity advisories fail the build. Nightly as well as per-PR.
4. No secret may reach the client bundle. Enforced by `check-bundle-secrets.mjs`.
5. No gameplay path may reach the network. Enforced by `check-zero-cost.mjs`.
6. A strict CSP before launch (#2374), which turns the XSS above from a likelihood into a
   defence-in-depth failure.
7. No leaderboard until submitted scores are treated as claims.

## What this model does not cover

Physical access to an unlocked device. Someone reading the screen over a shoulder. A
malicious browser extension. All three are real and all three are outside what a static
game site can address.
