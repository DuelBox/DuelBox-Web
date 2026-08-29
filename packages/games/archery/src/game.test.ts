import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, InputManager, InputView, Rng, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { AIM_REACH, ArcheryGame, PAD_CX, PAD_CY, PAD_H, PAD_HALF_H, PAD_HALF_W } from './game.js';
import {
  ARROWS_PER_ROUND,
  ARROWS_PER_SEAT,
  DRAW_SECONDS,
  ROUNDS,
  SHOTS_PER_MATCH,
  WIND_DRIFT_X,
  WIND_DRIFT_Y,
  scoreAt,
} from './rules.js';
import type { BotDifficulty } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
const LOGICAL_W = 700;
const LOGICAL_H = 1000;
/** Exactly full draw at 60 Hz, so the bow arm has not begun to wander. */
const FULL_DRAW_FRAMES = Math.round(DRAW_SECONDS * 60);
/** Flight, settle and slack: long enough for a turn to finish and the next to begin. */
const TURN_TAIL_FRAMES = 70;

class FakeSeat implements SeatInput {
  readonly move: Vec2 = vec2();
  pointer: Vec2 | null = null;
  actionPressed = false;
  actionHeld = false;
  actionReleased = false;
  holdSeconds = 0;
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
    }
  }
}

/** A filled disc, kept so a test can ask what *shape* something was drawn as. */
interface Disc {
  x: number;
  y: number;
  radius: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

class RecordingRenderer implements Renderer {
  depth = 0;
  maxDepth = 0;
  calls = 0;
  circles = 0;
  rects = 0;
  lines = 0;
  texts = 0;
  angles: number[] = [];
  /** Filled shapes only: an outline confirms a mark, it is never the mark itself. */
  discs: Disc[] = [];
  boxes: Box[] = [];

  clear(): void {
    this.calls += 1;
  }
  rect(x: number, y: number, width: number, height: number): void {
    this.calls += 1;
    this.rects += 1;
    this.boxes.push({ x, y, width, height });
  }
  strokeRect(): void {
    this.calls += 1;
    this.rects += 1;
  }
  circle(x: number, y: number, radius: number): void {
    this.calls += 1;
    this.circles += 1;
    this.discs.push({ x, y, radius });
  }
  strokeCircle(): void {
    this.calls += 1;
    this.circles += 1;
  }
  line(): void {
    this.calls += 1;
    this.lines += 1;
  }
  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    this.calls += 1;
    this.texts += 1;
    expect(value.length).toBeGreaterThan(0);
    expect(Number.isFinite(x + y + sizePx)).toBe(true);
    expect(sizePx).toBeGreaterThan(0);
    expect(colour.length).toBeGreaterThan(0);
    expect(align === undefined || align.length > 0).toBe(true);
  }
  pushSeatRotation(): void {
    this.depth += 1;
    if (this.depth > this.maxDepth) this.maxDepth = this.depth;
  }
  pushRotation(radians = 0): void {
    this.angles.push(radians);
    this.pushSeatRotation();
  }
  popSeatRotation(): void {
    this.depth -= 1;
  }
}

function makeContext(
  p1Bot: BotDifficulty | null,
  p2Bot: BotDifficulty | null,
  presentation: Presentation = 'single-seat',
  localSeat: SeatId = 'p1',
  seed = 1234,
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
    openingSeat: 'p1',
    botDifficulty: (seat: SeatId) => (seat === 'p1' ? p1Bot : p2Bot),
  };
}

