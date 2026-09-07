#!/usr/bin/env node
/**
 * The online-multiplayer suitability table in `docs/online-suitability.md`, generated from
 * manifest data rather than maintained by hand (#237).
 *
 * Two facts decide a game's class, and both live in the manifest — so the classification is
 * derived, not asserted, and it cannot drift from the catalogue without this script noticing:
 *
 *   - **`archetype`** says how the two seats interact in time. A turn-based game (`turn-board`,
 *     `turn-aim`) has one seat acting at a time, so it tolerates any latency; a real-time game
 *     (`rt-split`, `rt-arena`, `rt-race`) has both seats acting at once, so it needs the fixed
 *     timestep run in lockstep with an input delay (issue #240) to stay in step across a wire.
 *   - **`sameInputClassOnly`** says the game cannot be made fair across input families
 *     (`docs/input-parity.md`), so an online match must pair two devices of the same class —
 *     both keyboards, or both touchscreens — rather than one of each.
 *
 * The archetype is read from `data/catalog.generated.json` (the build's own catalogue data,
 * which every non-game surface already reads); `sameInputClassOnly` is not in that file, so it
 * is read from each game's `packages/games/<id>/src/manifest.ts` directly. That field defaults
 * to `false` in the schema, so a manifest that does not mention it is `false`.
 *
 * Run `node scripts/emit-online-suitability.mjs` and paste the block it prints between the two
 * `<!-- generated:online-table -->` markers in the doc. It writes nothing on its own — the doc
 * is the artefact, and a generator that also owned the prose around the table would be a second
 * place the doc lived.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** How each archetype behaves over a network, and the work its online support implies. */
const ARCHETYPE_CLASS = {
  'turn-board': {
    class: 'Latency-tolerant',
    reason: 'One seat acts at a time; any latency is absorbed by the turn.',
  },
  'turn-aim': {
    class: 'Latency-tolerant',
    reason: 'One seat aims and commits a shot at a time; the wait is a turn, not a stall.',
  },
  'rt-split': {
    class: 'Lockstep',
    reason: 'Both seats act at once on separated halves; needs the fixed step run in lockstep.',
  },
  'rt-arena': {
    class: 'Lockstep',
    reason: 'Both seats act at once in a shared arena; needs the fixed step run in lockstep.',
  },
  'rt-race': {
    class: 'Lockstep',
    reason: 'Both seats act at once; rapid discrete input, so lockstep and same-input-class.',
  },
};

function readSameInputClassOnly(id) {
  const manifestPath = join(ROOT, 'packages', 'games', id, 'src', 'manifest.ts');
  if (!existsSync(manifestPath)) return { known: false, value: false };
  const src = readFileSync(manifestPath, 'utf8');
  // The field is written as an object literal key in the manifest; default is false when absent.
  const match = src.match(/sameInputClassOnly\s*:\s*(true|false)/);
  return { known: match !== null, value: match ? match[1] === 'true' : false };
}

const catalogue = JSON.parse(
  readFileSync(join(ROOT, 'data', 'catalog.generated.json'), 'utf8'),
).games;

const rows = catalogue
  .map((game) => {
    const archetype = game.archetype;
    const info = ARCHETYPE_CLASS[archetype] ?? {
      class: 'Unknown',
      reason: 'Unrecognised archetype',
    };
    const { value: sameClass } = readSameInputClassOnly(game.id);
    const restricted = sameClass || archetype === 'rt-race';
    return {
      id: game.id,
      name: game.name,
      archetype,
      class: info.class,
      restricted,
      sameClassDeclared: sameClass,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

// Group counts, for the summary the doc leads with.
const counts = {};
for (const row of rows) {
  const key = row.restricted ? `${row.class} (same-input-class)` : row.class;
  counts[key] = (counts[key] ?? 0) + 1;
}

const lines = [];
lines.push('| Game | Archetype | Online class | Remote pairing |');
lines.push('|---|---|---|---|');
for (const row of rows) {
  const pairing = row.restricted ? 'Same input class only' : 'Any pairing';
  lines.push(`| ${row.name} | \`${row.archetype}\` | ${row.class} | ${pairing} |`);
}

console.log(`# ${rows.length} games classified\n`);
for (const [key, n] of Object.entries(counts).sort()) {
  console.log(`# ${key}: ${n}`);
}
// Manifests that set sameInputClassOnly: true explicitly (rather than inheriting the default).
const declaredTrue = rows.filter((r) => r.sameClassDeclared).map((r) => r.id);
console.log(`# sameInputClassOnly: true declared by: ${declaredTrue.join(', ') || '(none)'}`);
const rtRaceNotDeclared = rows
  .filter((r) => r.archetype === 'rt-race' && !r.sameClassDeclared)
  .map((r) => r.id);
console.log(
  `# rt-race games NOT declaring the flag (inherit default false): ${rtRaceNotDeclared.join(', ') || '(none)'}`,
);
console.log('\n<!-- generated:online-table -->');
console.log(lines.join('\n'));
console.log('<!-- /generated:online-table -->');
