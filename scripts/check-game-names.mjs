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
 * What this does NOT do is rename anything. Forty-nine names are real exposure, but a
 * rename moves the catalogue card, the URL slug, SPEC.md, the manifest and every routing
 * test, and it breaks links that already exist. That is a product decision for the owner,
 * sequenced deliberately, not a cleanup a build script should perform. So the guard makes
 * the position visible and stops it getting worse, and #2515 tracks the renaming.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const catalogue = JSON.parse(readFileSync(`${ROOT}data/catalog.generated.json`, 'utf8')).games;
const clearance = JSON.parse(readFileSync(`${ROOT}data/name-clearance.json`, 'utf8'));

const STATUSES = new Set(['generic', 'renamed', 'pending', 'original']);

/**
 * How many games may still be `pending`. A ratchet, not a target.
 *
 * Without it a new game could copy its reference name and pass by being labelled
 * `pending`, which would make this guard a place to record the problem rather than one
 * that resists it. Renaming a game means lowering this number in the same commit.
 */
const PENDING_CEILING = 49;

/** Case, spacing and punctuation are not the question; the name is. */
const norm = (value) => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const failures = [];
const pending = [];

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
        `reference. Change the entry to "renamed" and lower PENDING_CEILING if it was pending.`,
    );
  }
  if (entry.status === 'pending') pending.push(game.id);
}

for (const id of Object.keys(clearance.games)) {
  if (!catalogue.some((game) => game.id === id)) {
    failures.push(`${id} — cleared here but not in the catalogue. Stale entry; remove it.`);
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

if (pending.length > PENDING_CEILING) {
  failures.push(
    `${String(pending.length)} games are pending, above the ceiling of ` +
      `${String(PENDING_CEILING)}. A new game may not take its reference name. If you have ` +
      `renamed games instead, lower PENDING_CEILING in this file to match.`,
  );
}

console.log(
  `check-game-names: ${String(catalogue.length)} games — ` +
    `${String(catalogue.length - pending.length)} cleared, ` +
    `${String(pending.length)} pending a rename decision (#2515, ceiling ${String(PENDING_CEILING)})`,
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