function step(game: ArcheryGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

/** Puts a finger on the pad at a fraction of its half-width and half-height. */
function touch(input: FakeInput, seat: SeatId, fx: number, fy: number, rotated = false): void {
  const x = PAD_CX + fx * PAD_HALF_W;
  const y = PAD_CY + fy * PAD_HALF_H;
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = rotated ? { x: LOGICAL_W - x, y: LOGICAL_H - y } : { x, y };
  target.actionHeld = true;
}

/** Lifts the finger, which is what looses the arrow. */
function lift(input: FakeInput, seat: SeatId): void {
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = null;
  target.actionHeld = false;
  target.actionReleased = true;
}

/** A whole shot: point, draw, loose, and wait for the arrow to land and score. */
function shoot(
  game: ArcheryGame,
  input: FakeInput,
  seat: SeatId,
  fx: number,
  fy: number,
  holdFrames = FULL_DRAW_FRAMES,
  rotated = false,
): void {
  input.clear();
  touch(input, seat, fx, fy, rotated);
  step(game, input, holdFrames);
  lift(input, seat);
  step(game, input, 1);
  input.clear();
  step(game, input, TURN_TAIL_FRAMES);
}

/** Where the pad has to be touched to point the bow at `aim`, in target radii. */
function padFractionFor(aim: number): number {
  return aim / AIM_REACH;
}

describe('taking a shot', () => {
  let game: ArcheryGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new ArcheryGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('starts level, with seat one to shoot the first arrow of the first round', () => {
    expect(game.activeSeat).toBe('p1');
    expect(game.roundIndex).toBe(0);
    expect(game.arrowInRound).toBe(0);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('starts with the sight in the middle of the target', () => {
    expect(game.aimX).toBe(0);
    expect(game.aimY).toBe(0);
  });

  it('points the bow where the finger is', () => {
    touch(input, 'p1', 0.5, -0.25);
    step(game, input);
    expect(game.aimX).toBeCloseTo(0.5 * AIM_REACH, 9);
    expect(game.aimY).toBeCloseTo(-0.25 * AIM_REACH, 9);
  });

  it('holds the sight at the edge for a finger past the pad, rather than flinging it off', () => {
    touch(input, 'p1', 6, -9);
    step(game, input);
    expect(game.aimX).toBeCloseTo(AIM_REACH, 9);
    expect(game.aimY).toBeCloseTo(-AIM_REACH, 9);
  });

  it('moves the sight at a rate for the keys, not in a jump', () => {
    set(input.p1.move, 1, 0);
    step(game, input, 12);
    expect(game.aimX).toBeGreaterThan(0.2);
    expect(game.aimX).toBeLessThan(0.3);
    const halfway = game.aimX;
    step(game, input, 12);
    expect(game.aimX).toBeGreaterThan(halfway);
  });

  it('never lets the keys push the sight past its reach', () => {
    // Two hundred frames of holding both keys, which is more than three times the travel
    // of the sight and still inside the shot clock.
    set(input.p1.move, -1, -1);
    step(game, input, 200);
    expect(game.aimX).toBe(-AIM_REACH);
    expect(game.aimY).toBe(-AIM_REACH);
  });

  it('does not loose while the bow is held', () => {
    touch(input, 'p1', 0, 0);
    step(game, input, 120);
    expect(game.arrowInFlight).toBe(false);
    expect(game.arrowsFor('p1')).toBe(0);
  });

  it('looses when the finger lifts', () => {
    touch(input, 'p1', 0, 0);
    step(game, input, FULL_DRAW_FRAMES);
    lift(input, 'p1');
    step(game, input);
    expect(game.arrowInFlight).toBe(true);
  });

  it('does nothing for a release that never drew the bow', () => {
    // A stray tap must not cost an arrow: the storm of input a shared phone gets is full
    // of releases nobody meant.
    input.p1.actionReleased = true;
    step(game, input, 30);
    expect(game.arrowInFlight).toBe(false);
    expect(game.arrowsFor('p1')).toBe(0);
  });

  it('accepts nothing while an arrow is in the air', () => {
    touch(input, 'p1', 0, 0);
    step(game, input, FULL_DRAW_FRAMES);
    lift(input, 'p1');
    step(game, input, 2);
    input.clear();
    touch(input, 'p1', 0.9, 0.9);
    step(game, input, 4);
    lift(input, 'p1');
    step(game, input, 2);
    expect(game.arrowsFor('p1')).toBe(0);
    expect(game.arrowInFlight).toBe(true);
  });

  it('scores the arrow and passes the turn once it lands', () => {
    shoot(game, input, 'p1', 0, 0);
    expect(game.arrowsFor('p1')).toBe(1);
    expect(game.activeSeat).toBe('p2');
    expect(game.stuckArrowCount).toBe(1);
  });

  it('lets the bow down on a pause, so a half-drawn shot is not loosed on resume', () => {
    touch(input, 'p1', 0, 0);
    step(game, input, 20);
    game.onPause();
    game.onResume();
    input.clear();
    input.p1.actionReleased = true;
    step(game, input, 5);
    expect(game.arrowsFor('p1'), 'the nock was let down, not loosed').toBe(0);
  });

  it('plays perfectly well with the keyboard alone, and no pointer at all', () => {
    set(input.p1.move, 1, 0);
    step(game, input, 10);
    input.clear();
    input.p1.actionHeld = true;
    step(game, input, FULL_DRAW_FRAMES);
    input.p1.actionHeld = false;
    input.p1.actionReleased = true;
    step(game, input, 1);
    input.clear();
    step(game, input, TURN_TAIL_FRAMES);
    expect(game.arrowsFor('p1')).toBe(1);
    expect(game.activeSeat).toBe('p2');
  });
});

describe('the wind', () => {
  let game: ArcheryGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new ArcheryGame();
    input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1', 5150));
  });

  it('carries an arrow aimed at the middle exactly as far as the rules say', () => {
    const wind = game.windFor(0);
    shoot(game, input, 'p1', 0, 0);
    const expected = scoreAt(wind.x * WIND_DRIFT_X, wind.y * WIND_DRIFT_Y).score;
    expect(game.pointsFor('p1')).toBe(expected);
  });

  it('puts the arrow in the gold for an archer who reads the flag', () => {
    // The whole game in one test: aim off by the drift the flag advertises, come to full
    // draw, loose before the bow arm wanders, and the arrow lands dead centre.
    const wind = game.windFor(0);
    shoot(
      game,
      input,
      'p1',
      padFractionFor(-wind.x * WIND_DRIFT_X),
      padFractionFor(-wind.y * WIND_DRIFT_Y),
    );
    expect(game.pointsFor('p1')).toBe(10);
    expect(game.goldsFor('p1')).toBe(1);
  });

  it('blows on both archers alike at the same arrow', () => {
    // Rolled once per arrow and shared, so the match is a test of judgement rather than
    // of who drew the calm afternoon.
    const first = game.windFor(0);
    shoot(game, input, 'p1', 0, 0);
    expect(game.activeSeat).toBe('p2');
    const second = game.windFor(0);
    expect(second).toEqual(first);
    shoot(game, input, 'p2', 0, 0);
    expect(game.pointsFor('p2')).toBe(game.pointsFor('p1'));
  });

  it('changes between one arrow and the next', () => {
    const winds = new Set<string>();
    for (let arrow = 0; arrow < ARROWS_PER_SEAT; arrow += 1) {
      const wind = game.windFor(arrow);
      winds.add(`${String(wind.x)}:${String(wind.y)}`);
    }
    expect(winds.size).toBe(ARROWS_PER_SEAT);
  });
});

describe('drawing and holding', () => {
  let game: ArcheryGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new ArcheryGame();
    input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1', 4242));
  });

  it('drops an arrow loosed before the bow is back', () => {
    const calm = new ArcheryGame();
    calm.init(makeContext(null, null, 'single-seat', 'p1', 4242));
    const short = new FakeInput();
    shoot(calm, short, 'p1', 0, 0, 4);
    shoot(game, input, 'p1', 0, 0, FULL_DRAW_FRAMES);
    expect(calm.pointsFor('p1')).toBeLessThan(game.pointsFor('p1'));
    expect(calm.pointsFor('p1')).toBe(0);
  });

  it('reports how long the bow has been drawn, in seconds', () => {
    touch(input, 'p1', 0, 0);
    step(game, input, 30);
    expect(game.drawSeconds).toBeCloseTo(0.5, 9);
  });

  it('costs points for dithering at full draw', () => {
    // Two identical shots, one loosed at full draw and one held two seconds longer. The
    // second is worse because the bow arm wanders, and that is the timing decision the
    // game is asking the player to make.
    const wind = game.windFor(0);
    const fx = padFractionFor(-wind.x * WIND_DRIFT_X);
    const fy = padFractionFor(-wind.y * WIND_DRIFT_Y);
    shoot(game, input, 'p1', fx, fy, FULL_DRAW_FRAMES);
    const prompt = game.pointsFor('p1');

    const dithered = new ArcheryGame();
    const other = new FakeInput();
    dithered.init(makeContext(null, null, 'single-seat', 'p1', 4242));
    shoot(dithered, other, 'p1', fx, fy, FULL_DRAW_FRAMES + 150);
    expect(prompt).toBe(10);
    expect(dithered.pointsFor('p1')).toBeLessThan(prompt);
  });
});

