import { describe, expect, it } from 'vitest';
import { AudioSystem } from './audio.js';
import {
  SOUND_EVENTS,
  soundEventSpec,
  type GameSoundBus,
  type GameSoundEvent,
  type ShellSoundEvent,
  type SoundEvent,
} from './sound-events.js';

/**
 * The vocabulary is a specification, so most of what is worth asserting about it is
 * asserted by the compiler: the owner split is derived from the table rather than written
 * out beside it, and the `@ts-expect-error` below fails this package's typecheck the day
 * the narrowing stops narrowing. What is left for runtime is the part a type cannot hold —
 * that every entry actually says something, and that no two entries claim the same moment.
 */

const entries = Object.entries(SOUND_EVENTS);

describe('the sound vocabulary', () => {
  it('says of every cue who owns it, when it fires and what it means', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, spec] of entries) {
      expect(['shell', 'game'], `${name} has no owner`).toContain(spec.owner);
      // A sentence, not a label. An entry that says "on a hit" tells an implementer
      // nothing they did not already guess from the name.
      expect(spec.when.length, `${name} does not say when it fires`).toBeGreaterThan(20);
      expect(spec.means.length, `${name} does not say what it means`).toBeGreaterThan(20);
      expect(spec.when.endsWith('.'), `${name}'s "when" is not a sentence`).toBe(true);
      expect(spec.means.endsWith('.'), `${name}'s "means" is not a sentence`).toBe(true);
    }
  });

  it('gives no two cues the same moment', () => {
    // Two names for one moment is how a sound pack ends up with a recording nobody plays
    // and a cue nobody recorded.
    const moments = entries.map(([, spec]) => spec.when);
    expect(new Set(moments).size).toBe(moments.length);
    const meanings = entries.map(([, spec]) => spec.means);
    expect(new Set(meanings).size).toBe(meanings.length);
  });

  it('is owned on both sides, or the split it exists for would be theatre', () => {
    const owners = entries.map(([, spec]) => spec.owner);
    expect(owners).toContain('shell');
    expect(owners).toContain('game');
  });

  it('says nothing about a name it does not have', () => {
    expect(soundEventSpec('thwack')).toBeUndefined();
    // The guards read names out of source files, so this is asked about typos as often as
    // about cues, and `Object.prototype` is full of tempting answers.
    expect(soundEventSpec('toString')).toBeUndefined();
    expect(soundEventSpec('countdown')?.owner).toBe('shell');
  });
});

describe('the type of a cue', () => {
  it('sorts every name into exactly one owner', () => {
    // The two unions are derived from the table's `owner` field, so this is really an
    // assertion that the derivation and the data agree: the annotations are checked by the
    // compiler, and the loops check that the runtime table says the same thing. Flipping an
    // owner in `SOUND_EVENTS` fails both at once.
    const shell: ShellSoundEvent[] = ['countdown', 'start', 'pause'];
    const game: GameSoundEvent[] = ['hit', 'score', 'reject'];
    for (const name of shell) expect(soundEventSpec(name)?.owner, name).toBe('shell');
    for (const name of game) expect(soundEventSpec(name)?.owner, name).toBe('game');
    const every: SoundEvent[] = [...shell, ...game];
    expect(new Set(every).size).toBe(every.length);
  });

  it('will not let a game raise a shell cue', () => {
    // The whole of #168's "a game emitting a shell-owned cue is a bug", made a compile
    // error rather than a review comment. `AudioSystem` satisfies the narrow bus with no
    // wrapper — this line is also the assertion that it still does.
    const bus: GameSoundBus = new AudioSystem({ target: null });
    // @ts-expect-error the count-in belongs to the shell, and a game may not raise it.
    expect(bus.play('countdown')).toBe(false);
    // A cue a game does own type-checks, and is false only because no sound pack exists.
    expect(bus.play('hit')).toBe(false);
  });
});
