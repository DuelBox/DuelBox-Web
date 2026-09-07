# Abuse and DMCA response procedure

A claim with nowhere to go escalates to the host instead of reaching us (#216). `SECURITY.md`
is the public contract and internal procedure for a *vulnerability*; this is the same for a
**copyright (DMCA) or abuse** report. The public-facing version — how to contact us, and what to
send — lives at the `/dmca/` route. This document is the **internal** side: who handles a report,
in what order, and by when. It deliberately mirrors `SECURITY.md`'s structure so the two read the
same way.

> **Contact address is a placeholder.** Throughout this procedure and on the `/dmca/` route the
> contact is `abuse@duelbox.example`, which **is not a real inbox.** Before launch the owner must
> replace it everywhere with a real, monitored address (and, for DMCA specifically, register a
> designated agent with the U.S. Copyright Office if the DMCA safe harbour is being relied on).
> Until then, no timeline below can actually start, because nothing is being received.

## What this covers

- **Copyright and trademark claims (DMCA and equivalents).** Someone asserting that a game's
  name, art, sound, code or a page's layout copies theirs. DuelBox's whole originality posture
  (CLAUDE.md rule 1, `docs/differentiation-brief.md`, the `data/name-clearance.json` record) is
  the standing answer to most of these, which is exactly why a claim should reach us and be
  answered rather than reach the host and be actioned blind.
- **Abuse reports.** Content or behaviour someone believes is harmful. The surface is small — no
  accounts, no user-generated content, no comments, no uploads (threat model) — so in practice
  this is narrow today, but the channel must exist before launch.
- **Not vulnerabilities.** A security weakness goes through `SECURITY.md`'s private-advisory
  route, not here. The `/dmca/` route and the security contact both say so, so a reporter is not
  bounced between two inboxes.

## How a report reaches us

- **Email `abuse@duelbox.example`** (placeholder — see the note above), the address published on
  `/dmca/`.
- A **public GitHub issue** is acceptable for something already public, but a claim asserting
  infringement should prefer email so it is not amplified before it is assessed.

### What a usable DMCA notice contains

The `/dmca/` route asks a reporter for these so a notice arrives actionable rather than starting a
round-trip. A valid takedown notice under 17 U.S.C. §512(c)(3) needs:

1. Identification of the copyrighted work claimed to be infringed.
2. Identification of the material on DuelBox said to infringe it, with enough detail to find it —
   a URL, a game name, a specific screen.
3. The reporter's contact details.
4. A statement of good-faith belief that the use is not authorised.
5. A statement, under penalty of perjury, that the notice is accurate and the reporter is
   authorised to act for the rights holder.
6. The reporter's physical or electronic signature.

## Who handles it

The same ownership as a security report (`SECURITY.md`, `.github/CODEOWNERS`): reports go to the
repository owner, [@jatinsingh1603](https://github.com/jatinsingh1603). A claim touching
`packages/engine`, `packages/game-sdk` or anything under `.github/` is that person's to assess and
cannot be delegated by default; a claim against a single game package's name or art may be handed
to whoever is working on it, but the **decision to change or remove anything ships as a normal
reviewed change**, never as an out-of-band edit.

## Timeline

Mirroring `SECURITY.md`'s table, so a reporter knows what to expect and we have a clock to answer
to. Working days.

| | |
|---|---|
| Acknowledgement of receipt | within **3 working days** |
| First assessment — is it a valid claim, what does it concern, is it in scope | within **10 working days** |
| Action or a dated plan — take down, correct, counter, or explain why no change is warranted | within **14 working days** of the assessment |
| Counter-notice window (DMCA) | the statutory **10–14 business days** before restoring material removed on a notice, if a valid counter-notice is received |

If a claim is clearly valid and the fix is small — a name, a tile — it is actioned inside the
assessment window rather than waiting for the plan step. Speed favours us here: DuelBox holds no
user content, so removing or renaming our own material costs a commit, not a negotiation.

## The procedure

1. **Acknowledge.** Reply within the acknowledgement window confirming receipt and the reference
   for the report. Do not admit or deny the claim in the acknowledgement.
2. **Assess.** Decide which of four the report is:
   - **Valid and simple** — a name or asset that should change. Action it as a reviewed change
     (rename via the `data/name-clearance.json` decision record and the rename sequencing in
     `scripts/check-game-names.mjs`; remove or replace an asset via its `assets.license.json`
     entry). Reply when it ships.
   - **Valid but wrong target** — the material named is not what infringes, or is already
     original. Reply with the evidence: the name-clearance entry, the licence entry, the
     originality review (#2339). This is the case the whole record exists to answer.
   - **Invalid or abusive** — a notice that does not meet §512(c)(3), or a bad-faith claim. Reply
     explaining what is missing; do not take material down on an invalid notice.
   - **Out of scope** — a vulnerability, or a complaint about a third-party host. Redirect to
     `SECURITY.md` or the host, and say so.
3. **Act or plan.** Ship the change, or send a dated plan, within the action window. A takedown is
   recorded with what was removed and why.
4. **Record.** Every report, its assessment, and the outcome go in a private log with a date and
   an owner — the same discipline `docs/secure-coding.md` sets for a security finding: a report
   with no recorded decision is a report nobody owns. Accepted-no-change outcomes are recorded
   too, because they are the evidence if the same claim returns.
5. **Counter-notice (DMCA).** If material was removed and the uploader — here, us — believes the
   removal was mistaken, the counter-notice process and its statutory waiting period apply before
   restoration. Since DuelBox hosts only its own material, this is the path for *contesting* a
   takedown of our own work rather than for third-party content.

## What makes most claims short

The record is built in advance, which is the point of building it in advance:

- **Names** — `data/name-clearance.json` records, per game, whether the name is a public-domain
  or descriptive term (kept) or a coined name (tracked for a rename decision), each with a written
  reason. `check-game-names.mjs` keeps it complete.
- **Assets** — `assets.license.json` records the source, licence and author of every shipped
  asset; the catalogue art is original and generated from code in the repository.
- **Layout and screens** — the originality review (#2339) places our screens beside the reference
  app's and records a verdict per pair, filed as "the standing answer to an originality
  challenge".

A claim we can answer in a day with a document we already wrote is a claim that never becomes the
host's problem, which is the entire reason this channel exists.
