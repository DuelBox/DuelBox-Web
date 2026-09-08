#!/usr/bin/env node
/**
 * Validate every game manifest at build time.
 *
 * `parseGameManifest` is a runtime Zod parse. It only runs when a game module is
 * imported, and the web app imports games dynamically in the browser — so `pnpm build`
 * validated nothing. `tsc --build` executes no code, and `parseGameManifest` takes
 * `unknown`, so a manifest missing `logical` type-checked cleanly. Today the parse
 * happens at all only because seven test files happen to import their own manifest,
 * and `create-game.mjs` scaffolds no such test: a newly added game's manifest would
 * never have been parsed in CI.
 *
 * This walks the packages directly rather than the registry, so a game that exists but
 * is not yet wired into the shell is still checked.
 */

import { readdir, access, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const gamesDir = join(root, 'packages', 'games');

/** Simulation runs in these units and the renderer scales them; a silly box is a bug. */
const MIN_LOGICAL = 100;
const MAX_LOGICAL = 10_000;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { parseGameManifest } = await import(
    pathToFileURL(join(root, 'packages', 'game-sdk', 'dist', 'index.js')).href
  );

  const entries = await readdir(gamesDir, { withFileTypes: true });
  const packages = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  if (packages.length === 0) {
    console.error('validate-manifests: no game packages found — is this the right repo?');
    process.exitCode = 1;
    return;
  }

  const failures = [];
  const parsedManifests = [];
  let checked = 0;

  for (const name of packages) {
    const distManifest = join(gamesDir, name, 'dist', 'manifest.js');
    if (!(await exists(distManifest))) {
      failures.push(`${name}: no built manifest at dist/manifest.js — run \`pnpm build\` first`);
      continue;
    }

    let manifest;
    try {
      ({ manifest } = await import(pathToFileURL(distManifest).href));
    } catch (error) {
      failures.push(`${name}: manifest module failed to load — ${String(error)}`);
      continue;
    }

    if (manifest === undefined) {
      failures.push(`${name}: dist/manifest.js has no \`manifest\` export`);
      continue;
    }

    let parsed;
    try {
      parsed = parseGameManifest(manifest);
    } catch (error) {
      failures.push(`${name}: ${String(error).replace(/\s+/g, ' ').slice(0, 400)}`);
      continue;
    }

    // The schema already requires a positive integer box. These are the extra facts a
    // schema cannot express: that the numbers are sane, and that the declared id
    // matches the directory it lives in, so a copy-pasted manifest cannot go unnoticed.
    //
    // Both boxes, since #1886. `alternateLogical` is the second play area a game adopts when a
    // match starts with the device turned the other way, and it is the same kind of number as
    // the first — so a 5x9 second box would have sailed through `z.number().int().positive()`
    // exactly as a 5x9 first box would, which is the whole reason this bound exists at all.
    // The schema holds the *relationship* between the two (that the second really is the other
    // way round from the first); the sanity of the magnitudes belongs here beside its sibling.
    for (const [field, box] of [
      ['logical', parsed.logical],
      ['alternateLogical', parsed.alternateLogical],
    ]) {
      if (box === undefined) continue;
      for (const axis of ['width', 'height']) {
        const value = box[axis];
        if (value < MIN_LOGICAL || value > MAX_LOGICAL) {
          failures.push(
            `${name}: ${field}.${axis} is ${String(value)}, outside ${String(MIN_LOGICAL)}..${String(MAX_LOGICAL)}`,
          );
        }
      }
    }

    if (parsed.id !== name) {
      failures.push(
        `${name}: manifest id is "${parsed.id}" but the package directory is "${name}"`,
      );
    }

    checked += 1;
    parsedManifests.push({ name, manifest: parsed });
  }

  // The play-mode half of the check (#1749) — see the block at the foot of this file. It is
  // one call rather than lines inside this loop because it has to run the games, and running
  // 108 games inside a loop that is otherwise reading 108 files reads as one thing.
  const modes = await checkPlayModes(parsedManifests);
  failures.push(...modes.failures);
  for (const note of modes.notes) console.error(`  ! ${note}`);

  if (failures.length > 0) {
    console.error(`validate-manifests: ${String(failures.length)} problem(s)\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`validate-manifests: ${String(checked)} game manifest(s) valid`);
  console.log(`validate-manifests: ${describeOrientations(parsedManifests)}`);
}

/**
 * The catalogue's orientation spread, printed on every successful run.
 *
 * Not a check — it cannot fail, and it is here precisely because everything around it can. The
 * `orientation` field shipped in 108 manifests and was read by nothing at all until #1886, and
 * the thing that let that happen for so long is that nobody ever saw a number for it. A line in
 * the build log is the cheapest possible way for the next person to notice that the count of
 * games laid out for both orientations is still zero, or that it has stopped being zero.
 */
function describeOrientations(entries) {
  const counts = { portrait: 0, landscape: 0, any: 0 };
  let bothWays = 0;
  for (const { manifest } of entries) {
    counts[manifest.orientation] += 1;
    if (manifest.alternateLogical !== undefined) bothWays += 1;
  }
  return (
    `orientation — ${String(counts.portrait)} portrait, ${String(counts.landscape)} landscape, ` +
    `${String(counts.any)} either way up; ${String(bothWays)} with a second logical box (#1886)`
  );
}

/* ---------------------------------------------------------------------------------------
 * PLAY MODES (#1749). Everything from here to `await main()` is one self-contained block;
 * the only line above it that mentions any of it is the single `checkPlayModes` call in
 * `main`.
 * ---------------------------------------------------------------------------------------
 *
 * The issue asks for the build to fail when a game declares a mode it does not implement, and
 * the whole difficulty is in the word "implement". A manifest saying `modes: ['bot']` is a
 * string in a file; a check that reads a second string somewhere else and compares the two has
 * verified spelling, not behaviour. This repository has already been bitten by exactly that:
 * seven games were recorded solo-only in `data/catalog.yaml` while their manifests declared
 * `friend` and `bot`, and the fix (#2531) was to make the two files agree — after which they
 * agreed and one of them was still wrong. So the two checks below both refuse to believe a
 * second file.
 *
 * 1. A MODE NOTHING CAN START.
 *
 * `packages/game-sdk`'s vocabulary is `friend | bot | solo`. The shell's is `friend | bot`:
 * `PlayMode` in `apps/web/src/lib/match-setup.ts` has two members, `botSeatsFor` has a branch
 * for one of them and returns `undefined` for everything else, and `PlaySurface` draws a
 * button per member of the intersection. There is no route, no reducer state and no seating
 * rule anywhere in `apps/web` that puts one player alone in a match. A game declaring `solo`
 * is therefore not making a claim a game can keep or break — it is naming a mode the product
 * has no code path to reach, and no game can implement it. That is checked by reading
 * `PLAY_MODES` out of the shell's own source rather than restating it here, so the day a mode
 * is genuinely built the list moves once and this follows.
 *
 * 2. A GAME THAT DECLARES `bot` AND HAS NONE.
 *
 * This one is per game and it is the one that cannot be faked, because it is not a comparison
 * between two files at all: the built game is loaded and played. Two matches are stepped from
 * the same seed, one with a bot in the seat the shell would give it and one with the seat
 * empty, and every draw call of both is hashed. A game whose bot is absent, or accepted and
 * ignored, produces the same match twice and fails. Writing the word `bot` in a second file
 * does not change what `update()` does, and neither does calling `context.botDifficulty()` and
 * throwing the answer away.
 *
 * Which seat the bot takes depends on the archetype, and that is not a hedge:
 *
 *   - Real-time. `botSeatsFor` seats the bot at `p2` and leaves `p1` to the human, so the
 *     trace does the same. This is the shipped configuration, and it is stricter than
 *     `apps/web/src/data/bot-parity.test.ts`, which puts a bot in both seats — a game whose
 *     bot only runs when nobody human is present would pass there and be dead in the product.
 *   - Turn-based. A turn-board or turn-aim game with an absent human at `p1` never reaches
 *     `p2`'s turn, so a `p2`-only trace is a game sitting still and is identical whatever the
 *     bot would have done. Measured, not assumed: all 34 turn-based games in the catalogue
 *     produce byte-identical traces that way. The only honest reading available without
 *     synthesising a human's moves is the weaker one — bots in both seats must play a
 *     different match from nobody in either — so that is what is asked of them, and this
 *     comment is where a reader finds out that the two archetypes are held to different
 *     standards.
 *
 * `friend` is deliberately not checked behaviourally, and this is the third thing a reader
 * should know rather than assume. Distinguishing "two humans can play this" from "one can"
 * needs input synthesised for both seats through `InputManager`, per archetype, per control
 * scheme — a harness the size of the games it tests, and one whose failures would be its own
 * bugs more often than a game's. The manifest-level guard is real and lives in the schema:
 * `packages/game-sdk/src/manifest.ts` already refuses a manifest offering `friend` without the
 * shared-screen presentation. Claiming more than that here would be the fake.
 */

/** Long enough for every game in the catalogue to have done something distinguishable. */
const TRACE_STEPS = 60 * 25;
const TRACE_STEP_SECONDS = 1 / 60;
/** Fixed, because a trace that differed run to run would be measuring the clock. */
const TRACE_SEED = 20260908;

/**
 * The modes the shell can actually start, read out of the shell.
 *
 * Parsed from `apps/web/src/lib/match-setup.ts` rather than written down here, because a
 * second list is the defect this section exists to catch. `match-setup.test.ts` holds that
 * array against the `PlayMode` union declared beside it, in both directions, so the two
 * readers of that file — this script and `app/metadata-claims.test.ts` — cannot come to
 * different conclusions about what a player is offered.
 *
 * An unreadable declaration is a failure with a sentence in it, never an empty set: a reader
 * that quietly returned nothing would report every game as declaring unstartable modes, which
 * is at least loud, or — with the polarity one line different — pass everything in silence.
 */
async function startableModes() {
  const path = join(root, 'apps', 'web', 'src', 'lib', 'match-setup.ts');
  const source = await readFile(path, 'utf8');
  const body = /export const PLAY_MODES = \[([^\]]*)\]/.exec(source)?.[1];
  const found = body === undefined ? [] : [...body.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  if (found.length === 0) {
    throw new Error(
      'validate-manifests: apps/web/src/lib/match-setup.ts no longer declares `export const' +
        ' PLAY_MODES = [ ... ]` as string literals, so this script cannot tell which modes the' +
        ' shell can start. Point it at whatever replaced it.',
    );
  }
  return new Set(found);
}

/**
 * Declarations known to name a mode nothing can start, recorded rather than accepted.
 *
 * These six manifests declare `solo`. Their own comments say why, and the reason is honest:
 * the catalogue row records the reference app's game, which is solitaire, and `solo` stays in
 * the manifest so that `catalogue-manifest.test.ts` does not report the row and the manifest
 * as disagreeing. The product cannot start any of them — `/games/sudoku/` renders a "Play
 * solo. Chase your own best score, no opponent needed." card and `/play/sudoku/` offers "Play
 * together here" and "Play against Pip" and nothing else — so six landing pages promise a mode
 * the lobby one click away does not have. It is #2531's defect turned around: the catalogue
 * and the manifests now agree, and what they agree on is still not true of the product.
 *
 * They are listed rather than waved through, and the list is held from both ends: a
 * declaration that is NOT here fails the build outright, and an entry here that has stopped
 * being true fails the build too, saying to delete the line. A quarantine that can only grow
 * is a second way of spelling "ignored".
 *
 * The fix is one word out of six manifests and six catalogue rows. Both are outside the file
 * set of the pass that wrote this, which is the only reason it is a list and not a diff.
 */
const UNSTARTABLE_DECLARATIONS = [
  ['animal-stack', 'solo'],
  ['blocks', 'solo'],
  ['brainrot-stack', 'solo'],
  ['maze-paint', 'solo'],
  ['solitaire', 'solo'],
  ['sudoku', 'solo'],
];

/**
 * A short, deterministic record of what a match looked like, hashed.
 *
 * It records what the game DRAWS, not what it scores, and the distinction is load-bearing: a
 * score-only trace reports a game as ignoring its bot when the truth is that nobody has scored
 * yet twenty-five seconds in. `bot-parity.test.ts` records finding exactly that on Hot Potato,
 * and this file inherits the lesson twice over — at 600 steps `hand-slap` and `hot-potato`
 * still trace identically with a bot and without one, and at 1500 neither does, which is why
 * the count is what it is. Every position, radius and line width crosses the renderer, so
 * hashing the numbers passed to it sees any difference at all in how the match is going, while
 * staying inside the `Game` contract: `render` is the only window a game is obliged to offer
 * onto its state.
 */
function traceMatch(engine, create, manifest, botFor) {
  const { InputManager, InputView, Rng } = engine;
  const game = create();
  game.init({
    manifest,
    rng: new Rng(TRACE_SEED),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    reducedMotion: false,
    botDifficulty: botFor,
  });

  const input = new InputManager(manifest.logical, {
    split: manifest.zoneSplit === 'vertical' ? 'vertical' : 'horizontal',
    bottomSeat: 'p1',
  });
  const view = new InputView();

  // A rolling hash rather than the numbers themselves: a match draws tens of thousands of
  // them and only whether two traces differ is being asked.
  let hash = 2166136261;
  const record = (...args) => {
    for (const arg of args) {
      if (typeof arg !== 'number') continue;
      hash ^= Math.round(arg * 1000) | 0;
      hash = Math.imul(hash, 16777619);
    }
  };
  const noop = () => undefined;
  const renderer = {
    clear: noop,
    rect: record,
    strokeRect: record,
    circle: record,
    strokeCircle: record,
    line: record,
    text: record,
    pushSeatRotation: noop,
    pushRotation: noop,
    popSeatRotation: noop,
  };

  const seen = [];
  try {
    for (let step = 0; step < TRACE_STEPS; step += 1) {
      game.update(TRACE_STEP_SECONDS, view.sync(input.beginStep(TRACE_STEP_SECONDS)));
      if (step % 15 !== 0) continue;
      game.render(renderer, 0);
      const score = game.getScore();
      seen.push(`${String(score.p1)}:${String(score.p2)}:${String(hash >>> 0)}`);
      if (score.winner !== null) break;
    }
  } finally {
    game.destroy();
  }
  return seen.join('|');
}

/**
 * Whether a game that declares `bot` has one that plays. Returns a failure line, or null.
 *
 * Turn-based games are handed bots in both seats and real-time games a bot at `p2` only; the
 * reasoning is in the block comment at the top of this section, and it is the difference
 * between what the shell ships and what can be observed with no human at the controls.
 */
function botFailureFor(name, manifest, create, engine) {
  const turnBased = manifest.archetype.startsWith('turn-');
  const seated = turnBased ? () => 'hard' : (seat) => (seat === 'p2' ? 'hard' : null);
  let withBot;
  let without;
  try {
    withBot = traceMatch(engine, create, manifest, seated);
    without = traceMatch(engine, create, manifest, () => null);
  } catch (error) {
    return (
      `${name}: declares "bot", and playing a match to check it threw — ` +
      String(error).replace(/\s+/g, ' ').slice(0, 200)
    );
  }
  if (withBot.length === 0) {
    return `${name}: declares "bot" and drew nothing at all in ${String(TRACE_STEPS)} steps`;
  }
  if (withBot !== without) return null;
  const where = turnBased ? 'in both seats' : 'in seat two';
  return (
    `${name}: declares "bot" but does not implement one. A match with a hard bot ${where} ` +
    'draws exactly the same frames as a match with nobody there, so nothing is playing that ' +
    'seat. Either the game never reads context.botDifficulty(), or it reads it and the answer ' +
    'reaches no decision. Remove "bot" from the manifest, or make the bot move.'
  );
}

/**
 * Both play-mode checks, over every manifest that parsed.
 *
 * Failures and notes come back separately: a note is printed on every run whether or not the
 * build fails, because a quarantined declaration nobody is ever shown is a declaration nobody
 * will ever fix.
 */
async function checkPlayModes(entries) {
  const failures = [];
  const notes = [];
  const startable = await startableModes();

  const quarantined = new Set(UNSTARTABLE_DECLARATIONS.map(([id, mode]) => `${id} ${mode}`));
  const used = new Set();

  for (const { name, manifest } of entries) {
    for (const mode of manifest.modes) {
      if (startable.has(mode)) continue;
      const key = `${name} ${mode}`;
      if (quarantined.has(key)) {
        used.add(key);
        notes.push(
          `${name}: declares "${mode}", which nothing in apps/web can start. Known, and ` +
            'recorded in scripts/validate-manifests.mjs (#1749): its landing page offers the ' +
            'mode and its lobby has no button for it.',
        );
        continue;
      }
      failures.push(
        `${name}: declares the mode "${mode}", which the shell cannot start. ` +
          `apps/web/src/lib/match-setup.ts offers ${[...startable].join(' and ')}, and the ` +
          'lobby draws a button per member of that list — so this mode reaches no player, and ' +
          'no game can implement a mode with no code path to it. Either build the mode in the ' +
          'shell first, or take it out of the manifest.',
      );
    }
  }

  for (const [id, mode] of UNSTARTABLE_DECLARATIONS) {
    if (used.has(`${id} ${mode}`)) continue;
    failures.push(
      `${id}: is recorded in validate-manifests.mjs as declaring the unstartable mode ` +
        `"${mode}" and no longer does. Delete that line — a list of known-bad declarations ` +
        'that keeps entries after they are fixed stops being evidence of anything.',
    );
  }

  const wantBots = entries.filter(({ manifest }) => manifest.modes.includes('bot'));
  if (wantBots.length > 0) {
    const engine = await import(
      pathToFileURL(join(root, 'packages', 'engine', 'dist', 'index.js')).href
    );
    for (const { name, manifest } of wantBots) {
      const distModule = join(gamesDir, name, 'dist', 'index.js');
      if (!(await exists(distModule))) {
        failures.push(
          `${name}: declares "bot" but has no dist/index.js to run, so the claim cannot be ` +
            'checked. Run `pnpm build` first.',
        );
        continue;
      }
      let create;
      try {
        const loaded = await import(pathToFileURL(distModule).href);
        create = (loaded.default ?? loaded).create;
      } catch (error) {
        failures.push(
          `${name}: declares "bot" and its module failed to load — ${String(error).slice(0, 200)}`,
        );
        continue;
      }
      if (typeof create !== 'function') {
        failures.push(`${name}: declares "bot" but exports no create(), so nothing can play it`);
        continue;
      }
      const failure = botFailureFor(name, manifest, create, engine);
      if (failure !== null) failures.push(failure);
    }
  }

  return { failures, notes };
}

await main();