describe('the shot clock', () => {
  it('looses the arrow for a seat that does nothing at all', () => {
    // The termination guarantee, and the rule that stops one player holding a drawn bow
    // while the other waits. Nothing here presses anything.
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, 60 * 6);
    expect(game.arrowsFor('p1')).toBeGreaterThan(0);
  });

  it('counts down while the bow is drawn, not only while it is idle', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    touch(input, 'p1', 0, 0);
    const before = game.shotClockSeconds;
    step(game, input, 60);
    expect(game.shotClockSeconds).toBeLessThan(before);
  });

  it('starts again for the next archer', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    shoot(game, input, 'p1', 0, 0);
    step(game, input, 30);
    expect(game.activeSeat).toBe('p2');
    expect(game.shotClockSeconds).toBeGreaterThan(3);
  });
});

describe('the match', () => {
  it('runs three rounds of four arrows for each archer', () => {
    expect(ARROWS_PER_SEAT).toBe(ROUNDS * ARROWS_PER_ROUND);
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'hard'));
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    expect(game.arrowsFor('p1')).toBe(ARROWS_PER_SEAT);
    expect(game.arrowsFor('p2')).toBe(ARROWS_PER_SEAT);
  });

  it('shoots the AB–BA rotation, alternating who goes first at each arrow', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    const order: SeatId[] = [];
    for (let shot = 0; shot < 4; shot += 1) {
      order.push(game.activeSeat);
      shoot(game, input, game.activeSeat, 0, 0);
    }
    expect(order).toEqual(['p1', 'p2', 'p2', 'p1']);
  });

  it('clears the boss between rounds and not within one', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    for (let shot = 0; shot < ARROWS_PER_ROUND * 2; shot += 1) {
      shoot(game, input, game.activeSeat, 0.1, 0.1);
      if (shot < ARROWS_PER_ROUND * 2 - 1) {
        expect(game.stuckArrowCount, `after shot ${String(shot)}`).toBe(shot + 1);
      }
    }
    expect(game.roundIndex).toBe(1);
    expect(game.stuckArrowCount, 'a fresh boss for the new end').toBe(0);
  });

  it('keeps a card for every round', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    for (let shot = 0; shot < ARROWS_PER_ROUND * 2; shot += 1) {
      shoot(game, input, game.activeSeat, 0, 0);
    }
    const first = game.roundPointsFor('p1', 0) + game.roundPointsFor('p2', 0);
    expect(first).toBe(game.pointsFor('p1') + game.pointsFor('p2'));
    expect(game.roundPointsFor('p1', 1)).toBe(0);
  });

  it('ends after the last arrow and names a winner', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'easy'));
    let steps = 0;
    for (; steps < 60 * 600; steps += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    const score = game.getScore();
    expect(score.winner).toBe('p1');
    expect(score.p1).toBeGreaterThan(score.p2);
    expect(steps).toBeLessThan(60 * 120);
  });

  it('never scores more than ten an arrow', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'hard'));
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, input);
      const score = game.getScore();
      expect(score.p1).toBeLessThanOrEqual(ARROWS_PER_SEAT * 10);
      expect(score.p2).toBeLessThanOrEqual(ARROWS_PER_SEAT * 10);
      if (score.winner !== null) break;
    }
  });

  it('stops simulating once it is over', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext('normal', 'normal'));
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    const settled = game.getScore();
    step(game, input, 600);
    expect(game.getScore()).toEqual(settled);
  });

  it('is decided by points, with golds breaking a tie', () => {
    // Driven through the game rather than the rules: both seats shoot the identical
    // sequence, so the cards can only be separated by the tie-break or not at all.
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    for (let shot = 0; shot < SHOTS_PER_MATCH; shot += 1) {
      shoot(game, input, game.activeSeat, 0, 0);
    }
    const score = game.getScore();
    expect(score.winner).not.toBeNull();
    if (score.p1 === score.p2) {
      const golds = game.goldsFor('p1') - game.goldsFor('p2');
      const expected = golds === 0 ? 'draw' : golds > 0 ? 'p1' : 'p2';
      expect(score.winner).toBe(expected);
    }
  });
});

