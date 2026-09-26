#!/usr/bin/env node
/**
 * Rule 1, for names: "Never copy art, audio, code, UI layouts, or names from another
 * product."
 *
 * `data/catalog.yaml` has always carried a `refName` for every game — the reference app's
 * own name for it — and until issue #2515 nothing compared it to ours. Eighty-nine of the
 * hundred and seven shipped names were identical to the reference, eight games had been
 * renamed and then the work stopped, and no decision was written down anywhere. The
 * repository was holding the evidence against itself and never reading it.
 *
 * This is the seventh rule in this codebase found to be a sentence rather than a check.
 * `pnpm size`, asset licensing and `roundSeconds` were the first three; HANDOFF.md tells
 * that story. The lesson each time: when a rule matters, run something.
 *
 * What this does NOT do is rename anything or establish trademark clearance. A rename moves
 * the catalogue card, the URL slug, SPEC.md, the manifest and every routing test, and it
 * breaks links that already exist. That is a product decision for the owner, sequenced
 * deliberately, not a cleanup a build script should perform. So the guard makes the
 * unresolved decisions visible and stops them growing, and #2515 tracks the renaming.
 *
 * ## Two baselines, and why the second one had to be added
 *
 * `data/name-clearance-pending.json` freezes two sets, and the difference between them is the
 * whole of what this guard learned the hard way.
 *
 * `pending` is the games that *say* they are unresolved. Ratcheting on it stops the unresolved
 * count growing — but it is keyed on a word, and the word is chosen by whoever adds the game.
 * A new game whose shipped name was byte-identical to its reference name walked straight past
 * it by writing `generic`: watched, with name and refName both "Shadow Clone" and a one-line
 * reason, exiting 0 at "109 games". The loop below promised that "a new or previously resolved
 * game may not take its reference name" while consulting a list that such a game never joins —
 * the docstring true, the code narrower, which is the failure this repository keeps a count of.
 *
 * `identical` is the games that *are* identical, whatever their entry claims, and it is the
 * allowlist #2515 actually asked for, made explicit. A game that arrives sharing its reference
 * name has to be written into it on purpose, where a reviewer sees the addition; a game that is
 * renamed has to leave it in the same change. Both lists are kept by hand for the same reason:
 * derive either from the catalogue and it accepts every regression by construction.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const catalogue = JSON.parse(readFileSync(`${ROOT}data/catalog.generated.json`, 'utf8')).games;
const clearance = JSON.parse(readFileSync(`${ROOT}data/name-clearance.json`, 'utf8'));
const baseline = JSON.parse(readFileSync(`${ROOT}data/name-clearance-pending.json`, 'utf8'));

const STATUSES = new Set(['generic', 'renamed', 'pending', 'original']);

/**
 * The unresolved games, by identity rather than count. The old ceiling remained 49 after
 * twelve decisions changed to generic, allowing twelve new pending names. Even a ceiling
 * of 37 would let a newly copied name replace one resolved in the same change.
 *
 * Keep this separate from the decisions: deriving it from their current statuses would
 * accept every regression by construction. A resolved entry must leave this baseline too,
 * so it cannot quietly become pending again later.
 */
const PENDING_IDS = new Set(baseline.pending);

/**
 * The games whose name is still the reference name, frozen by identity rather than by label.
 *
 * {@link PENDING_IDS} freezes the games that *say* they are unresolved. That is a ratchet on a
 * word, and the word is chosen by whoever adds the game: a new game whose name is byte-identical
 * to its reference ships green the moment its decision reads `generic`, because nothing below
 * ever puts it in `pending`. Watched: a game added with name and refName both "Shadow Clone" and
 * one line of clearance saying `generic` exited 0 at "109 games". That is the defect #2515 was
 * opened about, arriving by the front door.
 *
 * So this set freezes the games that *are* identical, whatever their entry claims. It is the
 * allowlist #2515 asked for, made explicit: a game that arrives identical has to be written down
 * here on purpose, where a reviewer sees it, and a game that is renamed has to leave here in the
 * same change. Deriving it from the catalogue would accept every regression by construction,
 * which is the reason the pending list is kept by hand too.
 */
const IDENTICAL_IDS = new Set(baseline.identical);

/** Case, spacing and punctuation are not the question; the name is. */
const norm = (value) => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const failures = [];
const pending = [];
const identicalNow = [];

