# CWE Top 25 verification matrix

OWASP categories are broad; the CWE Top 25 is specific enough to check off one by one, and a
matrix is what turns "we care about security" into evidence (#2391). This maps each of the 25
against **this** codebase: applicable or not, and — where applicable — the named mitigation and
the automated guard that proves it. Entries marked not applicable carry a written justification,
because "not applicable" with no reason is where a real exposure hides.

**Edition and re-verification.** This is the **2024 CWE Top 25** (MITRE/CISA, November 2024).
The list is re-issued each year with minor reordering; #2391's standing requirement is to
re-verify this matrix each release against the then-current list, adding or removing rows as the
list changes. The *reasoning* below is stable — it follows from the architecture — so a re-verify
is mostly confirming the guards still run, not re-deriving the verdicts.

**Read `docs/threat-model.md` and `docs/secure-coding.md` first.** This matrix is the CWE-indexed
view of the mitigations those two already describe; it introduces no new code. The single fact
that decides most rows: **DuelBox is a static site with no server runtime, no accounts, no
database, and no secrets** (threat model). That removes whole CWE families outright, and the
honest matrix says so per entry rather than burying four real risks under twenty-one theoretical
ones.

## The guards this matrix cites

Named once here so each row can point at them:

- **`check-zero-cost.mjs`** — fails `pnpm build` if anything adds a server runtime, a dynamic
  route, a network call on a gameplay path, or pushes the session over 700 kB.
- **`check-bundle-secrets.mjs`** / **`check-source-secrets.mjs`** — fail if anything
  credential-shaped, or a non-`NEXT_PUBLIC_` env var, reaches the bundle or the source.
- **`csp-origins.test.ts`** — asserts the CSP permits exactly the origins the site loads from,
  catching a subresource the policy would otherwise silently drop.
- **`research-provenance.test.ts`** — asserts no shipped field claims research a game does not
  have; cited here as the pattern for a guard that fails when a committed artefact goes stale.
- **ESLint bans** in `packages/{engine,game-sdk,games}` — no `Math.random`, `window`,
  `document`, `navigator`, wall-clock, etc.
- **`sanitisePlayerName`** (`packages/game-sdk/src/player-text.ts`) — the allowlist sanitiser
  for the one free-text field the product will ever accept.
- **CodeQL `security-extended`** — every PR, push and nightly; the injection/memory categories
  below that no bespoke test covers are covered by it for the JS/TS that ships.

## The matrix (2024 CWE Top 25)

| # | CWE | Applicable? | Mitigation / justification | Proven by |
|---|---|---|---|---|
| 1 | **CWE-79** Cross-site Scripting | **Yes — the top risk.** The player name is the only free text: chosen by one person, stored, sent over a future peer link, rendered on a stranger's device (threat model §1). | `sanitisePlayerName` allowlist applied at *every* boundary (idempotent by design); React escaping only, no `dangerouslySetInnerHTML`; strict hash-based CSP as defence-in-depth (#2374). Secure-coding rules 2 and 7. | `player-text` tests; `csp-origins.test.ts`; CodeQL; secure-coding rule 7 (reviewer-enforced for canvas labels) |
| 2 | **CWE-787** Out-of-bounds Write | **No.** Memory-safe language (TypeScript/JS on the browser VM). No manual memory, no WASM, no native addon in the shipped runtime. | Covered by CodeQL for the JS that ships | N/A — no unmanaged memory |
| 3 | **CWE-89** SQL Injection | **No.** No database, no server, no query of any kind (threat model, "what the architecture removes"). | The absence is enforced: `check-zero-cost.mjs` fails a build that adds a server runtime or a DB client | `check-zero-cost.mjs` |
| 4 | **CWE-352** CSRF | **No.** No authenticated state, no cookies, no session, no state-changing server request to forge (SECURITY.md: "There are no cookies"). | Nothing to forge a request *to* | N/A — no server state |
| 5 | **CWE-22** Path Traversal | **No (runtime).** No server file system reached by user input; routes are a fixed static export. The *build* scripts read the repo, not user input. | Static export has no request-time file access | `check-zero-cost.mjs` (no server runtime) |
| 6 | **CWE-125** Out-of-bounds Read | **No.** Same as CWE-787 — memory-safe VM, no unmanaged buffers. | — | N/A — no unmanaged memory |
| 7 | **CWE-78** OS Command Injection | **No (runtime).** No shell, no `exec`, no server process handling requests. Build/CI scripts run fixed commands on trusted input. | `check-zero-cost.mjs` (no server runtime) | CodeQL on build scripts |
| 8 | **CWE-416** Use After Free | **No.** Garbage-collected runtime; no manual free. | — | N/A — GC runtime |
| 9 | **CWE-862** Missing Authorization | **Partly — future.** No authorization exists because nothing is protected (no accounts). It becomes applicable the day the **room server** exists: every message must be authorised against the sender's membership of that room (#2363). | Today: N/A, no protected resource. On arrival: #2363's per-message membership check. | Tracked by #2363 (unbuilt) |
| 10 | **CWE-434** Unrestricted Upload | **No.** No file upload anywhere; no comments, no profiles, no media submission (threat model). Local settings export/import reads a JSON *string* the user chose, validated into a fresh object — not a file served to anyone. | Import is schema-validated, never executed or re-served | `local-store.ts` validation; secure-coding rule 1 |
| 11 | **CWE-94** Code Injection | **No.** No `eval`, no `new Function`, no dynamic import of user input. Game code is statically bundled per chunk. | CodeQL flags dynamic code execution; CSP `script-src 'self'` + per-page hashes permits no injected origin | `csp-origins.test.ts`; CodeQL |
| 12 | **CWE-20** Improper Input Validation | **Yes — everything crossing a boundary.** `localStorage`, a URL, a future replay or peer message (secure-coding rule 1; threat model §4). | Validate into a fresh object with known keys, never spread a parsed object. `last-mode.ts` and `local-store.ts` do this today; the rule is written to hold when replays/peers arrive. | `local-store.ts` / `last-mode.ts` tests; manifest parsing via `zod` at build |
| 13 | **CWE-77** Command Injection | **No.** Same as CWE-78 — no command interpreter at runtime. | `check-zero-cost.mjs` | N/A — no server runtime |
| 14 | **CWE-287** Improper Authentication | **No.** No authentication exists; there is no login to break (threat model, "no authentication"). | `epic:security` holds an issue for the day auth is introduced, so the decision is made when cheap | N/A — no auth |
| 15 | **CWE-269** Improper Privilege Management | **No.** No privilege levels, no roles, no admin surface. Both players are equal peers; a local player editing their own score has cheated at a game, not escalated privilege (SECURITY.md, out of scope). | — | N/A — no privileges |
| 16 | **CWE-502** Deserialization of Untrusted Data | **Yes.** Saved state, and future replays and peer messages, are all parsed. A crafted `__proto__` key would corrupt every object in the runtime (threat model §4, CWE-1321 below). | Parse into a fresh object with known keys; never spread/merge a parsed object; validate against a schema before use. Enforced today for stored state; the rule holds for replays/peers when they land. | `local-store.ts` (`isRecord`, keyed copy) and its tests; secure-coding rule 1 |
| 17 | **CWE-200** Exposure of Sensitive Information | **No — nothing to expose.** No personal data held; local storage never leaves the device and is per-origin. The one real exposure risk is a **secret in the bundle**, which is treated as its own control (CWE-798). | `check-bundle-secrets.mjs`; threat model item 4 ("no user data — a breach has nothing to take") | `check-bundle-secrets.mjs` |
| 18 | **CWE-863** Incorrect Authorization | **No (today).** No authorization logic to get wrong. Becomes applicable with the room server (#2363), same as CWE-862. | Tracked by #2363 | N/A today |
| 19 | **CWE-918** SSRF | **No.** No server to make a request; no gameplay path may reach the network at all. | `check-zero-cost.mjs` (no network on gameplay paths); threat model requirement 5 | `check-zero-cost.mjs` |
| 20 | **CWE-119** Improper Restriction of Memory Buffer Operations | **No.** Memory-safe VM; no buffers to overrun. | — | N/A — no unmanaged memory |
| 21 | **CWE-476** NULL Pointer Dereference | **Low / type-checked.** No null pointers; TypeScript `strict` plus explicit null handling. A `getActiveSeat` returning null was caught by the engine's own guard, not by a crash (HANDOFF.md). | `tsc --strict` across packages, test files and the app; typecheck in CI | `pnpm typecheck` |
| 22 | **CWE-798** Use of Hard-coded Credentials | **Yes — guarded, currently zero.** There are no credentials to embed today, but the mistake is easy (a key pasted while debugging), so it is enforced pre-emptively. | 17 credential formats + non-public env var patterns fail the build if anything credential-shaped reaches the bundle or source. GitHub push protection blocks a push containing a recognised secret. | `check-bundle-secrets.mjs`, `check-source-secrets.mjs`; push protection (SECURITY.md) |
| 23 | **CWE-190** Integer Overflow or Wraparound | **Low.** JS numbers are doubles; no fixed-width integer arithmetic. Simulation values are logical units on the fixed step, bounded by game rules and manifest limits (`logical.max` 10,000). | Deterministic simulation + termination guard would surface a runaway value as a non-terminating match | `termination.test.ts`; manifest schema bounds |
| 24 | **CWE-400** Uncontrolled Resource Consumption | **Partly — future.** Client-side: the fixed step and node-budgeted bots bound per-frame work (`bot-cost.test.ts`), and DoS-by-volume against a *static* origin is the CDN's job (SECURITY.md, out of scope). Server-side: applicable when the **room server** exists — cap rooms per identity, messages/sec, payload size, and expire idle rooms (#2363). | Today: bounded client work; DoS out of scope for a static origin. On arrival: #2363 rate/size caps. | `bot-cost.test.ts`; `check-zero-cost.mjs` session budget; #2363 (unbuilt) |
| 25 | **CWE-306** Missing Authentication for Critical Function | **No (today).** No critical function requires authentication because none exists. Becomes relevant with the room server and any future score submission (#2383): a score reaching a public board must be a verified claim, not an asserted one. | Tracked by #2383 (untrusted scores) and #2363 (room auth) | N/A today |

## The JavaScript-specific one the Top 25 folds into CWE-502

**CWE-1321 Prototype Pollution** is not a numbered Top-25 entry but is the deserialization risk
that actually applies to a JS codebase, and #2365 tracks it explicitly. It is mitigated by the
same rule as CWE-502 above: reject `__proto__` / `constructor` / `prototype` keys and build from
known keys into a fresh object, never spread a parsed one (`{ ...JSON.parse(raw) }` is the exact
anti-pattern secure-coding rule 1 forbids). Enforced today in `local-store.ts`; the rule must
hold for replays and peer messages when they exist.

## Applicable-and-unmitigated — the issues that must exist

#2391's acceptance says every applicable-but-unmitigated CWE has an open issue. The rows above
that are "future/partly" all resolve to already-filed issues rather than gaps this matrix
discovered:

- Room-server authorization and rate/size limits (CWE-862, 863, 400, 306) → **#2363**.
- Prototype pollution / unsafe deserialization for replays and peers (CWE-502, 1321) → **#2365**.
- Iframe/postMessage origin trust (CWE-1021, CWE-346 — OWASP, adjacent to CWE-20) → **#2367**.
- Untrusted client scores when a leaderboard exists (CWE-345/CWE-306-adjacent) → **#2383**.

Every applicable CWE that is *live today* (79, 20, 502, 798) has a named mitigation and an
automated guard in the rows above. Every one that is *not yet live* is not-applicable because the
feature that would make it applicable does not exist, and each has an `epic:security` issue so the
control is designed in when the feature is, not bolted on after.