describe('both seats play the same game', () => {
  it('reads a finger the same way for the seat that is upside down', () => {
    // The board turns to face whoever is shooting, so seat two's finger arrives mirrored
    // and has to mean the same thing. Getting this wrong makes one seat aim backwards.
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    touch(input, 'p1', 0.6, -0.4);
    step(game, input);
    const upright = { x: game.aimX, y: game.aimY };

    shoot(game, input, 'p1', 0, 0);
    step(game, input, 40);
    expect(game.activeSeat).toBe('p2');
    input.clear();
    touch(input, 'p2', 0.6, -0.4, true);
    step(game, input);
    expect(game.aimX).toBeCloseTo(upright.x, 9);
    expect(game.aimY).toBeCloseTo(upright.y, 9);
  });

  it('gives the same shot the same score whichever seat took it', () => {
    const one = new ArcheryGame();
    const two = new ArcheryGame();
    const inputOne = new FakeInput();
    const inputTwo = new FakeInput();
    one.init(makeContext(null, null, 'single-seat', 'p1', 8080));
    two.init(makeContext(null, null, 'single-seat', 'p1', 8080));
    // The first two shots of the match are seat one's then seat two's, at the same
    // wind. Shooting the same fraction of the pad must score the same.
    shoot(one, inputOne, 'p1', 0.2, -0.1);
    shoot(two, inputTwo, 'p1', 0, 0);
    shoot(two, inputTwo, 'p2', 0.2, -0.1);
    expect(two.pointsFor('p2')).toBe(one.pointsFor('p1'));
  });

  it('favours neither seat when the same tier sits in both', () => {
    let p1Wins = 0;
    let p2Wins = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const game = new ArcheryGame();
      const input = new FakeInput();
      game.init(makeContext('easy', 'easy', 'single-seat', 'p1', 700 + seed * 31));
      for (let i = 0; i < 60 * 600; i += 1) {
        game.update(STEP, input);
        if (game.getScore().winner !== null) break;
      }
      const winner = game.getScore().winner;
      if (winner === 'p1') p1Wins += 1;
      if (winner === 'p2') p2Wins += 1;
    }
    expect(p1Wins + p2Wins).toBeGreaterThan(30);
    expect(Math.abs(p1Wins - p2Wins)).toBeLessThan(14);
  });
});

