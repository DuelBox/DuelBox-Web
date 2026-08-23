import { describe, expect, it } from 'vitest';
import { InputManager } from './input.js';
import { InputView } from './input-view.js';
import { Rng } from './rng.js';
import { InputRecorder, TracePlayer, exportTrace, importTrace } from './record.js';
import type { Trace } from './record.js';

const STEP = 1 / 60;
const LOGICAL = { width: 640, height: 1000 };

/** A seeded storm, so a trace has something in it worth replaying. */
function storm(recorder: InputRecorder, seed: number, steps: number): string[] {
  const rng = new Rng(seed);
  const view = new InputView();
  const seen: string[] = [];
  const held = new Set<string>();
  const down = new Set<number>();
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'Enter'];

  for (let i = 0; i < steps; i += 1) {
    const roll = rng.float();
    const key = keys[Math.floor(rng.float() * keys.length)] ?? 'Space';
    if (roll < 0.25) {
      recorder.keyDown(key);
      held.add(key);
    } else if (roll < 0.45) {
      recorder.keyUp(key);
      held.delete(key);
    } else if (roll < 0.6) {
      const id = Math.floor(rng.float() * 3);
      recorder.pointerDown(id, rng.float() * LOGICAL.width, rng.float() * LOGICAL.height);
      down.add(id);
    } else if (roll < 0.75) {
      const id = Math.floor(rng.float() * 3);
      recorder.pointerMove(id, rng.float() * LOGICAL.width, rng.float() * LOGICAL.height);
    } else if (roll < 0.85) {
      const id = Math.floor(rng.float() * 3);
      recorder.pointerUp(id);
      down.delete(id);
    } else if (roll < 0.9) {
      recorder.setBoardSeat(rng.float() < 0.5 ? 'p1' : 'p2');
    } else if (roll < 0.93) {
      recorder.setSplit(rng.float() < 0.5 ? 'shared' : 'horizontal');
    }

    const state = view.sync(recorder.beginStep(STEP));
    seen.push(snapshot(state));
  }
  return seen;
}

function snapshot(state: ReturnType<InputView['sync']>): string {
  return (['p1', 'p2'] as const)
    .map((seat) => {
      const s = state.seat(seat);
      const pointer = s.pointer === null ? 'none' : `${s.pointer.x},${s.pointer.y}`;
      return [
        seat,
        s.move.x.toFixed(6),
        s.move.y.toFixed(6),
        pointer,
        s.actionHeld ? 'H' : '-',
        s.actionPressed ? 'P' : '-',
        s.actionReleased ? 'R' : '-',
      ].join(' ');
    })
    .join(' | ');
}

/** Replay a trace back through a fresh manager and collect the same snapshots. */
function replay(trace: Trace, steps: number): string[] {
  const input = new InputManager(LOGICAL, { split: 'horizontal', bottomSeat: 'p1' });
  const player = new TracePlayer(trace);
  const view = new InputView();
  const seen: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    player.apply(input, i);
    seen.push(snapshot(view.sync(input.beginStep(trace.fixedDeltaSeconds))));
  }
  return seen;
}

