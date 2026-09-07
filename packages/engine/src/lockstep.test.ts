import { describe, expect, it } from 'vitest';
import { InputManager } from './input.js';
import { LockstepSession, configFingerprint, mixNumber } from './lockstep.js';
import type { MatchConfig } from './lockstep.js';
import { Rng } from './rng.js';
import type { SeatId } from './seat.js';
import { copyFrameInto, createFrameBuffer, loopbackPair } from './transport.js';
import type {
  FrameSink,
  LoopbackOptions,
  MatchTransport,
  SeatInputFrame,
  SeatInputFrameBuffer,
  TransportStatus,
} from './transport.js';

const STEP = 1 / 60;
const LOGICAL = { width: 640, height: 1000 };
const DELAY = 3;

function config(overrides?: Partial<MatchConfig>): MatchConfig {
  return {
    game: 'air-hockey',
    seed: 20260830,
    logical: LOGICAL,
    stepsPerSecond: 60,
    inputDelaySteps: DELAY,
    ...overrides,
  };
}

/**
 * Everything both seats read, as one line.
 *
 * Every field, not a chosen few: this is what "the two devices stepped the identical match"
 * is compared on, and a comparison that looked at half the state would pass while the other
 * half diverged.
 */
function snapshot(state: {
  seat(seat: SeatId): {
    moveX: number;
    moveY: number;
    pointerX: number;
    pointerY: number;
    pointerActive: boolean;
    pointerCount: number;
    actionPressed: boolean;
    actionHeld: boolean;
    actionReleased: boolean;
    holdSeconds: number;
    holdSecondsAtRelease: number;
    pointerCancelled: boolean;
  };
}): string {
  const seats: readonly SeatId[] = ['p1', 'p2'];
  return seats
    .map((seat) => {
      const s = state.seat(seat);
      return [
        seat,
        s.moveX.toFixed(6),
        s.moveY.toFixed(6),
        s.pointerX.toFixed(6),
        s.pointerY.toFixed(6),
        s.pointerActive ? 'A' : '-',
        String(s.pointerCount),
        s.actionPressed ? 'P' : '-',
        s.actionHeld ? 'H' : '-',
        s.actionReleased ? 'R' : '-',
        s.holdSeconds.toFixed(6),
        s.holdSecondsAtRelease.toFixed(6),
        s.pointerCancelled ? 'X' : '-',
      ].join(' ');
    })
    .join(' | ');
}

/**
 * What one person does, as a function of the step their input will land on.
 *
 * Keyed by the *applied* step rather than by the tick it was typed on, which is the whole
 * fairness rule expressed as a test fixture: an input belongs to the step it was made for,
 * and nothing about the wire may move it.
 */
type Script = (seat: SeatId, step: number, peer: Peer) => void;

class Peer {
  readonly seat: SeatId;
  readonly manager: InputManager;
  readonly session: LockstepSession;
  readonly trace: string[] = [];
  readonly #delay: number;
  #fedTo = -1;

  constructor(
    seat: SeatId,
    transport: MatchTransport | null,
    matchConfig: MatchConfig,
    stallLimitSteps?: number,
  ) {
    this.seat = seat;
    this.manager = new InputManager(LOGICAL, { split: 'horizontal', bottomSeat: 'p1' });
    this.#delay = matchConfig.inputDelaySteps;
    this.session = new LockstepSession(this.manager, {
      localSeat: seat,
      config: matchConfig,
      transport,
      ...(stallLimitSteps === undefined ? {} : { stallLimitSteps }),
    });
  }

  /**
   * One attempt at a step.
   *
   * Input for a given applied step is fed exactly once, however many ticks the peer spends
   * waiting — otherwise a stall would change what the player did, and every comparison below
   * would be measuring the harness rather than the transport.
   */
  tick(script: Script): boolean {
    const appliedAt = this.session.step + this.#delay;
    if (appliedAt > this.#fedTo) {
      script(this.seat, appliedAt, this);
      this.#fedTo = appliedAt;
    }
    const input = this.session.beginStep(STEP);
    if (input === null) return false;
    this.trace.push(snapshot(input));
    // Stands in for a game's observables. Derived from the merged input of both seats, so
    // two devices agree here exactly when they agree about the match.
    for (const seat of ['p1', 'p2'] as const) {
      const s = input.seat(seat);
      this.session.mix(s.moveX);
      this.session.mix(s.pointerX);
      this.session.mix(s.actionHeld ? 1 : 0);
    }
    return true;
  }
}

