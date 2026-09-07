import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AudioSystem,
  EngineSoundBus,
  InputManager,
  InputView,
  RecordingSoundBus,
  Rng,
  SOUND_EVENTS,
  SOUND_EVENT_SPECS,
} from '@duelbox/engine';
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  AudioSampleBuffer,
  AudioState,
  GainNodeLike,
  SeatId,
  SoundBus,
  SoundEvent,
} from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { LOADERS_FOR_TEST } from './registry';
import {
  GAME_CUE_REQUIREMENT,
  GAME_CUE_VISUALS,
  SHELL_CUE_VISUALS,
  type VisualCue,
} from './audio-cues';

/**
 * Issue #180, made checkable: **every audio cue has something a player can see.**
 *
 * The issue could not be satisfied *or* violated before there was any audio at all. It can
 * be violated now, so this is what stops it. Three things are asserted, and only the third
 * is expensive:
 *
 * 1. Every name in the closed vocabulary has a declared visual counterpart.
 * 2. Every counterpart names a **real line in a real file**, which is read from disk. This
 *    is the half that keeps working after the table is written: deleting the countdown
 *    numeral, or the impact marker in a game, turns this red.
 * 3. Every game wired to the bus is **played**, every cue it actually raises is collected,
 *    and each one must have a counterpart of its own — and each declared counterpart must
 *    correspond to a cue the game really raises, so the table cannot rot in either
 *    direction.
 *
 * It also holds the property the whole design rests on: a match steps identically with a
 * live audio system, with a recording bus, and with no bus at all.
 *
 * ## Watched failing, on purpose
 *
 * Per CLAUDE.md — "when a rule matters, run the thing that is supposed to execute it and
 * watch it fail on purpose". Three mutations were made and reverted while writing this:
 *
 * | mutation | result |
 * |---|---|
 * | Air Hockey emits `fault` with no entry in `GAME_CUE_VISUALS` | red: "raises fault ... nothing a player can see" |
 * | the `#impactSteps = FLASH_STEPS` marker deleted from Air Hockey | red: "token ... is not in packages/games/air-hockey/src/game.ts" |
 * | `hit` declared for Air Hockey but never emitted | red: "declares a visual for hit ... never raises it" |
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const STEP = 1 / 60;

/** Long enough for Air Hockey to serve, rebound, be struck and be scored past. */
const STEPS = 60 * 100;

function readSource(file: string): string {
  const path = REPO_ROOT + file;
  if (!existsSync(path)) throw new Error(`audio-cues names a file that does not exist: ${file}`);
  return readFileSync(path, 'utf8');
}

function expectEvidence(label: string, cue: VisualCue): void {
  expect(cue.indicator.length, `${label} names no indicator`).toBeGreaterThan(10);
  const source = readSource(cue.file);
  expect(
    source.includes(cue.token),
    `${label}: the token that proves its visual counterpart exists is not in ${cue.file}.\n` +
      `Looked for: ${cue.token}\n` +
      `Either the drawing was removed — in which case the cue is now audio-only, which ` +
      `#180 forbids — or it moved and audio-cues.ts needs to say where.`,
  ).toBe(true);
}

/** Plays a game with the given bus and reports where it ended up and what it said. */
function play(
  slug: string,
  load: () => Promise<{ manifest: GameContext['manifest']; create: () => unknown }>,
  audio?: SoundBus,
): Promise<{ signature: string }> {
  return load().then((loaded) => {
    const module = loaded as unknown as {
      manifest: GameContext['manifest'];
      create: () => {
        init(context: GameContext): void;
        update(dt: number, input: ReturnType<InputView['sync']>): void;
        getScore(): { p1: number; p2: number; winner: SeatId | 'draw' | null };
        destroy(): void;
      };
    };
    const game = module.create();
    const context: GameContext = {
      manifest: module.manifest,
      rng: new Rng(20260829),
      presentation: 'shared-screen',
      localSeat: 'p1',
      openingSeat: 'p1',
      botDifficulty: () => 'hard',
      // Omitted rather than passed as undefined when there is none: that is the shape of
      // every existing test double in the repository, and it must keep compiling.
      ...(audio ? { audio } : {}),
    };
    game.init(context);
    const input = new InputManager(
      { width: 1000, height: 1000 },
      { split: 'horizontal', bottomSeat: 'p1' },
    );
    const view = new InputView();
    let steps = 0;
    try {
      for (; steps < STEPS; steps += 1) {
        game.update(STEP, view.sync(input.beginStep(STEP)));
        if (game.getScore().winner !== null) break;
      }
    } finally {
      game.destroy();
    }
    const score = game.getScore();
    void slug;
    return {
      signature: `${String(steps)}:${String(score.p1)}-${String(score.p2)}-${String(score.winner)}`,
    };
  });
}