describe('recording and replaying input', () => {
  it('reproduces every frame of a storm exactly', () => {
    const steps = 900;
    const recorder = new InputRecorder(
      new InputManager(LOGICAL, { split: 'horizontal', bottomSeat: 'p1' }),
    );
    const live = storm(recorder, 4242, steps);
    const trace = recorder.toTrace('ping-pong', 7, STEP);
    expect(replay(trace, steps)).toEqual(live);
  });

  it('survives a round trip through JSON', () => {
    const steps = 400;
    const recorder = new InputRecorder(
      new InputManager(LOGICAL, { split: 'horizontal', bottomSeat: 'p1' }),
    );
    const live = storm(recorder, 99, steps);
    const trace = importTrace(exportTrace(recorder.toTrace('star-catcher', 12, STEP)));
    expect(trace.game).toBe('star-catcher');
    expect(trace.seed).toBe(12);
    expect(trace.logical).toEqual(LOGICAL);
    expect(replay(trace, steps)).toEqual(live);
  });

  it('records the frame an event landed on, not the wall clock', () => {
    // A fixed-step loop makes the index the time. A timestamp would record the recording
    // machine's jitter and then replay it somewhere it never happened.
    const recorder = new InputRecorder(new InputManager(LOGICAL));
    recorder.beginStep(STEP);
    recorder.beginStep(STEP);
    recorder.keyDown('Space');
    recorder.beginStep(STEP);
    const trace = recorder.toTrace('sumo', 1, STEP);
    expect(trace.frames).toHaveLength(1);
    expect(trace.frames[0]?.at).toBe(2);
  });

  it('writes nothing down for a frame nobody touched', () => {
    // Most frames are empty. A two-minute match would otherwise be seven thousand empty
    // objects, and a trace is meant to be read by a person.
    const recorder = new InputRecorder(new InputManager(LOGICAL));
    for (let i = 0; i < 500; i += 1) recorder.beginStep(STEP);
    recorder.keyDown('Space');
    recorder.beginStep(STEP);
    expect(recorder.toTrace('sumo', 1, STEP).frames).toHaveLength(1);
    expect(recorder.frames).toBe(501);
  });

  it('replays an empty trace as an untouched match', () => {
    const empty = importTrace(
      exportTrace(new InputRecorder(new InputManager(LOGICAL)).toTrace('darts', 3, STEP)),
    );
    expect(empty.frames).toEqual([]);
    const quiet = replay(empty, 20);
    expect(new Set(quiet).size).toBe(1);
  });

  it('refuses anything that is not a trace', () => {
    // Validated rather than cast: a malformed trace replayed as undefined events produces a
    // *wrong* answer rather than an error, which is the worst outcome for a tool whose whole
    // job is to be believed.
    expect(() => importTrace('7')).toThrow(/not an object/);
    expect(() => importTrace('{"version":2}')).toThrow(/version/);
    expect(() => importTrace('{"version":1}')).toThrow(/names no game/);
    expect(() => importTrace('{"version":1,"game":"x"}')).toThrow(/seed/);
    expect(() => importTrace('{"version":1,"game":"x","seed":1,"fixedDeltaSeconds":0}')).toThrow(
      /step length/,
    );
    expect(() =>
      importTrace('{"version":1,"game":"x","seed":1,"fixedDeltaSeconds":0.016}'),
    ).toThrow(/logical size/);
    const head =
      '{"version":1,"game":"x","seed":1,"fixedDeltaSeconds":0.016,"logical":{"width":1,"height":1}';
    expect(() => importTrace(`${head}}`)).toThrow(/no frames/);
    expect(() => importTrace(`${head},"frames":[{"at":-1,"events":[]}]}`)).toThrow(/stamped/);
    expect(() => importTrace(`${head},"frames":[{"at":0,"events":[{"kind":"nope"}]}]}`)).toThrow(
      /kind nope/,
    );
    expect(() => importTrace(`${head},"frames":[{"at":0,"events":[{"kind":"keyDown"}]}]}`)).toThrow(
      /names no key/,
    );
    expect(() =>
      importTrace(`${head},"frames":[{"at":0,"events":[{"kind":"boardSeat","seat":"p3"}]}]}`),
    ).toThrow(/boardSeat names p3/);
  });

  it('says so rather than quietly skipping when a replay runs backwards', () => {
    const recorder = new InputRecorder(new InputManager(LOGICAL));
    recorder.keyDown('Space');
    recorder.beginStep(STEP);
    const player = new TracePlayer(recorder.toTrace('sumo', 1, STEP));
    const input = new InputManager(LOGICAL);
    expect(() => player.apply(input, 5)).toThrow(/skipped/);
  });
});