/** Tick both peers until each has run `steps` steps, or give up and say so. */
function pump(a: Peer, b: Peer, script: Script, steps: number, maxTicks = steps * 8 + 500): void {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (a.session.step >= steps && b.session.step >= steps) return;
    // Each peer stops at exactly `steps`, so the two runs are compared over the same steps
    // and their checksums cover the same match. A peer that has finished has already sent
    // the frames the other needs to finish too: it sends `inputDelaySteps` ahead of itself.
    if (a.session.step < steps) a.tick(script);
    if (b.session.step < steps) b.tick(script);
  }
}

/** Nobody touches anything. Used where the subject is the transport rather than the input. */
const IDLE: Script = () => undefined;

/** Steps at the start of a match during which {@link STORM} stays silent. */
const QUIET_STEPS = 16;

/**
 * A seeded storm of taps, drags and keys, in logical units.
 *
 * Both seats act, positions sweep the whole box, and every branch of the input machinery is
 * reached — presses that span steps, taps that begin and end between two, drags, cancels.
 * Seeded on the applied step so it is a pure function of it: the same step always produces
 * the same gesture, whichever device is asking and however late the frame arrives.
 */
const STORM: Script = (seat, step, peer) => {
  // Quiet until every delay under test has warmed up. The first `inputDelaySteps` steps of a
  // match carry no input by construction — there has not been time for anyone to have made
  // any — so a script that spoke during them would be a different script at each delay, and
  // the comparison below would be measuring the fixture rather than the engine.
  if (step < QUIET_STEPS) return;
  const rng = new Rng(step * 31 + (seat === 'p1' ? 0 : 977));
  const keys =
    seat === 'p1'
      ? ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']
      : ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Enter'];
  const key = keys[rng.int(0, keys.length)] ?? 'Space';
  const roll = rng.float();
  const id = seat === 'p1' ? 1 : 2;
  if (roll < 0.2) peer.session.keyDown(key);
  else if (roll < 0.35) peer.session.keyUp(key);
  else if (roll < 0.55) {
    peer.session.pointerDown(id, rng.float() * LOGICAL.width, rng.float() * LOGICAL.height);
  } else if (roll < 0.7) {
    peer.session.pointerMove(id, rng.float() * LOGICAL.width, rng.float() * LOGICAL.height);
  } else if (roll < 0.85) peer.session.pointerUp(id);
  else if (roll < 0.9) peer.session.pointerCancel(id);
};

/** A transport a test drives by hand, and proof the seam is implementable from outside. */
class ScriptedTransport implements MatchTransport {
  status: TransportStatus = 'open';
  readonly sent: SeatInputFrameBuffer[] = [];
  readonly inbox: SeatInputFrameBuffer[] = [];

  send(frame: Readonly<SeatInputFrame>): void {
    const copy = createFrameBuffer();
    copyFrameInto(copy, frame);
    this.sent.push(copy);
  }

  drain(sink: FrameSink): void {
    for (const frame of this.inbox) sink.accept(frame);
    this.inbox.length = 0;
  }

  close(): void {
    this.status = 'closed';
  }

  /** Put a frame on the wire as if the peer had sent it. */
  deliver(seat: SeatId, step: number, fill?: (frame: SeatInputFrameBuffer) => void): void {
    const frame = createFrameBuffer();
    frame.seat = seat;
    frame.step = step;
    frame.checkStep = -1;
    frame.check = configFingerprint(config());
    fill?.(frame);
    this.inbox.push(frame);
  }
}

