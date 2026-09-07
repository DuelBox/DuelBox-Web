import { describe, expect, it } from 'vitest';
import {
  LoopbackTransport,
  createFrameBuffer,
  frameProblem,
  loopbackPair,
  type SeatInputFrame,
  type SeatInputFrameBuffer,
} from './transport.js';

/**
 * The seam, exercised with no network anywhere in the room.
 *
 * That is the property being protected as much as any assertion below: everything a
 * cross-device match does with a transport is reachable from a test that opens no socket,
 * needs no signalling and runs in Node. A seam that could only be tested against a real
 * connection would be tested against a real connection roughly never.
 */

/** A frame to send. Filled by hand rather than by a session, so the test owns every field. */
function frame(seat: 'p1' | 'p2', step: number, pointerX = 0): SeatInputFrameBuffer {
  const buffer = createFrameBuffer();
  buffer.seat = seat;
  buffer.step = step;
  buffer.checkStep = -1;
  buffer.check = 7;
  buffer.input.pointerX = pointerX;
  return buffer;
}

/** Collects what a drain hands over, copying because the caller reuses its frames. */
class Collector {
  readonly seen: { seat: string; step: number; pointerX: number }[] = [];

  accept(received: Readonly<SeatInputFrame>): void {
    this.seen.push({
      seat: received.seat,
      step: received.step,
      pointerX: received.input.pointerX,
    });
  }
}

describe('a loopback pair', () => {
  it('carries a frame from one end to the other', () => {
    const [a, b] = loopbackPair();
    a.send(frame('p1', 4, 12));

    const collector = new Collector();
    b.drain(collector);

    expect(collector.seen).toEqual([{ seat: 'p1', step: 4, pointerX: 12 }]);
  });

  it('delivers each frame exactly once', () => {
    const [a, b] = loopbackPair();
    a.send(frame('p1', 0));
    const first = new Collector();
    b.drain(first);
    const second = new Collector();
    b.drain(second);

    expect(first.seen).toHaveLength(1);
    expect(second.seen).toHaveLength(0);
  });

  it("copies the frame rather than keeping the sender's object", () => {
    // The seam's contract is that `send` may not retain what it was given, because the
    // caller rewrites that object on the very next step. A transport that kept the
    // reference would deliver whatever the sender happened to be holding later.
    const [a, b] = loopbackPair();
    const outgoing = frame('p1', 1, 100);
    a.send(outgoing);
    outgoing.step = 999;
    outgoing.input.pointerX = -1;

    const collector = new Collector();
    b.drain(collector);
    expect(collector.seen).toEqual([{ seat: 'p1', step: 1, pointerX: 100 }]);
  });

  it('sends in both directions independently', () => {
    const [a, b] = loopbackPair();
    a.send(frame('p1', 1));
    b.send(frame('p2', 2));

    const atA = new Collector();
    const atB = new Collector();
    a.drain(atA);
    b.drain(atB);

    expect(atA.seen.map((f) => f.seat)).toEqual(['p2']);
    expect(atB.seen.map((f) => f.seat)).toEqual(['p1']);
  });

  it('never delivers a frame back to the end that sent it', () => {
    const [a] = loopbackPair();
    a.send(frame('p1', 1));
    const backToSender = new Collector();
    a.drain(backToSender);
    expect(backToSender.seen).toHaveLength(0);
  });
});

describe('a loopback pair with latency', () => {
  it('holds a frame for the number of drains asked for', () => {
    // Latency in drains rather than milliseconds: the session drains exactly once per step
    // attempt, so this is the only clock a deterministic test is allowed to have.
    const [a, b] = loopbackPair(undefined, { lagDrains: 2 });
    a.send(frame('p1', 0));

    const first = new Collector();
    b.drain(first);
    expect(first.seen).toHaveLength(0);

    const second = new Collector();
    b.drain(second);
    expect(second.seen).toHaveLength(0);

    const third = new Collector();
    b.drain(third);
    expect(third.seen).toHaveLength(1);
  });

  it("keeps the two directions' latencies separate", () => {
    const [a, b] = loopbackPair({ lagDrains: 3 }, { lagDrains: 0 });
    a.send(frame('p1', 0));
    b.send(frame('p2', 0));

    const atB = new Collector();
    b.drain(atB);
    expect(atB.seen, 'b receives without waiting').toHaveLength(1);

    const atA = new Collector();
    a.drain(atA);
    expect(atA.seen, 'a is the slow end').toHaveLength(0);
  });

  it("can hand a drain's frames over newest first", () => {
    const [a, b] = loopbackPair(undefined, { reorder: true });
    a.send(frame('p1', 1));
    a.send(frame('p1', 2));
    a.send(frame('p1', 3));

    const collector = new Collector();
    b.drain(collector);
    expect(collector.seen.map((f) => f.step)).toEqual([3, 2, 1]);
  });
});

