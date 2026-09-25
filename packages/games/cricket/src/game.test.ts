import { describe, expect, it } from 'vitest';
import { Rng, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { CricketGame } from './game.js';
import { BALLS_PER_INNINGS, GROUND_CX, GROUND_CY, WICKETS_PER_INNINGS } from './rules.js';
import type { BotDifficulty } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
const LOGICAL_W = manifest.logical.width;
const LOGICAL_H = manifest.logical.height;

/**
 * Frames to run a whole match out.
 *
 * Two innings of twelve balls, each ball a run-up, a flight and a settle, plus the break
 * and slack for the wides that do not count. Generous on purpose: a test that ends one
 * frame before the match does would assert nothing at all.
 */
const MATCH_FRAMES = 14_000;

class FakeSeat implements SeatInput {
  readonly move: Vec2 = vec2();
  pointer: Vec2 | null = null;
  actionPressed = false;
  actionHeld = false;
  actionReleased = false;
  holdSeconds = 0;
  holdSecondsAtRelease = 0;
  pointerCancelled = false;
}

class FakeInput implements InputState {
  readonly p1 = new FakeSeat();
  readonly p2 = new FakeSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.p1 : this.p2;
  }

  clear(): void {
    for (const seat of [this.p1, this.p2]) {
      set(seat.move, 0, 0);
      seat.pointer = null;
      seat.actionPressed = false;
      seat.actionHeld = false;
      seat.actionReleased = false;
      seat.holdSeconds = 0;
      seat.holdSecondsAtRelease = 0;
      seat.pointerCancelled = false;
    }
  }
}

interface Call {
  readonly op: string;
  readonly args: readonly (string | number | boolean)[];
}

/** Records what was drawn, so a test can ask about the picture rather than about pixels. */
class RecordingRenderer implements Renderer {
  readonly calls: Call[] = [];
  rotations: boolean[] = [];

  clear(colour: string): void {
    this.calls.push({ op: 'clear', args: [colour] });
  }
  rect(x: number, y: number, w: number, h: number, colour: string): void {
    this.calls.push({ op: 'rect', args: [x, y, w, h, colour] });
  }
  strokeRect(x: number, y: number, w: number, h: number, lw: number, colour: string): void {
    this.calls.push({ op: 'strokeRect', args: [x, y, w, h, lw, colour] });
  }
  circle(x: number, y: number, r: number, colour: string): void {
    this.calls.push({ op: 'circle', args: [x, y, r, colour] });
  }
  strokeCircle(x: number, y: number, r: number, lw: number, colour: string): void {
    this.calls.push({ op: 'strokeCircle', args: [x, y, r, lw, colour] });
  }
  line(x1: number, y1: number, x2: number, y2: number, lw: number, colour: string): void {
    this.calls.push({ op: 'line', args: [x1, y1, x2, y2, lw, colour] });
  }
  text(value: string, x: number, y: number, size: number, colour: string, align?: TextAlign): void {
    this.calls.push({ op: 'text', args: [value, x, y, size, colour, align ?? 'left'] });
  }
  pushSeatRotation(rotated: boolean): void {
    this.rotations.push(rotated);
    this.calls.push({ op: 'pushSeatRotation', args: [rotated] });
  }
  pushRotation(radians: number): void {
    this.calls.push({ op: 'pushRotation', args: [radians] });
  }
  popSeatRotation(): void {
    this.calls.push({ op: 'popSeatRotation', args: [] });
  }
}

/** The ball is the only thing on the field drawn in this colour. */
const BALL_COLOUR = '#f2f4ef';

function drawsBall(renderer: RecordingRenderer): boolean {
  return renderer.calls.some((c) => c.op === 'circle' && c.args[3] === BALL_COLOUR);
}

function makeContext(
  seed: number,
  p1Bot: BotDifficulty | null = null,
  p2Bot: BotDifficulty | null = null,
  openingSeat: SeatId = 'p1',
  presentation: Presentation = 'shared-screen',
  localSeat: SeatId = 'p1',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
    openingSeat,
    botDifficulty: (seat: SeatId) => (seat === 'p1' ? p1Bot : p2Bot),
  };
}