describe('a session with no transport', () => {
  it('is the input manager, unwrapped', () => {
    // Not "behaves like" — is. The shell gets one code path for local and remote play, and
    // this is what makes the local one provably today's: the same object, returned as it is.
    const manager = new InputManager(LOGICAL);
    const session = new LockstepSession(manager, { localSeat: 'p1', config: config() });

    expect(session.local).toBe(true);
    expect(session.status).toBe('local');
    for (let step = 0; step < 10; step += 1) {
      expect(session.beginStep(STEP)).toBe(manager.state);
    }
    expect(session.status).toBe('local');
  });

  it('produces exactly what the bare manager produces, event for event', () => {
    const bare = new InputManager(LOGICAL, { split: 'horizontal', bottomSeat: 'p1' });
    const wrapped = new InputManager(LOGICAL, { split: 'horizontal', bottomSeat: 'p1' });
    const session = new LockstepSession(wrapped, { localSeat: 'p1', config: config() });

    const rng = new Rng(4242);
    const expected: string[] = [];
    const actual: string[] = [];
    for (let step = 0; step < 400; step += 1) {
      const roll = rng.float();
      const x = rng.float() * LOGICAL.width;
      const y = rng.float() * LOGICAL.height;
      const key = rng.pick(['KeyW', 'KeyD', 'Space', 'ArrowUp', 'Enter']);
      if (roll < 0.2) {
        bare.keyDown(key);
        session.keyDown(key);
      } else if (roll < 0.35) {
        bare.keyUp(key);
        session.keyUp(key);
      } else if (roll < 0.55) {
        bare.pointerDown(1, x, y);
        session.pointerDown(1, x, y);
      } else if (roll < 0.7) {
        bare.pointerMove(1, x, y);
        session.pointerMove(1, x, y);
      } else if (roll < 0.8) {
        bare.pointerUp(1);
        session.pointerUp(1);
      } else if (roll < 0.85) {
        bare.pointerCancel(1);
        session.pointerCancel(1);
      } else if (roll < 0.88) {
        bare.setSplit('shared');
        session.setSplit('shared');
      } else if (roll < 0.91) {
        bare.setBoardSeat('p2');
        session.setBoardSeat('p2');
      } else if (roll < 0.93) {
        bare.clear();
        session.clear();
      }
      expected.push(snapshot(bare.beginStep(STEP)));
      const wrappedState = session.beginStep(STEP);
      expect(wrappedState).not.toBeNull();
      if (wrappedState !== null) actual.push(snapshot(wrappedState));
    }
    expect(actual).toEqual(expected);
    // The trace has to be worth comparing: a pair of identical empty runs proves nothing.
    expect(new Set(expected).size).toBeGreaterThan(20);
  });

  it('passes the zone questions straight through', () => {
    const manager = new InputManager(LOGICAL, { split: 'horizontal', bottomSeat: 'p1' });
    const session = new LockstepSession(manager, { localSeat: 'p1', config: config() });
    session.setSplit('shared');
    session.setBoardSeat('p2');
    // Under a shared split the whole surface belongs to the board seat, so a tap in what
    // would have been p1's half is p2's.
    session.pointerDown(1, 320, 900);
    const state = session.beginStep(STEP);
    expect(state?.seat('p2').pointerActive).toBe(true);
    expect(state?.seat('p1').pointerActive).toBe(false);
  });

  it('cannot be closed, because there is nothing to close', () => {
    // Local play does not depend on anything that can go away, so nothing may end it. A
    // session that reported `failed` here and then went on returning input — which it must,
    // because that is what local play is — would be saying one thing and doing another.
    const manager = new InputManager(LOGICAL);
    const session = new LockstepSession(manager, { localSeat: 'p1', config: config() });
    session.close();
    expect(session.status).toBe('local');
    expect(session.beginStep(STEP)).toBe(manager.state);
  });

  it('reports the manager it is wrapping', () => {
    const manager = new InputManager(LOGICAL);
    const session = new LockstepSession(manager, { localSeat: 'p1', config: config() });
    expect(session.manager).toBe(manager);
    expect(session.logical).toBe(manager.logical);
    expect(session.isBound('KeyW')).toBe(true);
    expect(session.isBound('KeyZ')).toBe(false);
  });
});