describe('the bot', () => {
  function playOut(p1: BotDifficulty | null, p2: BotDifficulty | null, seed = 606): ArcheryGame {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(p1, p2, 'single-seat', 'p1', seed));
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    return game;
  }

  it('shoots without any input at all', () => {
    const game = playOut('normal', 'normal');
    expect(game.arrowsFor('p1')).toBe(ARROWS_PER_SEAT);
    expect(game.getScore().winner).not.toBeNull();
  });

  it('finishes a match between two easy bots well inside ten simulated minutes', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext('easy', 'easy'));
    let steps = 0;
    for (; steps < 60 * 600; steps += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    expect(game.getScore().winner).not.toBeNull();
    expect(steps).toBeLessThan(60 * 120);
  });

  it('shoots better on hard than on easy, from the same seed and the same weather', () => {
    const easy = playOut('easy', null, 24680);
    const hard = playOut('hard', null, 24680);
    expect(hard.pointsFor('p1')).toBeGreaterThan(easy.pointsFor('p1'));
  });

  it('separates all three tiers over a run of seeds', () => {
    let easy = 0;
    let normal = 0;
    let hard = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      easy += playOut('easy', null, 91 + seed * 7).pointsFor('p1');
      normal += playOut('normal', null, 91 + seed * 7).pointsFor('p1');
      hard += playOut('hard', null, 91 + seed * 7).pointsFor('p1');
    }
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(hard);
  });

  it('plays a different match with a bot in the seat than with nobody in it', () => {
    // A tier that is read but emits nothing would look identical to an empty seat.
    const bots = playOut('normal', 'normal', 4321);
    const nobody = playOut(null, null, 4321);
    expect(bots.pointsFor('p1')).not.toBe(nobody.pointsFor('p1'));
  });

  it('takes visibly longer over a shot on easy than on hard', () => {
    // The tiers differ in how the match *goes*, not only in the final card: an easy bot
    // dithers at full draw, which is why its arrows wander.
    const easy = new ArcheryGame();
    const hard = new ArcheryGame();
    const input = new FakeInput();
    easy.init(makeContext('easy', 'easy', 'single-seat', 'p1', 31));
    hard.init(makeContext('hard', 'hard', 'single-seat', 'p1', 31));
    let easyShots = 0;
    let hardShots = 0;
    for (let i = 0; i < 600; i += 1) {
      easy.update(STEP, input);
      hard.update(STEP, input);
      easyShots = easy.arrowsFor('p1') + easy.arrowsFor('p2');
      hardShots = hard.arrowsFor('p1') + hard.arrowsFor('p2');
    }
    expect(hardShots).toBeGreaterThan(easyShots);
  });

  it('replays the identical match from the identical seed', () => {
    const trace = (): string => {
      const game = new ArcheryGame();
      const input = new FakeInput();
      game.init(makeContext('hard', 'normal', 'single-seat', 'p1', 13579));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 600; i += 1) {
        game.update(STEP, input);
        const score = game.getScore();
        seen.push(`${String(score.p1)}:${String(score.p2)}:${game.activeSeat}`);
        if (score.winner !== null) break;
      }
      return seen.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('shoots the same match at 60 Hz however many times it is stood back up', () => {
    const first = playOut('normal', 'easy', 555);
    const second = playOut('normal', 'easy', 555);
    expect(first.getScore()).toEqual(second.getScore());
  });
});