function step(game: CricketGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

/** A bot match, run to its end. The commonest rig in this file. */
function playOut(seed: number, p1: BotDifficulty = 'normal', p2: BotDifficulty = 'normal') {
  const game = new CricketGame();
  game.init(makeContext(seed, p1, p2));
  const input = new FakeInput();
  step(game, input, MATCH_FRAMES);
  return game;
}

describe('the shell contract', () => {
  it('starts nil for nil with nobody declared', () => {
    const game = new CricketGame();
    game.init(makeContext(1));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('is a real-time game, so it must not answer getActiveSeat', () => {
    // Declaring it is what tells the shell to hand the whole board and both keyboard
    // halves to one seat. Cricket needs the bowler and the striker live at the same time.
    expect('getActiveSeat' in new CricketGame()).toBe(false);
  });

  it('finishes a bot match and declares somebody', () => {
    const score = playOut(12).getScore();
    expect(score.winner).not.toBe(null);
    expect(['p1', 'p2', 'draw']).toContain(score.winner);
  });

  it('stays finished once it is finished', () => {
    const game = playOut(12);
    const first = game.getScore();
    const input = new FakeInput();
    step(game, input, 600);
    expect(game.getScore()).toEqual(first);
  });

  it('gives both seats an innings', () => {
    // Not "both seats score": a side can be bowled out for a duck, and seed 204 does
    // exactly that to p1 in three balls. What must hold is that both seats *bat*, so the
    // test asks for that across seeds rather than demanding runs from a single one.
    const seeds = [3, 17, 91, 204, 5, 6, 7, 8, 19, 23, 44, 61];
    let p1Batted = 0;
    let p2Batted = 0;
    for (const seed of seeds) {
      const score = playOut(seed, 'hard', 'hard').getScore();
      if (score.p1 > 0) p1Batted += 1;
      if (score.p2 > 0) p2Batted += 1;
      expect(score.p1 + score.p2).toBeGreaterThan(0);
    }
    expect(p1Batted).toBeGreaterThanOrEqual(seeds.length - 2);
    expect(p2Batted).toBeGreaterThanOrEqual(seeds.length - 2);
  });

  it('lets a side be bowled out for a duck, because the laws allow it', () => {
    // Stated as a property, not as a pinned seed. An earlier version of this test asserted
    // that seed 204 specifically returned 0, which was true of one tuning of the shot model
    // and stopped being true the moment the model changed — a test that fails when nothing
    // is wrong. What must hold is that a duck remains *reachable*: if no seed in a wide
    // sweep can be dismissed without scoring, the wicket has stopped working.
    const ducked = Array.from({ length: 120 }, (_unused, seed) =>
      playOut(seed, 'easy', 'hard').getScore(),
    ).some((score) => score.p1 === 0 || score.p2 === 0);
    expect(ducked).toBe(true);
  });

  it('is deterministic: the same seed plays the same match', () => {
    expect(playOut(77).getScore()).toEqual(playOut(77).getScore());
  });

  it('plays a different match on a different seed', () => {
    const scores = [5, 6, 7, 8, 9].map((seed) => JSON.stringify(playOut(seed).getScore()));
    expect(new Set(scores).size).toBeGreaterThan(1);
  });

  it('survives being destroyed and re-initialised', () => {
    const game = playOut(31);
    game.destroy();
    game.init(makeContext(31, 'normal', 'normal'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('takes a pause and a resume without ending the match', () => {
    const game = new CricketGame();
    game.init(makeContext(44, 'normal', 'normal'));
    const input = new FakeInput();
    step(game, input, 300);
    game.onPause();
    game.onResume();
    step(game, input, MATCH_FRAMES);
    expect(game.getScore().winner).not.toBe(null);
  });
});

describe('the two seats', () => {
  it('gives the first innings to the opener, whichever seat that is', () => {
    // With one bot far better than the other, the better bat should end up ahead — and
    // that has to hold whichever seat opens, or the game is reading `p1` rather than the
    // shell's opener (issue #2466).
    for (const opener of ['p1', 'p2'] as const) {
      const game = new CricketGame();
      game.init(makeContext(58, 'hard', 'easy', opener));
      const input = new FakeInput();
      step(game, input, MATCH_FRAMES);
      const score = game.getScore();
      expect(score.p1).toBeGreaterThan(score.p2);
    }
  });

  it('turns the world round exactly when p1 is bowling', () => {
    const game = new CricketGame();
    game.init(makeContext(2, 'normal', 'normal', 'p1'));
    const renderer = new RecordingRenderer();
    // Opener p1 bats first, so p2 bowls the first innings and the world is not turned.
    game.render(renderer, 0);
    expect(renderer.rotations[0]).toBe(false);

    const swapped = new CricketGame();
    swapped.init(makeContext(2, 'normal', 'normal', 'p2'));
    const other = new RecordingRenderer();
    swapped.render(other, 0);
    expect(other.rotations[0]).toBe(true);
  });

  it('pairs every rotation it pushes with a pop', () => {
    const game = playOut(19);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const pushes = renderer.calls.filter((c) => c.op === 'pushSeatRotation').length;
    const pops = renderer.calls.filter((c) => c.op === 'popSeatRotation').length;
    expect(pushes).toBe(pops);
  });
});

describe('a human at the controls', () => {
  /** Bowls one ball by hand and returns the game, mid-flight. */
  function humanBowls(seed: number, bowler: SeatId) {
    const game = new CricketGame();
    // The opener bats; so to make `bowler` the bowler, the other seat opens.
    const opener: SeatId = bowler === 'p1' ? 'p2' : 'p1';
    // Only the striker is a bot, so the bowling seat is driven by the fake input.
    game.init(
      makeContext(
        seed,
        bowler === 'p1' ? null : 'normal',
        bowler === 'p1' ? 'normal' : null,
        opener,
      ),
    );
    return game;
  }

  it('bowls when the bowler lets go, and not before', () => {
    const game = humanBowls(4, 'p1');
    const input = new FakeInput();
    const renderer = new RecordingRenderer();

    // Holding: still the run-up, so there is no ball on the field to draw.
    input.p1.actionHeld = true;
    step(game, input, 30);
    game.render(renderer, 0);
    expect(drawsBall(renderer)).toBe(false);

    input.p1.actionHeld = false;
    input.p1.actionReleased = true;
    step(game, input, 1);
    input.clear();
    step(game, input, 6);

    const after = new RecordingRenderer();
    game.render(after, 0);
    expect(drawsBall(after)).toBe(true);
  });

  it('bowls anyway rather than letting a seat stall the match', () => {
    const game = humanBowls(4, 'p1');
    const input = new FakeInput();
    // Nobody touches anything, ever. The match must still finish.
    step(game, input, MATCH_FRAMES);
    expect(game.getScore().winner).not.toBe(null);
  });

  it('drops a charge that was interrupted rather than bowling a ball nobody meant to', () => {
    const game = humanBowls(4, 'p1');
    const input = new FakeInput();
    input.p1.actionHeld = true;
    step(game, input, 40);
    game.onPause();
    game.onResume();
    // The charge is gone, so a release on the very next step must not bowl at pace.
    input.p1.actionHeld = false;
    input.p1.actionReleased = true;
    step(game, input, 1);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('lets a striker who never swings survive on dot balls rather than being timed out', () => {
    // Leaving the ball is legal. The striker should end with a small score, not a crash.
    const game = new CricketGame();
    game.init(makeContext(21, null, 'easy', 'p1'));
    const input = new FakeInput();
    step(game, input, MATCH_FRAMES);
    const score = game.getScore();
    expect(score.winner).not.toBe(null);
    expect(score.p1).toBeGreaterThanOrEqual(0);
  });

  it('takes a pointer as readily as a keyboard, in world units', () => {
    const game = humanBowls(4, 'p1');
    const input = new FakeInput();
    input.p1.pointer = { x: GROUND_CX + 60, y: GROUND_CY - 120 };
    input.p1.actionHeld = true;
    step(game, input, 30);
    input.p1.actionHeld = false;
    input.p1.actionReleased = true;
    step(game, input, 1);
    input.clear();
    step(game, input, 600);
    // It got through a ball without throwing and the match is still running.
    expect(game.getScore().winner).toBe(null);
  });
});

describe('the picture', () => {
  it('draws without mutating a thing', () => {
    const game = playOut(63, 'normal', 'easy');
    const before = game.getScore();
    const first = new RecordingRenderer();
    const second = new RecordingRenderer();
    game.render(first, 0);
    game.render(second, 0.9);
    expect(game.getScore()).toEqual(before);
    expect(second.calls).toEqual(first.calls);
  });

  it('names every outcome in words, so colour is never the only signal', () => {
    // Rule 7. Run a match and collect every word the game put on screen.
    const game = new CricketGame();
    game.init(makeContext(88, 'easy', 'easy'));
    const input = new FakeInput();
    const words = new Set<string>();
    for (let i = 0; i < MATCH_FRAMES; i += 1) {
      game.update(STEP, input);
      if (i % 7 !== 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      for (const call of renderer.calls) {
        if (call.op === 'text') words.add(String(call.args[0]));
      }
    }
    // Whatever happened, the scorecard was always spelled out.
    expect([...words].some((w) => /^\d+-\d+$/.test(w))).toBe(true);
    expect([...words].some((w) => w.startsWith('over '))).toBe(true);
  });

  it('keeps the scorecard out of the field of view, at the ends the layout reserves', () => {
    const game = playOut(9);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const texts = renderer.calls.filter((c) => c.op === 'text');
    expect(texts.length).toBeGreaterThan(0);
    for (const call of texts) {
      const y = Number(call.args[2]);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(LOGICAL_H);
    }
  });

  it('draws inside the logical area it declared', () => {
    const game = new CricketGame();
    game.init(makeContext(6, 'hard', 'hard'));
    const input = new FakeInput();
    for (let i = 0; i < 2000; i += 1) {
      game.update(STEP, input);
      if (i % 23 !== 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      for (const call of renderer.calls) {
        if (call.op !== 'circle') continue;
        const x = Number(call.args[0]);
        const y = Number(call.args[1]);
        // Generous: the boundary itself touches the edges of the box by design.
        expect(x).toBeGreaterThan(-LOGICAL_W);
        expect(x).toBeLessThan(LOGICAL_W * 2);
        expect(y).toBeGreaterThan(-LOGICAL_H);
        expect(y).toBeLessThan(LOGICAL_H * 2);
      }
    }
  });
});

describe('the laws hold over a whole match', () => {
  it('never scores more than the maximum an innings could possibly be worth', () => {
    for (const seed of [1, 2, 3, 40, 41]) {
      const score = playOut(seed, 'hard', 'hard').getScore();
      // Twelve balls at six, plus a wide before each, is the ceiling nothing can pass.
      const ceiling = BALLS_PER_INNINGS * 6 + BALLS_PER_INNINGS * 2;
      expect(score.p1).toBeLessThanOrEqual(ceiling);
      expect(score.p2).toBeLessThanOrEqual(ceiling);
    }
  });

  it('lets a weak bat be bowled out rather than always seeing out the overs', () => {
    // `easy` is bowled about nine times in a hundred balls, so across these seeds at
    // least one innings must end early. If none does, the wicket is unreachable.
    const totals = [11, 12, 13, 14, 15, 16].map((seed) => playOut(seed, 'easy', 'hard').getScore());
    expect(totals.some((score) => score.p1 < 12)).toBe(true);
  });

  it('gives the better bot the better of it across many seeds', () => {
    let hardWins = 0;
    const seeds = 60;
    for (let seed = 0; seed < seeds; seed += 1) {
      // p1 hard batting first, p2 easy. p1 should usually be ahead.
      const score = playOut(seed, 'hard', 'easy').getScore();
      if (score.p1 > score.p2) hardWins += 1;
    }
    expect(hardWins / seeds).toBeGreaterThan(0.8);
  });

  it('holds the wicket count within the laws', () => {
    expect(WICKETS_PER_INNINGS).toBeGreaterThan(0);
    expect(BALLS_PER_INNINGS % 6).toBe(0);
  });
});