describe('a session with a transport', () => {
  it('gives the whole surface to the local seat', () => {
    // Two people on two devices: there is nobody at this end to give half the screen to, so
    // a tap anywhere is this player's, wherever the shared-screen divider would have been.
    const transport = new ScriptedTransport();
    const peer = new Peer('p2', transport, config());
    peer.session.pointerDown(1, 320, 900);
    peer.session.beginStep(STEP);

    const first = transport.sent[0];
    expect(first?.seat).toBe('p2');
    expect(first?.input.pointerActive).toBe(true);
  });

  it('refuses to rotate the board or split the surface mid-match', () => {
    const transport = new ScriptedTransport();
    const peer = new Peer('p1', transport, config());
    // A turn-based game's shell asks for both of these every time the turn changes. In a
    // remote match they must do nothing: the board never turns away from the one person
    // looking at it, and there is no second seat here to hand it to.
    peer.session.setSplit('horizontal');
    peer.session.setBoardSeat('p2');
    peer.session.pointerDown(1, 320, 100);
    peer.session.beginStep(STEP);
    expect(transport.sent[0]?.input.pointerActive).toBe(true);
  });

  it('stamps its own input for a step in the future and applies it there', () => {
    const [a, b] = loopbackPair();
    const first = new Peer('p1', a, config());
    const second = new Peer('p2', b, config());
    const tapOnce: Script = (seat, step, peer) => {
      if (seat === 'p1' && step === DELAY) peer.session.keyDown('Space');
      if (seat === 'p1' && step === DELAY + 1) peer.session.keyUp('Space');
    };
    pump(first, second, tapOnce, DELAY + 4);

    for (let step = 0; step < DELAY; step += 1) {
      // Warm-up: nobody had made an input yet, and both devices know it without being told.
      expect(first.trace[step], `step ${String(step)} should be idle`).toContain('p1 0.000000');
    }
    expect(first.trace[DELAY]).toContain('P H');
    expect(second.trace[DELAY]).toContain('P H');
  });

  it('refuses a delay it cannot honour', () => {
    const manager = new InputManager(LOGICAL);
    for (const inputDelaySteps of [0, -1, 1.5, 61]) {
      expect(
        () =>
          new LockstepSession(manager, {
            localSeat: 'p1',
            config: config({ inputDelaySteps }),
            transport: new ScriptedTransport(),
          }),
      ).toThrow(RangeError);
    }
  });

  it('refuses a stall limit that is not a number of steps', () => {
    const manager = new InputManager(LOGICAL);
    expect(
      () =>
        new LockstepSession(manager, {
          localSeat: 'p1',
          config: config(),
          transport: new ScriptedTransport(),
          stallLimitSteps: 0,
        }),
    ).toThrow(RangeError);
  });
});

describe('when the peer stops sending', () => {
  it('waits rather than guessing', () => {
    // Delay, not prediction. Nothing is invented for the missing player, so neither person
    // ever sees a world that did not happen.
    const [a, b] = loopbackPair();
    const first = new Peer('p1', a, config());
    const second = new Peer('p2', b, config());
    pump(first, second, IDLE, DELAY);
    expect(first.session.step).toBe(DELAY);

    b.pause();
    const before = first.session.step;
    for (let tick = 0; tick < 20; tick += 1) first.tick(IDLE);

    // The peer went quiet, and was not missed for `DELAY` steps: it had already sent that
    // many ahead of itself, which is what the input delay buys and why it is also the jitter
    // buffer. After that the match waits, and waits without inventing anything.
    expect(first.session.step).toBe(before + DELAY);
    expect(first.session.status).toBe('waiting');
    expect(first.session.stallSteps).toBe(20 - DELAY);
    expect(first.trace).toHaveLength(before + DELAY);
  });

  it('carries on the moment the peer comes back', () => {
    const [a, b] = loopbackPair();
    const first = new Peer('p1', a, config());
    const second = new Peer('p2', b, config());
    pump(first, second, IDLE, DELAY);

    b.pause();
    for (let tick = 0; tick < 20; tick += 1) first.tick(IDLE);
    b.resume();
    pump(first, second, IDLE, DELAY + 30);

    expect(first.session.status).toBe('running');
    expect(first.session.stallSteps).toBe(0);
    expect(first.session.step).toBe(DELAY + 30);
  });

  it('gives up after the stall limit and stays given up', () => {
    // A match cannot be played against nobody. Ending it is the honest outcome; the shell
    // then offers local play or the bot, rather than leaving a frozen board on screen.
    const [a, b] = loopbackPair();
    const first = new Peer('p1', a, config(), 10);
    const second = new Peer('p2', b, config(), 10);
    pump(first, second, IDLE, DELAY);

    b.pause();
    // Ten waits, after the `DELAY` steps the peer had already sent ahead of itself.
    for (let tick = 0; tick < 10 + DELAY; tick += 1) first.tick(IDLE);
    expect(first.session.status).toBe('failed');

    b.resume();
    const stalledAt = first.session.step;
    for (let tick = 0; tick < 50; tick += 1) first.tick(IDLE);
    expect(first.session.step).toBe(stalledAt);
    expect(first.session.status).toBe('failed');
  });

  it('ends when the transport says it has failed', () => {
    const transport = new ScriptedTransport();
    const peer = new Peer('p1', transport, config());
    peer.tick(IDLE);
    transport.status = 'failed';
    expect(peer.session.beginStep(STEP)).toBeNull();
    expect(peer.session.status).toBe('failed');
  });

  it('ends when the transport is closed', () => {
    const transport = new ScriptedTransport();
    const peer = new Peer('p1', transport, config());
    peer.session.close();
    expect(transport.status).toBe('closed');
    expect(peer.session.status).toBe('failed');
    expect(peer.session.beginStep(STEP)).toBeNull();
  });
});