describe('lifecycle and drawing', () => {
  it('draws a balanced frame with a target, a card and a flag', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, 5);

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.depth).toBe(0);
    expect(renderer.maxDepth).toBe(1);
    expect(renderer.circles).toBeGreaterThan(5);
    expect(renderer.rects).toBeGreaterThan(2);
    expect(renderer.lines).toBeGreaterThan(5);
    expect(renderer.texts).toBeGreaterThan(2);
  });

  it('keeps drawing after the match is over', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'hard'));
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.calls).toBeGreaterThan(10);
    expect(renderer.depth).toBe(0);
  });

  it('draws every arrow in the air, so a shot can be watched', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    touch(input, 'p1', 0.3, 0.2);
    step(game, input, FULL_DRAW_FRAMES);
    lift(input, 'p1');
    step(game, input, 2);
    const flying = new RecordingRenderer();
    game.render(flying, 0);
    input.clear();
    step(game, input, TURN_TAIL_FRAMES);
    const landed = new RecordingRenderer();
    game.render(landed, 0);
    expect(flying.calls).not.toBe(landed.calls);
  });

  /**
   * Rule 7, for the one arrow that is not standing still.
   *
   * Seat one is a disc and seat two a square everywhere else in this game — the stuck
   * arrows, the hand on the pad, the scorecards. The arrow on the string and the arrow in
   * the air belong to a seat just as much, and were the only marks told apart by colour
   * alone. The radius-5 disc and the 10-wide square are unique to those two marks, so
   * counting them is a direct question about shape.
   */
  const arrowDiscs = (renderer: RecordingRenderer): number =>
    renderer.discs.filter((disc) => disc.radius === 5).length;
  const arrowBoxes = (renderer: RecordingRenderer): number =>
    renderer.boxes.filter((box) => box.width === 10 && box.height === 10).length;

  it("marks the nocked arrow with the shooter's own shape, not only their colour", () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));

    const one = new RecordingRenderer();
    game.render(one, 0);
    expect(arrowDiscs(one), 'seat one nocks a disc').toBe(1);
    expect(arrowBoxes(one)).toBe(0);

    shoot(game, input, 'p1', 0, 0);
    expect(game.activeSeat).toBe('p2');
    const two = new RecordingRenderer();
    game.render(two, 0);
    expect(arrowBoxes(two), 'seat two nocks a square').toBe(1);
    expect(arrowDiscs(two)).toBe(0);
  });

  it("marks the arrow in the air with the shooter's own shape too", () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));

    const loose = (seat: SeatId): RecordingRenderer => {
      input.clear();
      touch(input, seat, 0, 0);
      step(game, input, FULL_DRAW_FRAMES);
      lift(input, seat);
      step(game, input, 2);
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      expect(game.arrowInFlight).toBe(true);
      input.clear();
      step(game, input, TURN_TAIL_FRAMES);
      return renderer;
    };

    const one = loose('p1');
    expect(arrowDiscs(one)).toBe(1);
    expect(arrowBoxes(one)).toBe(0);
    expect(game.activeSeat).toBe('p2');

    const two = loose('p2');
    expect(arrowBoxes(two)).toBe(1);
    expect(arrowDiscs(two)).toBe(0);
  });

  it('shows a full shot clock on the frame the board starts turning', () => {
    // The clock is not counted until the turn's first accepted update, and the gauge read
    // that -1 as a count: it flashed empty and then full at the exact moment a player
    // looks up to see how long they have.
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    touch(input, 'p1', 0, 0);
    step(game, input, FULL_DRAW_FRAMES);
    lift(input, 'p1');
    step(game, input, 1);
    input.clear();
    for (let i = 0; i < 200 && game.activeSeat === 'p1'; i += 1) step(game, input, 1);
    expect(game.activeSeat).toBe('p2');

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    // The gauge is 16 wide and sits against the near edge: its backing and its bar, both
    // of which are full height while the clock has not started.
    const gauge = renderer.boxes.filter((box) => box.width === 16 && box.x < 100);
    expect(gauge).toHaveLength(2);
    expect(gauge.every((box) => box.height === PAD_H)).toBe(true);
    expect(game.shotClockSeconds).toBeGreaterThan(4.9);
  });

  it('never rotates in single-seat presentation', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1'));
    shoot(game, input, 'p1', 0.1, 0.1);
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 60; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0);
    }
    expect(renderer.angles.every((angle) => angle === 0)).toBe(true);
  });

  it('turns to face the far seat in shared-screen', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    shoot(game, input, 'p1', 0.1, 0.1);
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 60; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0);
    }
    expect(renderer.angles.some((angle) => angle > 0.01)).toBe(true);
  });

  it('refuses input while the board is turning', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    shoot(game, input, 'p1', 0, 0);
    expect(game.activeSeat).toBe('p2');
    // Straight in, before the board has finished its half turn.
    input.clear();
    touch(input, 'p2', 0.5, 0.5, true);
    step(game, input, 2);
    expect(game.aimX, 'a tap mid-turn lands where nobody aimed').toBe(0);
  });

  it('reports whose turn it is, which is what makes it a turn game to the shell', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    expect(game.getActiveSeat()).toBe('p1');
    shoot(game, input, 'p1', 0, 0);
    expect(game.getActiveSeat()).toBe('p2');
  });

  it('empties both cards on destroy', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    shoot(game, input, 'p1', 0, 0);
    game.destroy();
    expect(game.pointsFor('p1')).toBe(0);
    expect(game.arrowsFor('p1')).toBe(0);
    expect(game.stuckArrowCount).toBe(0);
  });

  it('starts a fresh match on a second init', () => {
    const game = new ArcheryGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    shoot(game, input, 'p1', 0, 0);
    game.init(makeContext(null, null));
    expect(game.pointsFor('p1')).toBe(0);
    expect(game.activeSeat).toBe('p1');
    expect(game.roundIndex).toBe(0);
    expect(game.getScore().winner).toBeNull();
  });

  it('declares the logical box it actually simulates in', () => {
    expect(manifest.logical).toEqual({ width: LOGICAL_W, height: LOGICAL_H });
    expect(manifest.zoneSplit).toBe('shared-board');
    expect(manifest.archetype).toBe('turn-aim');
  });
});