describe('a loopback pair under stress', () => {
  it('drops the oldest frame when the queue is full, and counts it', () => {
    const [a, b] = loopbackPair(undefined, { capacity: 2 });
    a.send(frame('p1', 1));
    a.send(frame('p1', 2));
    a.send(frame('p1', 3));

    const collector = new Collector();
    b.drain(collector);
    expect(collector.seen.map((f) => f.step)).toEqual([2, 3]);
    expect(b.dropped).toBe(1);
  });

  it('goes quiet when paused, without saying so', () => {
    // What a phone entering a tunnel looks like from the other end: no error, no close,
    // simply nothing more. The peer must find this out by waiting, not by being told.
    const [a, b] = loopbackPair();
    a.pause();
    a.send(frame('p1', 1));

    const collector = new Collector();
    b.drain(collector);
    expect(collector.seen).toHaveLength(0);
    expect(a.status).toBe('open');
    expect(a.dropped).toBe(1);

    a.resume();
    a.send(frame('p1', 2));
    b.drain(collector);
    expect(collector.seen.map((f) => f.step)).toEqual([2]);
  });

  it('stops carrying anything once it has failed', () => {
    const [a, b] = loopbackPair();
    a.fail();
    a.send(frame('p1', 1));
    b.send(frame('p2', 1));

    const atA = new Collector();
    const atB = new Collector();
    a.drain(atA);
    b.drain(atB);

    expect(a.status).toBe('failed');
    expect(atA.seen).toHaveLength(0);
    expect(atB.seen).toHaveLength(0);
  });

  it('stops carrying anything once it is closed', () => {
    const [a, b] = loopbackPair();
    b.close();
    a.send(frame('p1', 1));

    const collector = new Collector();
    b.drain(collector);
    expect(b.status).toBe('closed');
    expect(collector.seen).toHaveLength(0);
  });

  it('counts a frame sent to nobody rather than throwing', () => {
    const lonely = new LoopbackTransport();
    lonely.send(frame('p1', 1));
    expect(lonely.sent).toBe(1);
    expect(lonely.dropped).toBe(1);
  });

  it('refuses a latency or a capacity that is not a number of things', () => {
    expect(() => new LoopbackTransport({ lagDrains: -1 })).toThrow(RangeError);
    expect(() => new LoopbackTransport({ lagDrains: 1.5 })).toThrow(RangeError);
    expect(() => new LoopbackTransport({ capacity: 0 })).toThrow(RangeError);
  });

  it('keeps an honest count of what it carried', () => {
    const [a, b] = loopbackPair();
    for (let step = 0; step < 5; step += 1) a.send(frame('p1', step));
    expect(b.queued).toBe(5);
    b.drain(new Collector());
    expect(a.sent).toBe(5);
    expect(b.delivered).toBe(5);
    expect(b.queued).toBe(0);
  });
});