describe('the wire cannot change the match', () => {
  /**
   * The fairness rule, stated as a property.
   *
   * A frame applies on the step it is stamped with, so latency, jitter and arrival order can
   * change *when* a device learns what the other player did and never *what happened*. If any
   * of the runs below diverged, something in this engine would be resolving an outcome on
   * packet arrival, which is precisely what `CLAUDE.md` forbids.
   */
  const CONDITIONS: { label: string; a?: LoopbackOptions; b?: LoopbackOptions }[] = [
    { label: 'a perfect link' },
    { label: 'one slow end', a: { lagDrains: 3 } },
    { label: 'both ends slow, unevenly', a: { lagDrains: 2 }, b: { lagDrains: 3 } },
    { label: 'frames arriving backwards', a: { reorder: true }, b: { reorder: true } },
    { label: 'slow and backwards', a: { lagDrains: 3, reorder: true }, b: { lagDrains: 1 } },
  ];

  const STEPS = 400;

  function play(a?: LoopbackOptions, b?: LoopbackOptions, matchConfig = config()) {
    const [linkA, linkB] = loopbackPair(a, b);
    const first = new Peer('p1', linkA, matchConfig);
    const second = new Peer('p2', linkB, matchConfig);
    pump(first, second, STORM, STEPS);
    return { first, second };
  }

  it('has both devices step the identical match, under every condition', () => {
    const baseline = play();
    expect(baseline.first.session.step).toBeGreaterThanOrEqual(STEPS);
    expect(baseline.first.trace).toHaveLength(baseline.first.session.step);

    for (const condition of CONDITIONS) {
      const { first, second } = play(condition.a, condition.b);
      expect(first.session.step, `${condition.label} did not finish`).toBeGreaterThanOrEqual(STEPS);
      expect(second.trace.slice(0, STEPS), `${condition.label}: the two devices disagree`).toEqual(
        first.trace.slice(0, STEPS),
      );
      expect(
        first.trace.slice(0, STEPS),
        `${condition.label} played a different match from the perfect link`,
      ).toEqual(baseline.first.trace.slice(0, STEPS));
      expect(first.session.checksum, `${condition.label}: checksums disagree`).toBe(
        second.session.checksum,
      );
      expect(first.session.status).toBe('running');
    }
  });

  it('changes nothing about the match when the delay changes', () => {
    // The input delay is felt, not seen: it moves when an action reaches the simulation on
    // both devices alike, and the same script keyed by applied step produces the same match
    // at every delay. Which is the same statement as the one above, from the other side.
    const traces = [1, 2, 5, 9].map((inputDelaySteps) => {
      const { first } = play(undefined, undefined, config({ inputDelaySteps }));
      return first.trace.slice(0, STEPS);
    });
    for (const trace of traces.slice(1)) expect(trace).toEqual(traces[0]);
  });

  it('can tell two different matches apart', () => {
    // Every comparison above is worth exactly as much as this one: a harness that reported
    // agreement between two genuinely different runs would report it between any two.
    const { first } = play();
    const other = (() => {
      const [linkA, linkB] = loopbackPair();
      const a = new Peer('p1', linkA, config());
      const b = new Peer('p2', linkB, config());
      const shifted: Script = (seat, step, peer) => {
        STORM(seat, step + 1, peer);
      };
      pump(a, b, shifted, STEPS);
      return a;
    })();
    expect(other.trace.slice(0, STEPS)).not.toEqual(first.trace.slice(0, STEPS));
  });

  it('drives both seats hard enough for the comparison to mean something', () => {
    const { first } = play();
    const lines = first.trace.slice(0, STEPS);
    expect(new Set(lines).size).toBeGreaterThan(100);
    expect(lines.filter((line) => line.includes('A')).length).toBeGreaterThan(20);
    expect(lines.filter((line) => line.includes('P')).length).toBeGreaterThan(10);
  });
});