for (const game of catalogue) {
  const entry = clearance.games[game.id];
  if (entry === undefined) {
    failures.push(
      `${game.id} — no entry in data/name-clearance.json. Every game needs a recorded name ` +
        `decision with a written reason; see the _status block in that file.`,
    );
    continue;
  }
  if (!STATUSES.has(entry.status)) {
    failures.push(`${game.id} — unknown status "${String(entry.status)}"`);
    continue;
  }
  if (typeof entry.why !== 'string' || entry.why.trim() === '') {
    failures.push(
      `${game.id} — status "${entry.status}" with no reason. A decision nobody wrote down is not a decision.`,
    );
    continue;
  }

  /**
   * A game with no reference name was not reimplemented from anything.
   *
   * Cricket arrived that way and this guard caught it on its first real encounter, which
   * is also how the gap was found: the three original statuses all assume a reference
   * exists to be identical to or different from, and "different from nothing" is not the
   * same claim as "we renamed it". Keeping them apart matters, because `renamed` says a
   * decision was taken and `original` says there was never anything to decide.
   */
  const hasReference = (game.refName ?? '').trim() !== '';
  if (entry.status === 'original' && hasReference) {
    failures.push(
      `${game.id} — recorded as original, but the catalogue gives it the reference name ` +
        `"${game.refName}". If it was reimplemented, it is generic, renamed or pending.`,
    );
    continue;
  }
  if (entry.status !== 'original' && !hasReference) {
    failures.push(
      `${game.id} — recorded as "${entry.status}", which claims a reference name, but the ` +
        `catalogue has none for it. An original game is "original".`,
    );
    continue;
  }
  if (entry.status === 'original') continue;

  /**
   * The reason has to name what it is about.
   *
   * The check above is that a reason exists, which `why: "x"` satisfies and so does the same
   * sentence pasted onto all 108. What it cannot see is drift: a reference name corrected in the
   * catalogue while the justification goes on quoting the old one, so the record argues about a
   * name the game no longer has. Requiring a `renamed` reason to quote the reference it moved
   * away from, and a `generic` reason to quote the name it is defending, ties the sentence to
   * the row. It went in green — all 18 renamed and all 52 generic reasons already do this — so
   * it holds a property the file has rather than asking for new work.
   *
   * It says nothing about whether the sentence is *true*. Nothing mechanical can.
   */
  if (entry.status === 'renamed' && !entry.why.includes(game.refName)) {
    failures.push(
      `${game.id} — recorded as renamed, but its reason never quotes the reference name ` +
        `"${game.refName}" it was renamed away from. A reason about a different name is drift.`,
    );
  }
  if (entry.status === 'generic' && !entry.why.includes(game.name)) {
    failures.push(
      `${game.id} — recorded as generic, but its reason never quotes "${game.name}", the name ` +
        `it is defending as ordinary.`,
    );
  }

  const identical = norm(game.name) === norm(game.refName);
  if (entry.status === 'renamed' && identical) {
    failures.push(
      `${game.id} — recorded as renamed, but "${game.name}" still matches the reference ` +
        `name "${game.refName}". A rename that was reverted is worse than one never made, ` +
        `because the record says it is done.`,
    );
  }
  if (entry.status !== 'renamed' && !identical) {
    failures.push(
      `${game.id} — recorded as "${entry.status}", but the name now differs from the ` +
        `reference. Change the entry to "renamed" and remove it from the pending baseline if it was pending.`,
    );
  }
  if (identical) identicalNow.push(game.id);
  if (entry.status === 'pending') pending.push(game.id);
}

for (const id of Object.keys(clearance.games)) {
  if (!catalogue.some((game) => game.id === id)) {
    failures.push(`${id} — recorded here but not in the catalogue. Stale entry; remove it.`);
  }
}

/**
 * The reference names must not reach the browser.
 *
 * They live in `data/catalog.generated.json`, which build scripts read and nobody serves;
 * `generate_catalog.py` strips them out of the TypeScript catalogue for exactly this
 * reason. That strip is one line, and it would be silently undone by anyone regenerating
 * the file from a copy of `entries` — which is how it was written wrong the first time,
 * within an hour of this guard being added. So the field is asserted absent rather than
 * assumed absent.
 *
 * Only the field is checked, and that is deliberate. Searching the shipped output for the
 * reference names themselves was tried twice and abandoned twice: scanning every emitted
 * chunk reported seven leaks and had found none, because "Memory", "Throw", "Ludo" and
 * "Sumo" are ordinary words that occur in unrelated game code; narrowing it to the
 * catalogue module still caught `"Memory"`, which is a *category*. A check that cries wolf
 * is worse than no check, because the next person learns to skip its output. The field is
 * the leak that can actually happen, and it is the one asserted.
 */
const shippedCatalogue = join(ROOT, 'apps', 'web', 'src', 'data', 'catalogue.generated.ts');
if (existsSync(shippedCatalogue) && readFileSync(shippedCatalogue, 'utf8').includes('refName')) {
  failures.push(
    'apps/web/src/data/catalogue.generated.ts carries a refName field. That module is ' +
      'bundled and served; the reference names are build-time data only.',
  );
}

if (PENDING_IDS.size !== baseline.pending.length) {
  failures.push('data/name-clearance-pending.json repeats a game id. Keep each exception once.');
}

if (IDENTICAL_IDS.size !== baseline.identical.length) {
  failures.push(
    'data/name-clearance-pending.json repeats a game id in "identical". Keep each one once.',
  );
}

for (const id of identicalNow) {
  if (!IDENTICAL_IDS.has(id)) {
    failures.push(
      `${id} — its name is the reference name, and it is not one of the games recorded as ` +
        'taking it. Rule 1 is the default; an exception is written down in the "identical" ' +
        'list of data/name-clearance-pending.json, with the reason in data/name-clearance.json.',
    );
  }
}

for (const id of IDENTICAL_IDS) {
  if (!identicalNow.includes(id)) {
    failures.push(
      `${id} — recorded as taking its reference name, and no longer does. Remove its id from ` +
        'the "identical" list in data/name-clearance-pending.json in the same change as the rename.',
    );
  }
}

for (const id of pending) {
  if (!PENDING_IDS.has(id)) {
    failures.push(
      `${id} — newly pending, outside the recorded baseline. A new or previously resolved ` +
        'game may not take its reference name, even when another pending name is resolved.',
    );
  }
}

for (const id of PENDING_IDS) {
  if (!pending.includes(id)) {
    failures.push(
      `${id} — in the pending baseline but no longer pending. Remove its id from ` +
        'data/name-clearance-pending.json in the same change as the recorded decision.',
    );
  }
}

console.log(
  `check-game-names: ${String(catalogue.length)} games — ` +
    `${String(catalogue.length - pending.length)} non-pending name decisions, ` +
    `${String(pending.length)} pending a rename decision (#2515)`,
);

if (failures.length > 0) {
  console.error('\ncheck-game-names: rule 1 name clearance\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    '\nRule 1 is that names are not copied from another product, and data/name-clearance.json\n' +
      'is where each game says which side of that line it is on, and why.',
  );
  process.exit(1);
}