describe("a frame arriving from another person's browser", () => {
  /**
   * The types say what a frame is. They say nothing about what arrived, and this is the one
   * place where another person's device reaches this one's simulation — so every field is
   * checked rather than trusted, exactly as `importTrace` checks a trace file.
   */
  function valid(): Record<string, unknown> {
    const buffer = frame('p1', 3);
    return JSON.parse(JSON.stringify(buffer)) as Record<string, unknown>;
  }

  it('passes a well-formed one', () => {
    expect(frameProblem(valid())).toBeNull();
  });

  it('refuses anything that is not a frame', () => {
    expect(frameProblem(null)).toBe('frame is not an object');
    expect(frameProblem('p1')).toBe('frame is not an object');
    expect(frameProblem(42)).toBe('frame is not an object');
  });

  const malformed: [string, (frame: Record<string, unknown>) => void][] = [
    ['names no seat', (f) => (f['seat'] = 'p3')],
    ['is stamped with no step', (f) => (f['step'] = -1)],
    ['is stamped with no step', (f) => (f['step'] = 1.5)],
    ['is stamped with no step', (f) => (f['step'] = '4')],
    ['carries no checksum step', (f) => (f['checkStep'] = -2)],
    ['carries no checksum', (f) => (f['check'] = -1)],
    ['carries no checksum', (f) => (f['check'] = 2 ** 33)],
    ['carries no input', (f) => (f['input'] = null)],
  ];

  for (const [label, damage] of malformed) {
    it(`refuses one that ${label}`, () => {
      const candidate = valid();
      damage(candidate);
      expect(frameProblem(candidate)).not.toBeNull();
    });
  }

  const brokenInput: [string, unknown][] = [
    ['a movement that is not a number', { moveX: 'left' }],
    ['a movement past what a seat can ask for', { moveX: 4 }],
    // The one that matters most: a single NaN admitted here reaches a position, then a
    // velocity, then every number in the match.
    ['a movement that is NaN', { moveY: Number.NaN }],
    ['a pointer at infinity', { pointerX: Number.POSITIVE_INFINITY }],
    ['a pointer nowhere', { pointerY: Number.NaN }],
    ['a negative hold', { holdSeconds: -1 }],
    ['a hold at release that is not a number', { holdSecondsAtRelease: null }],
    ['more pointers than any hand', { pointerCount: 1e9 }],
    ['a fractional pointer count', { pointerCount: 1.5 }],
    ['a flag that is not a flag', { actionPressed: 1 }],
    ['a held flag that is not a flag', { actionHeld: 'yes' }],
  ];

  for (const [label, patch] of brokenInput) {
    it(`refuses one carrying ${label}`, () => {
      const candidate = valid();
      candidate['input'] = { ...(candidate['input'] as object), ...(patch as object) };
      expect(frameProblem(candidate)).not.toBeNull();
    });
  }

  it('refuses one whose pointer count and pointer flag disagree', () => {
    // An invariant `InputManager` cannot break and a peer can: `SeatInputView` promises a
    // count of 0 exactly when there is no pointer, and games are entitled to read it that way.
    const noPointer = valid();
    noPointer['input'] = { ...(noPointer['input'] as object), pointerActive: true };
    expect(frameProblem(noPointer)).toBe('frame counts pointers it has not got');

    const noFlag = valid();
    noFlag['input'] = { ...(noFlag['input'] as object), pointerCount: 2 };
    expect(frameProblem(noFlag)).toBe('frame counts pointers it has not got');

    const both = valid();
    both['input'] = { ...(both['input'] as object), pointerActive: true, pointerCount: 2 };
    expect(frameProblem(both)).toBeNull();
  });

  it('refuses one that both releases and cancels the same gesture', () => {
    // Opposite events, per `docs/input-idiom.md`: a release commits and a cancel abandons.
    // A game handed both would commit a move the other device says never happened.
    const candidate = valid();
    candidate['input'] = {
      ...(candidate['input'] as object),
      actionReleased: true,
      pointerCancelled: true,
    };
    expect(frameProblem(candidate)).toBe('frame both releases and cancels');
  });

  it('refuses a frame whose input is missing a field entirely', () => {
    const candidate = valid();
    const input = { ...(candidate['input'] as Record<string, unknown>) };
    delete input['actionHeld'];
    candidate['input'] = input;
    expect(frameProblem(candidate)).toBe('frame carries a flag that is not a flag');
  });

  it('survives the round trip a real transport would put it through', () => {
    // A network transport is `JSON.stringify` on one side and `JSON.parse` plus this check
    // on the other. If that round trip lost or renamed a field, this is where it shows.
    const sent = frame('p2', 12, 34.5);
    sent.input.actionHeld = true;
    sent.input.holdSeconds = 0.25;
    const received: unknown = JSON.parse(JSON.stringify(sent));
    expect(frameProblem(received)).toBeNull();
    expect(received).toEqual(sent);
  });
});