describe('two devices that have stopped agreeing', () => {
  /**
   * Both devices stop, and the one that noticed says why.
   *
   * Detection is one-sided by construction: whichever device holds both checksums first stops
   * stepping, and a session that has stopped stepping sends nothing more for the other to
   * compare against. It hangs up instead, so the other ends the match at once rather than
   * waiting out its stall timer — which is why the second device reports `failed` rather than
   * `desynced`. What matters is the property asserted here: neither one carries on.
   */
  function expectBothStopped(first: Peer, second: Peer): void {
    const statuses = [first.session.status, second.session.status];
    expect(statuses).toContain('desynced');
    for (const status of statuses) expect(['desynced', 'failed']).toContain(status);
  }

  it('notice on the first frame when the match they were given differs', () => {
    // The fingerprint seeds the checksum, so a pair that disagrees about the seed, the shared
    // viewport, the step rate, the delay or the game itself finds out before a step has run —
    // rather than after both players have watched a different match to the end.
    const [linkA, linkB] = loopbackPair();
    const first = new Peer('p1', linkA, config());
    const second = new Peer('p2', linkB, config({ seed: 999 }));
    pump(first, second, IDLE, 20);
    expectBothStopped(first, second);
    expect(first.session.step).toBeLessThan(20);
  });

  it('notice a different shared viewport', () => {
    const [linkA, linkB] = loopbackPair();
    const first = new Peer('p1', linkA, config());
    const second = new Peer('p2', linkB, config({ logical: { width: 641, height: 1000 } }));
    pump(first, second, IDLE, 20);
    expectBothStopped(first, second);
  });

  it('notice when the simulations themselves diverge', () => {
    const [linkA, linkB] = loopbackPair();
    const first = new Peer('p1', linkA, config());
    const second = new Peer('p2', linkB, config());
    // One device's world quietly goes its own way at step 20. The inputs still agree, so
    // nothing but the checksum can see it — which is the whole case this exists for.
    let diverged = false;
    for (let tick = 0; tick < 200; tick += 1) {
      first.tick(IDLE);
      second.tick(IDLE);
      if (!diverged && second.session.step === 20) {
        second.session.mix(1);
        diverged = true;
      }
    }
    expectBothStopped(first, second);
    expect(first.session.beginStep(STEP)).toBeNull();
    expect(second.session.beginStep(STEP)).toBeNull();
    // Caught close to where it happened, rather than at the end of the match.
    expect(first.session.step).toBeLessThan(40);
  });

  it('never cry desync when they do agree', () => {
    const [linkA, linkB] = loopbackPair({ lagDrains: 2 }, { lagDrains: 1, reorder: true });
    const first = new Peer('p1', linkA, config());
    const second = new Peer('p2', linkB, config());
    pump(first, second, STORM, 600);
    expect(first.session.status).toBe('running');
    expect(second.session.status).toBe('running');
    expect(first.session.checksum).toBe(second.session.checksum);
  });

  it('fingerprints every part of the config', () => {
    const base = configFingerprint(config());
    expect(configFingerprint(config({ seed: 1 }))).not.toBe(base);
    expect(configFingerprint(config({ game: 'sumo' }))).not.toBe(base);
    expect(configFingerprint(config({ stepsPerSecond: 30 }))).not.toBe(base);
    expect(configFingerprint(config({ inputDelaySteps: 4 }))).not.toBe(base);
    expect(configFingerprint(config({ logical: { width: 641, height: 1000 } }))).not.toBe(base);
    expect(configFingerprint(config())).toBe(base);
  });

  it('mixes every bit of a number, so two near-identical worlds are still two worlds', () => {
    expect(mixNumber(0, 0.1)).not.toBe(mixNumber(0, 0.1 + Number.EPSILON));
    expect(mixNumber(0, 0)).not.toBe(mixNumber(0, -0));
    expect(mixNumber(0, 1)).toBe(mixNumber(0, 1));
    expect(mixNumber(0, 1) >>> 0).toBe(mixNumber(0, 1));
  });
});