/**
 * The controls the manifest promises, driven through the real engine.
 *
 * The shell shows that string before the match and again from the pause menu, and it is
 * the only thing a player is told. Every other test here hands the game a fake input
 * record, which proves the game reads `move` and `actionHeld` but says nothing about which
 * *keys* raise them — and the keys are exactly what the string names. Mini Soccer shipped
 * five control lines that named keys nothing was bound to, and no unit test could have
 * noticed. So this drives `InputManager` with the literal codes the string spells out.
 */
describe('the controls the manifest advertises', () => {
  const STEPS_TO_SCORE = 90;

  function harness(active: SeatId): {
    game: ArcheryGame;
    manager: InputManager;
    drive: (steps: number) => void;
  } {
    // A turn game owns the whole pointer surface; the shell hands it to whoever is to move.
    const manager = new InputManager(manifest.logical, { split: 'shared', bottomSeat: active });
    const view = new InputView();
    const game = new ArcheryGame();
    // Single-seat, so the board never turns and a coordinate means what it says.
    game.init(makeContext(null, null, 'single-seat', 'p1', 55));
    return {
      game,
      manager,
      drive: (steps: number) => {
        for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      },
    };
  }

  /** Steps until the named seat has the shot, so seat two's keys can be tried on its turn. */
  function handOver(
    game: ArcheryGame,
    drive: (steps: number) => void,
    manager: InputManager,
  ): void {
    manager.keyDown(DEFAULT_BINDINGS.p1.action);
    drive(FULL_DRAW_FRAMES);
    manager.keyUp(DEFAULT_BINDINGS.p1.action);
    drive(STEPS_TO_SCORE);
    expect(game.activeSeat).toBe('p2');
    manager.setBoardSeat('p2');
  }

  it('names the keys the engine actually binds', () => {
    // The string says W A S D and Space for seat one, the arrows and Enter for seat two.
    expect(DEFAULT_BINDINGS.p1).toEqual({
      up: 'KeyW',
      down: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      action: 'Space',
    });
    expect(DEFAULT_BINDINGS.p2).toEqual({
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      action: 'Enter',
    });
    const { keyboard, pointer } = manifest.controls;
    expect(keyboard).toMatch(/w a s d/i);
    expect(keyboard).toMatch(/space/i);
    expect(keyboard).toMatch(/arrow/i);
    expect(keyboard).toMatch(/enter/i);
    // Both halves are named, and each is given to one player rather than offered to both.
    expect(keyboard).toMatch(/player one/i);
    expect(keyboard).toMatch(/player two/i);
    expect(pointer).toMatch(/aim/i);
  });

  it('aims seat one with W A S D, as the string says', () => {
    const { game, manager, drive } = harness('p1');
    manager.keyDown(DEFAULT_BINDINGS.p1.right);
    drive(20);
    expect(game.aimX).toBeGreaterThan(0);
    manager.keyUp(DEFAULT_BINDINGS.p1.right);
    manager.keyDown(DEFAULT_BINDINGS.p1.up);
    drive(20);
    expect(game.aimY).toBeLessThan(0);
    manager.keyUp(DEFAULT_BINDINGS.p1.up);
    const across = game.aimX;
    manager.keyDown(DEFAULT_BINDINGS.p1.left);
    drive(10);
    expect(game.aimX).toBeLessThan(across);
    manager.keyUp(DEFAULT_BINDINGS.p1.left);
    manager.keyDown(DEFAULT_BINDINGS.p1.down);
    drive(10);
    expect(game.aimY).toBeGreaterThan(-AIM_REACH);
  });

  it('draws on a held Space and looses on letting go, for seat one', () => {
    const { game, manager, drive } = harness('p1');
    manager.keyDown(DEFAULT_BINDINGS.p1.action);
    drive(FULL_DRAW_FRAMES);
    expect(game.drawSeconds).toBeCloseTo(DRAW_SECONDS, 6);
    expect(game.arrowInFlight, 'a held bow is not a loosed arrow').toBe(false);
    manager.keyUp(DEFAULT_BINDINGS.p1.action);
    drive(1);
    expect(game.arrowInFlight).toBe(true);
    drive(STEPS_TO_SCORE);
    expect(game.arrowsFor('p1')).toBe(1);
  });

  it('aims seat two with the arrows and looses on Enter', () => {
    const { game, manager, drive } = harness('p1');
    handOver(game, drive, manager);
    manager.keyDown(DEFAULT_BINDINGS.p2.right);
    drive(20);
    expect(game.aimX).toBeGreaterThan(0);
    manager.keyUp(DEFAULT_BINDINGS.p2.right);
    manager.keyDown(DEFAULT_BINDINGS.p2.action);
    drive(FULL_DRAW_FRAMES);
    expect(game.arrowInFlight).toBe(false);
    manager.keyUp(DEFAULT_BINDINGS.p2.action);
    drive(1);
    expect(game.arrowInFlight).toBe(true);
    drive(STEPS_TO_SCORE);
    expect(game.arrowsFor('p2')).toBe(1);
  });

  it('never lets one seat drive the other, whichever half is pressed', () => {
    // The two key halves belong to two people. On seat one's turn, seat two's keys are
    // inert — which is the honest reading of the string and the opposite of "either half".
    const { game, manager, drive } = harness('p1');
    manager.keyDown(DEFAULT_BINDINGS.p2.right);
    manager.keyDown(DEFAULT_BINDINGS.p2.action);
    drive(40);
    expect(game.aimX).toBe(0);
    expect(game.arrowInFlight).toBe(false);
    expect(game.arrowsFor('p1')).toBe(0);
  });

  it('aims where a finger is, draws while it is down and looses when it lifts', () => {
    const { game, manager, drive } = harness('p1');
    // A drag: down well right of the middle of the pad, moved back towards it, then lifted.
    manager.pointerDown(1, PAD_CX + PAD_HALF_W * 0.6, PAD_CY - PAD_HALF_H * 0.4);
    drive(2);
    expect(game.aimX).toBeGreaterThan(0.6);
    expect(game.aimY).toBeLessThan(0);
    manager.pointerMove(1, PAD_CX + PAD_HALF_W * 0.1, PAD_CY);
    drive(FULL_DRAW_FRAMES);
    expect(game.aimX).toBeLessThan(0.3);
    expect(game.arrowInFlight, 'a finger on the glass draws the bow, it does not loose').toBe(
      false,
    );
    manager.pointerUp(1);
    drive(1);
    expect(game.arrowInFlight).toBe(true);
    drive(STEPS_TO_SCORE);
    expect(game.arrowsFor('p1')).toBe(1);
  });

  it('reads a finger anywhere on the field, which is what the string promises', () => {
    // "Drag anywhere" has to mean anywhere: a finger above the pad is clamped to the top
    // of the sight's travel rather than ignored, so no part of the board is dead.
    const { game, manager, drive } = harness('p1');
    manager.pointerDown(1, 20, 60);
    drive(2);
    expect(game.aimX).toBe(-AIM_REACH);
    expect(game.aimY).toBe(-AIM_REACH);
  });
});