const WIRED = Object.keys(GAME_CUE_VISUALS);

describe('every sound has something to see', () => {
  it('declares a counterpart for every cue in the vocabulary', () => {
    for (const event of SOUND_EVENTS) {
      const source = SOUND_EVENT_SPECS[event].source;
      const declared =
        source === 'shell'
          ? event in SHELL_CUE_VISUALS
          : event in GAME_CUE_REQUIREMENT;
      expect(
        declared,
        `${event} is in the vocabulary and nothing says what a player sees instead of ` +
          `hearing it. Add it to ${source === 'shell' ? 'SHELL_CUE_VISUALS' : 'GAME_CUE_REQUIREMENT'}.`,
      ).toBe(true);
    }
  });

  it('declares nothing that is not in the vocabulary', () => {
    for (const event of [...Object.keys(SHELL_CUE_VISUALS), ...Object.keys(GAME_CUE_REQUIREMENT)]) {
      expect(SOUND_EVENTS).toContain(event as SoundEvent);
    }
  });

  it.each(Object.entries(SHELL_CUE_VISUALS))('%s is drawn by the shell, still', (event, cue) => {
    expectEvidence(`the shell cue "${event}"`, cue);
  });

  it.each(Object.entries(GAME_CUE_REQUIREMENT))('%s tells a game what to draw', (_event, rule) => {
    expect(rule.length).toBeGreaterThan(20);
  });
});

describe('every game that makes a sound also shows it', () => {
  it('has at least one game wired, or it is guarding nothing', () => {
    // The shape of failure `docs/parallel-work.md` names: an `it.each` over an empty list
    // is loud, but a list that has quietly become shorter is not. One is the floor today;
    // it rises as the other 106 are wired.
    expect(WIRED.length).toBeGreaterThanOrEqual(1);
    for (const slug of WIRED) expect(LOADERS_FOR_TEST[slug], `${slug} is not registered`).toBeDefined();
  });

  it.each(WIRED)('%s shows everything it says', async (slug) => {
    const load = LOADERS_FOR_TEST[slug];
    expect(load, `${slug} has no loader`).toBeDefined();
    const bus = new RecordingSoundBus();
    await play(slug, load!, bus);

    const raised = bus.distinct();
    expect(raised.length, `${slug} is declared as wired and raised no cue at all`).toBeGreaterThan(
      0,
    );

    const declared = GAME_CUE_VISUALS[slug] ?? {};
    for (const event of raised) {
      expect(
        SOUND_EVENT_SPECS[event].source,
        `${slug} raises "${event}", which belongs to the shell. A game reimplementing a ` +
          'match cue is the bug CLAUDE.md calls out by name.',
      ).toBe('game');
      const cue = declared[event];
      expect(
        cue,
        `${slug} raises "${event}" and there is nothing a player can see instead of ` +
          `hearing it. #180 requires ${GAME_CUE_REQUIREMENT[event as keyof typeof GAME_CUE_REQUIREMENT]}.`,
      ).toBeDefined();
      if (cue) expectEvidence(`${slug}'s "${event}"`, cue);
    }

    for (const event of Object.keys(declared) as SoundEvent[]) {
      expect(
        raised,
        `${slug} declares a visual for "${event}" and never raises it. A counterpart for a ` +
          'cue that does not happen is a table going stale.',
      ).toContain(event);
    }
  });
});

/**
 * A context that answers the whole `AudioContextLike` surface and makes no noise, so a
 * match can be played through the *real* `AudioSystem` and the *real* `EngineSoundBus` in
 * Node, where there is no Web Audio at all.
 *
 * This is the third leg of the determinism test below, and it is the one that matters: a
 * silent bus proves the interface is inert, and this proves the implementation is.
 */
class SilentContext implements AudioContextLike {
  readonly state: AudioState = 'running';
  currentTime = 0;
  readonly sampleRate = 48_000;
  readonly destination: AudioNodeLike = new SilentNode();

  resume(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  createGain(): GainNodeLike {
    return new SilentGain();
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    return new SilentSource();
  }

  createBuffer(channels: number, length: number, sampleRate: number): AudioSampleBuffer {
    return new SilentBuffer(channels, length, sampleRate);
  }

  decodeAudioData(): Promise<AudioBufferLike> {
    return Promise.reject(new Error('DuelBox ships no encoded audio'));
  }
}

class SilentNode implements AudioNodeLike {
  connect(destination: AudioNodeLike): unknown {
    return destination;
  }

  disconnect(): void {
    /* nothing held */
  }
}

class SilentParam implements AudioParamLike {
  value = 1;
}

class SilentGain extends SilentNode implements GainNodeLike {
  readonly gain = new SilentParam();
}

class SilentSource extends SilentNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  readonly playbackRate = new SilentParam();

  start(): void {
    /* nothing to start */
  }