describe('a frame from a peer that should not be trusted', () => {
  function armed(): { peer: Peer; transport: ScriptedTransport } {
    const transport = new ScriptedTransport();
    const peer = new Peer('p1', transport, config());
    return { peer, transport };
  }

  it("refuses one that claims this device's own seat", () => {
    // Otherwise a peer could play both sides of the match.
    const { peer, transport } = armed();
    transport.deliver('p1', DELAY);
    peer.tick(IDLE);
    expect(peer.session.rejected).toBe(1);
    expect(peer.session.accepted).toBe(0);
  });

  it('refuses one that is malformed', () => {
    const { peer, transport } = armed();
    transport.deliver('p2', DELAY, (frame) => {
      frame.input.pointerX = Number.NaN;
    });
    peer.tick(IDLE);
    expect(peer.session.rejected).toBe(1);
  });

  it('refuses one stamped absurdly far in the future', () => {
    const { peer, transport } = armed();
    transport.deliver('p2', 1_000_000);
    peer.tick(IDLE);
    expect(peer.session.rejected).toBe(1);
  });

  it('counts a repeat rather than acting on it twice', () => {
    const { peer, transport } = armed();
    transport.deliver('p2', DELAY);
    transport.deliver('p2', DELAY);
    peer.tick(IDLE);
    expect(peer.session.accepted).toBe(1);
    expect(peer.session.duplicates).toBe(1);
  });

  it('counts a frame for a step already played as a repeat', () => {
    const { peer, transport } = armed();
    for (let step = DELAY; step < DELAY + 3; step += 1) transport.deliver('p2', step);
    for (let tick = 0; tick < DELAY + 3; tick += 1) peer.tick(IDLE);
    expect(peer.session.step).toBe(DELAY + 3);
    transport.deliver('p2', DELAY);
    peer.tick(IDLE);
    expect(peer.session.duplicates).toBe(1);
  });

  it('keeps stepping the same match whatever nonsense arrives alongside', () => {
    const clean = new ScriptedTransport();
    const noisy = new ScriptedTransport();
    const good = new Peer('p1', clean, config());
    const attacked = new Peer('p1', noisy, config());
    for (let step = DELAY; step < DELAY + 40; step += 1) {
      clean.deliver('p2', step, (frame) => {
        frame.input.moveX = 1;
      });
      noisy.deliver('p2', step, (frame) => {
        frame.input.moveX = 1;
      });
      // Everything a hostile peer might try, alongside the frames it is meant to send.
      noisy.deliver('p1', step);
      noisy.deliver('p2', step, (frame) => {
        frame.input.moveX = 4;
      });
      noisy.deliver('p2', 900_000 + step);
    }
    for (let tick = 0; tick < 60; tick += 1) {
      good.tick(IDLE);
      attacked.tick(IDLE);
    }
    expect(attacked.trace).toEqual(good.trace);
    expect(attacked.session.rejected).toBeGreaterThan(0);
  });
});

describe('a remote session allocates nothing per step', () => {
  it('hands back the same state and the same seat records every time', () => {
    // Rule 5, on the one path that runs sixty times a second in every match.
    const [linkA, linkB] = loopbackPair();
    const first = new Peer('p1', linkA, config());
    const second = new Peer('p2', linkB, config());

    first.tick(STORM);
    second.tick(STORM);
    const state = first.session.beginStep(STEP);
    expect(state).not.toBeNull();
    if (state === null) return;
    const p1 = state.seat('p1');
    const p2 = state.seat('p2');

    for (let tick = 0; tick < 100; tick += 1) {
      first.tick(STORM);
      second.tick(STORM);
      const next = first.session.beginStep(STEP);
      if (next === null) continue;
      expect(next).toBe(state);
      expect(next.seat('p1')).toBe(p1);
      expect(next.seat('p2')).toBe(p2);
    }
  });

  it('reuses one outgoing frame rather than building one a step', () => {
    // The seam's contract — `send` must not retain the frame — exists so that this is
    // possible. A transport that kept the reference would be holding a value that changes.
    const transport = new ScriptedTransport();
    const peer = new Peer('p1', transport, config());
    const seen: Readonly<SeatInputFrame>[] = [];
    const original = transport.send.bind(transport);
    transport.send = (frame: Readonly<SeatInputFrame>): void => {
      seen.push(frame);
      original(frame);
    };
    for (let tick = 0; tick < 4; tick += 1) peer.tick(IDLE);
    expect(seen.length).toBeGreaterThan(1);
    for (const frame of seen) expect(frame).toBe(seen[0]);
  });
});
