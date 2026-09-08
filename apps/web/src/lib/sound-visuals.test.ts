import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SOUND_EVENTS, soundEventSpec } from '@duelbox/engine';
import { VISUAL_COUNTERPARTS, emittedCuesIn, undeclaredCuesIn } from './sound-visuals';

/**
 * The guard #180 actually needs: not "is there a table", but "does every cue that exists
 * have something drawn for it, and is anything emitting a cue nobody declared".
 *
 * Read `sound-visuals.ts` for why the coverage is derived rather than listed — #2519 is the
 * version of this check that walked its own table and therefore could not see the cue that
 * was never written down. Three things are walked here and none of them is a list kept by
 * hand: the vocabulary, the shell files the table points at, and every game package on disk.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const games = join(root, 'packages', 'games');

/** Block and line comments removed: prose about a thing is not the thing. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // `dist` holds a compiled copy of everything in `src`, and counting it would double
      // every finding and report a file nobody edits.
      if (entry !== 'dist' && entry !== 'node_modules') sources(path, found);
    } else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) {
      found.push(path);
    }
  }
  return found;
}

describe('every cue has something drawn for it', () => {
  const cues = Object.keys(SOUND_EVENTS);

  it('has a vocabulary to check', () => {
    // The first thing to go wrong with a derived guard is that it derives nothing.
    expect(cues.length).toBeGreaterThan(5);
  });

  it('answers every name in the vocabulary', () => {
    // The compiler already fails a missing row — the table is `Record<SoundEvent, …>` — so
    // what is left for runtime is the row that exists and says nothing, which typechecks
    // perfectly.
    for (const cue of cues) {
      const counterpart = VISUAL_COUNTERPARTS[cue as keyof typeof VISUAL_COUNTERPARTS];
      expect(counterpart, `${cue} has no visual counterpart`).toBeDefined();
      expect(counterpart.shows.length, `${cue} does not say what is drawn`).toBeGreaterThan(20);
      if (counterpart.kind === 'game') {
        expect(counterpart.requires.length, `${cue} asks nothing of a game`).toBeGreaterThan(40);
      }
    }
  });

  it('points at shell code that is still drawing it', () => {
    // The half that keeps working after the vocabulary settles: this fails when somebody
    // deletes the countdown, renames the winner line, or takes the bump off the score — none
    // of which looks like an accessibility change while it is being made.
    const shell = Object.entries(VISUAL_COUNTERPARTS).filter(([, part]) => part.kind === 'shell');
    expect(shell.length, 'no counterpart is drawn by the shell at all').toBeGreaterThan(3);
    for (const [cue, part] of shell) {
      if (part.kind !== 'shell') continue;
      const path = join(root, part.source);
      expect(existsSync(path), `${cue} points at a file that is gone: ${part.source}`).toBe(true);
      const code = stripComments(readFileSync(path, 'utf8'));
      expect(code.includes(part.marker), `${cue} is no longer drawn in ${part.source}`).toBe(true);
    }
  });
});

describe('what a game emits', () => {
  const files = sources(join(games));

  it('finds the catalogue to check', () => {
    // #2519's flaw, guarded against directly: a scan that silently walks nothing passes
    // every time and is worth less than no scan, because it is believed.
    expect(files.length).toBeGreaterThan(300);
    expect(readdirSync(games).length).toBeGreaterThan(100);
  });

  it('emits nothing the vocabulary has not declared, and nothing the shell owns', () => {
    // Empty today — no game emits a cue at all, and the audio bus a game would emit through
    // has not landed. That is the point: the check is older than the thing it checks, so the
    // first game to wire a sound meets it rather than being reviewed by hand.
    const offenders: string[] = [];
    for (const path of files) {
      const undeclared = undeclaredCuesIn(readFileSync(path, 'utf8'));
      for (const cue of undeclared) offenders.push(`${relative(root, path)}: ${cue}`);
    }
    expect(
      offenders,
      'a game emits a cue that is not a declared game cue — add it to packages/engine/src/sound-events.ts with a visual counterpart, or stop emitting it',
    ).toEqual([]);
  });

  it('leaves every game playable with sound off, because every cue it emits has a visual (#180)', () => {
    // #180's acceptance, made machine-checkable: a game is playable with sound off exactly
    // when nothing it signals is carried by sound alone, i.e. every cue it emits also has a
    // visual counterpart. `VISUAL_COUNTERPARTS` is typed total over the vocabulary, so this
    // holds by construction for any declared cue; here it is checked against what the games
    // *actually* emit, so the guarantee is over the catalogue rather than over the type.
    //
    // Vacuously true today — no game emits a cue — which is the honest state: full per-game
    // verification against real sounds is blocked on the audio bus that does not exist yet
    // (#169/#170), and this becomes load-bearing the day the first cue is wired. See
    // docs/audio-visual-cues.md.
    const missing: string[] = [];
    for (const path of files) {
      for (const cue of emittedCuesIn(readFileSync(path, 'utf8'))) {
        const spec = soundEventSpec(cue);
        // A shell-owned cue is the shell's to draw and is covered by the counterpart table
        // above; a game-owned cue must have a row, which the type guarantees but this names.
        if (spec?.owner === 'game' && !(cue in VISUAL_COUNTERPARTS)) {
          missing.push(`${relative(root, path)}: ${cue}`);
        }
      }
    }
    expect(missing, 'a game emits a cue with no visual counterpart').toEqual([]);
  });
});

describe('the seam a game would emit through', () => {
  const contract = readFileSync(join(root, 'packages/game-sdk/src/contract.ts'), 'utf8');
  const context = /export interface GameContext \{([\s\S]*?)\n\}/.exec(contract)?.[1] ?? '';

  it('found GameContext to read', () => {
    // The control. A regex that stopped matching would make every assertion below pass on an
    // empty string, which is the failure #2519 is on the tally for.
    expect(context, 'GameContext is no longer declared the way this reads it').toContain(
      'readonly manifest',
    );
  });

  /**
   * **`GameContext` carries no way to make a sound, and this is what says so out loud.**
   *
   * Eight of the fourteen cues are `owner: 'game'`, and a game is handed a `GameContext` and
   * nothing else — so today not one of them can be raised by anybody. That is why the two
   * scans above are honest about being vacuous: they walk 108 packages for emissions that
   * cannot exist.
   *
   * A guard that can only pass is worth nothing on its own, so this one is aimed at the
   * moment it stops being vacuous rather than at the state it is in. The day somebody adds
   * an audio bus to the context — which is `GameSoundBus`'s whole reason to exist — this
   * fails, and the message is the review: every cue that seam makes reachable owes the
   * drawn half in `VISUAL_COUNTERPARTS`, and #180's acceptance stops being true by
   * construction and starts needing a per-game pass.
   */
  it('has none, so no game can carry information by sound alone (#180)', () => {
    const seam = /\b(audio|sound|cue|bus|play)\b/i.exec(context)?.[0];
    expect(
      seam,
      'GameContext has grown something that looks like an audio seam. That is not a bug — it' +
        ' is what GameSoundBus was written for — but it is the moment #180 stops holding by' +
        ' construction. Before landing it: every game cue it makes reachable needs its row in' +
        ' apps/web/src/lib/sound-visuals.ts to be a promise somebody has checked on a real' +
        ' screen, and the per-game pass in that issue becomes due. Then delete this test and' +
        ' say in its place what replaced it.',
    ).toBeUndefined();
  });
});

describe('the emission scan itself', () => {
  /** A game file as it would look the day somebody wires the first sound. */
  const FIXTURE = `
    // The delivery used to call this.#audio.play('bounce') and no longer does.
    this.#audio.play('launch');
    this.#audio.playVaried('thwack', this.#rng);
    bus.emit('countdown');
  `;

  it('reads an emission and not a mention of one', () => {
    // Cricket's file names four cues in a paragraph about deliberately emitting none. A
    // scanner that could not tell those apart would report the most careful file in the
    // catalogue and teach the next reader to ignore it.
    expect(emittedCuesIn(FIXTURE)).toEqual(['launch', 'thwack', 'countdown']);
  });

  it('flags a name nobody declared and a cue the shell owns', () => {
    // The two failures this exists for, proven on a fixture because the catalogue provides
    // neither: `thwack` is the private vocabulary a game invents when there is no shared one,
    // and `countdown` is a game doing the shell's job.
    expect(undeclaredCuesIn(FIXTURE)).toEqual(['thwack', 'countdown']);
    expect(undeclaredCuesIn("audio.play('hit');")).toEqual([]);
  });
});