  stop(): void {
    /* nothing to stop */
  }
}

class SilentBuffer implements AudioSampleBuffer {
  readonly #channels: Float32Array[];

  constructor(
    channels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.#channels = Array.from({ length: channels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    const data = this.#channels[channel];
    if (data === undefined) throw new RangeError(`no channel ${String(channel)}`);
    return data;
  }
}

/** Every extension a browser will decode as audio, and one it will not but a person might. */
const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.opus', '.ogg', '.m4a', '.aac', '.flac', '.weba'];

/**
 * The assertion that makes the four failure modes above mean anything.
 *
 * Everything else in this file iterates `GAME_CUE_VISUALS` — **its own table**. A game
 * that emits cues and is simply *absent* from that table was checked by nothing and
 * reported as unwired by nothing: it was invisible, which is a worse failure than being
 * wrong, because nothing is on screen to argue with.
 *
 * That was not hypothetical. Cricket landed emitting six cues with no entry in the table
 * and this file stayed green (#2519). It is the same shape as `check-zero-cost.mjs`
 * scanning three directories while claiming the repository (#2510) and `routing.test.ts`
 * skipping any id absent from the registry (#2497) — a guard whose subject is the list it
 * already knows about.
 *
 * So the subject here is **the registry**: every game the shell can load is played, and
 * anything that makes a sound must be declared. Detected by playing rather than by
 * grepping for `emit`, so a game that raises its cues through a helper — as Cricket does,
 * from `#settleBall` — is still caught.
 */
describe('no game makes a sound the table has never heard of', () => {
  it('plays every registered game and finds no undeclared emitter', async () => {
    const entries = Object.entries(LOADERS_FOR_TEST);
    // A ratchet, for the reason `docs/parallel-work.md` gives: an `it.each` over an empty
    // list is loud, but a list that has quietly become *shorter* says nothing at all.
    expect(entries.length, 'the registry has shrunk; this sweep is guarding less').
      toBeGreaterThanOrEqual(100);

    const undeclared: string[] = [];
    for (const [slug, load] of entries) {
      const bus = new RecordingSoundBus();
      await play(slug, load, bus);
      const raised = bus.distinct();
      if (raised.length === 0) continue;
      if (slug in GAME_CUE_VISUALS) continue;
      undeclared.push(`${slug} raises ${raised.join(', ')}`);
    }

    expect(
      undeclared,
      'These games make sounds and are not in GAME_CUE_VISUALS, so nothing checks that a ' +
        'player can see what they are hearing (#180). Either declare each cue with the ' +
        'on-screen thing that carries the same information, or take the emit out until ' +
        'there is one. Declaring a visual that does not exist is worse than either.',
    ).toEqual([]);
  }, 120_000);
});

describe('the product ships no audio files', () => {
  it('has none anywhere in the repository', () => {
    // The rule that makes the whole design safe under rules 1 and 3: everything is
    // synthesised, so there is no provenance to argue about and no `assets.license.json`
    // entry to forget. `AudioContextLike` has no `decodeAudioData`, which removes the
    // door — this removes the temptation to put one back and smuggle a file through it.
    //
    // Walked by hand rather than shelled out to `find`, so it behaves the same on any
    // machine that can run the suite.
    const offenders: string[] = [];
    const skip = new Set(['node_modules', '.git', '.next', '.next-dev', 'out', 'dist', 'coverage']);
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!skip.has(entry.name)) walk(`${dir}/${entry.name}`);
        } else if (AUDIO_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
          offenders.push(`${dir}/${entry.name}`.slice(REPO_ROOT.length));
        }
      }
    };
    walk(REPO_ROOT.replace(/\/$/, ''));
    expect(
      offenders,
      'DuelBox synthesises every sound it makes. An audio file here means somebody has ' +
        'added an asset with a provenance to defend (rule 1) and a licence entry to keep ' +
        'current (rule 3) — see packages/engine/src/synth.ts for why neither is necessary.',
    ).toEqual([]);
  });
});

describe('sound cannot reach the simulation', () => {
  it.each(WIRED)('%s plays the identical match with sound on, off and absent', async (slug) => {
    const load = LOADERS_FOR_TEST[slug];
    expect(load).toBeDefined();

    // No bus at all: the shape every headless test, balance run and replay uses.
    const absent = await play(slug, load!);
    // A bus that records and plays nothing.
    const recording = await play(slug, load!, new RecordingSoundBus());
    // The real bus over the real audio system, with a context that answers every call.
    const system = new AudioSystem({ createContext: () => new SilentContext(), target: null });
    const live = await play(slug, load!, new EngineSoundBus(system));
    // Drained the way the host drains it, once at the end of the frame.
    system.flush();
    system.dispose();

    expect(recording.signature).toBe(absent.signature);
    expect(live.signature).toBe(absent.signature);
  });
});
