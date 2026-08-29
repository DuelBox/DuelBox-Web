import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign } from '@duelbox/engine';
import type { GameContext, MatchScore, Renderer } from '@duelbox/game-sdk';
import { GolfFootballGame } from './game.js';
import { manifest } from './manifest.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  KICKS_EACH,
  READY_SECONDS,
  ballOf,
  distanceToCup,
} from './rules.js';

const STEP = 1 / 60;
/** The shell's own half-turn, which the ready freeze is set to outlast. */
const FLIP_SECONDS = 0.36;

function context(overrides: Partial<GameContext> = {}): GameContext {
  return {
    manifest,
    rng: new Rng(20260829),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: () => null,
    ...overrides,
  };
}

/** A turn game owns the whole pointer surface: the pitch turns to face whoever is kicking. */
function inputs(): { manager: InputManager; view: InputView } {
  return {
    manager: new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function drive(
  game: GolfFootballGame,
  view: InputView,
  manager: InputManager,
  steps: number,
): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

/* ------------------------------------------------------------------ a recording renderer */

interface Mark {
  readonly kind: string;
  readonly colour: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  /** Primitive and size, never position: what rule 7 is actually about. */
  readonly glyph: string;
}

class Recorder implements Renderer {
  readonly marks: Mark[] = [];

  #push(kind: string, colour: string, l: number, t: number, r: number, b: number, glyph: string) {
    this.marks.push({ kind, colour, left: l, top: t, right: r, bottom: b, glyph });
  }

  clear(): void {}

  rect(x: number, y: number, w: number, h: number, colour: string): void {
    this.#push('rect', colour, x, y, x + w, y + h, `rect|${round(w)}|${round(h)}`);
  }

  strokeRect(x: number, y: number, w: number, h: number, lw: number, colour: string): void {
    this.#push(
      'strokeRect',
      colour,
      x - lw,
      y - lw,
      x + w + lw,
      y + h + lw,
      `srect|${round(w)}|${round(h)}|${round(lw)}`,
    );
  }

  circle(x: number, y: number, r: number, colour: string): void {
    this.#push('circle', colour, x - r, y - r, x + r, y + r, `circ|${round(r)}`);
  }

  strokeCircle(x: number, y: number, r: number, lw: number, colour: string): void {
    this.#push(
      'strokeCircle',
      colour,
      x - r - lw,
      y - r - lw,
      x + r + lw,
      y + r + lw,
      `scirc|${round(r)}|${round(lw)}`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, lw: number, colour: string): void {
    this.#push(
      'line',
      colour,
      Math.min(x1, x2) - lw,
      Math.min(y1, y2) - lw,
      Math.max(x1, x2) + lw,
      Math.max(y1, y2) + lw,
      `line|${round(Math.hypot(x2 - x1, y2 - y1))}|${round(lw)}`,
    );
  }

  text(value: string, x: number, y: number, size: number, colour: string, align?: TextAlign): void {
    // Only the anchor is recorded. A string's drawn width is a font metric the renderer owns
    // and a game cannot know, so a bounds check on it would be checking the stub.
    void align;
    this.#push('text', colour, x, y - size / 2, x, y + size / 2, `text|${value}|${round(size)}`);
  }

  pushSeatRotation(): void {}
  pushRotation(): void {}
  popSeatRotation(): void {}
}

function round(value: number): number {
  return Math.round(Math.abs(value) * 4) / 4;
}

/* ------------------------------------------------------------------ the contract */

describe('the contract', () => {
  it('reports whose turn it is, and it is the seat the SDK named', () => {
    for (const opening of ['p1', 'p2'] as const) {
      const game = new GolfFootballGame();
      game.init(context({ openingSeat: opening }));
      expect(game.getActiveSeat()).toBe(opening);
      expect(game.match.seat).toBe(opening);
      game.destroy();
    }
  });

  it('scores as the shell expects, and names a winner exactly once', () => {
    const game = new GolfFootballGame();
    game.init(context({ botDifficulty: () => 'normal' }));
    const { manager, view } = inputs();
    let first: MatchScore | null = null;
    for (let i = 0; i < 60 * 600; i += 1) {
      drive(game, view, manager, 1);
      const score = game.getScore();
      expect(Number.isInteger(score.p1)).toBe(true);
      expect(Number.isInteger(score.p2)).toBe(true);
      if (score.winner !== null) {
        first ??= score;
        // Once decided, nothing moves again.
        expect(score.p1).toBe(first.p1);
        expect(score.p2).toBe(first.p2);
        expect(score.winner).toBe(first.winner);
        if (i > 60 * 3) break;
      }
    }
    expect(first, 'two normal bots finished a match').not.toBeNull();
    expect(game.match.kicksBy.p1).toBe(KICKS_EACH);
    expect(game.match.kicksBy.p2).toBe(KICKS_EACH);
    game.destroy();
  });

  it('renders without touching a thing, at any alpha', () => {
    const game = new GolfFootballGame();
    game.init(context({ botDifficulty: () => 'hard' }));
    const { manager, view } = inputs();
    drive(game, view, manager, 240);

    const before = snapshot(game);
    const a = new Recorder();
    const b = new Recorder();
    game.render(a, 0);
    game.render(b, 0.87);
    expect(snapshot(game)).toEqual(before);
    // This game does not interpolate, so two alphas must draw the identical frame.
    expect(b.marks).toEqual(a.marks);
    game.destroy();
  });

  it('draws nothing outside the logical box, through a whole match', () => {
    const game = new GolfFootballGame();
    game.init(context({ botDifficulty: () => 'easy' }));
    const { manager, view } = inputs();
    for (let i = 0; i < 60 * 90; i += 1) {
      drive(game, view, manager, 1);
      if (i % 7 !== 0) continue;
      const recorder = new Recorder();
      game.render(recorder, 0);
      for (const mark of recorder.marks) {
        expect(mark.left, `${mark.kind} off the left`).toBeGreaterThanOrEqual(-0.5);
        expect(mark.top, `${mark.kind} off the top`).toBeGreaterThanOrEqual(-0.5);
        expect(mark.right, `${mark.kind} off the right`).toBeLessThanOrEqual(BOARD_WIDTH + 0.5);
        expect(mark.bottom, `${mark.kind} off the bottom`).toBeLessThanOrEqual(BOARD_HEIGHT + 0.5);
      }
      if (game.getScore().winner !== null) break;
    }
    game.destroy();
  });

  it('releases everything on destroy, and stands back up on the next init', () => {
    const game = new GolfFootballGame();
    game.init(context({ botDifficulty: () => 'normal' }));
    const { manager, view } = inputs();
    drive(game, view, manager, 600);
    expect(game.match.kicks).toBeGreaterThan(0);

    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.kicks).toBe(0);
    expect(game.event).toBe('');

    game.init(context({ openingSeat: 'p2' }));
    expect(game.getActiveSeat()).toBe('p2');
    expect(game.match.points).toEqual({ p1: 0, p2: 0 });
    game.destroy();
  });

  it('survives pause and resume without losing the turn', () => {
    const game = new GolfFootballGame();
    game.init(context({ botDifficulty: () => 'normal' }));
    const { manager, view } = inputs();
    drive(game, view, manager, 200);
    const seat = game.getActiveSeat();
    game.onPause();
    game.onResume();
    expect(game.getActiveSeat()).toBe(seat);
    drive(game, view, manager, 60);
    game.destroy();
  });
});

function snapshot(game: GolfFootballGame): string {
  const m = game.match;
  return JSON.stringify([
    m.phase,
    m.seat,
    m.aim,
    m.power,
    m.clock,
    m.hold,
    m.kicks,
    m.points,
    m.rangeGoals,
    m.holedRange,
    m.p1,
    m.p2,
    game.event,
  ]);
}

/* ------------------------------------------------------------------ input */

describe('the one gesture', () => {
  it('reads a key and a finger as the same two moments', () => {
    // The game reads `actionPressed`, `actionHeld` and `actionReleased` and never a pointer
    // position, so the two instruments are the same instrument by construction. The proof is
    // that the same press and release, spelled either way, produce the identical kick.
    const byKey = kickWith('key');
    const byFinger = kickWith('pointer');
    expect(byFinger.vx).toBe(byKey.vx);
    expect(byFinger.vy).toBe(byKey.vy);
    expect(byFinger.vx === 0 && byFinger.vy === 0).toBe(false);
  });

  it('takes a press and a release on the same step as the feeblest legal kick', () => {
    const game = new GolfFootballGame();
    game.init(context());
    const { manager, view } = inputs();
    drive(game, view, manager, Math.ceil(READY_SECONDS * 60) + 2);
    expect(game.match.phase).toBe('aiming');
    manager.keyDown('Space');
    manager.keyUp('Space');
    drive(game, view, manager, 1);
    expect(game.match.kicks).toBe(1);
    game.destroy();
  });

  it('ignores the seat that is not to kick', () => {
    const game = new GolfFootballGame();
    game.init(context({ openingSeat: 'p1' }));
    const { manager, view } = inputs();
    drive(game, view, manager, Math.ceil(READY_SECONDS * 60) + 2);
    manager.keyDown('Enter');
    drive(game, view, manager, 4);
    expect(game.match.phase).toBe('aiming');
    manager.keyUp('Enter');
    drive(game, view, manager, 2);
    expect(game.match.kicks).toBe(0);
    game.destroy();
  });
});

function kickWith(instrument: 'key' | 'pointer'): { vx: number; vy: number } {
  const game = new GolfFootballGame();
  game.init(context());
  const { manager, view } = inputs();
  drive(game, view, manager, Math.ceil(READY_SECONDS * 60) + 20);
  if (instrument === 'key') manager.keyDown('Space');
  else manager.pointerDown(1, 120, 640);
  drive(game, view, manager, 30);
  if (instrument === 'key') manager.keyUp('Space');
  else manager.pointerUp(1);
  drive(game, view, manager, 1);
  const ball = ballOf(game.match, 'p1');
  const kick = { vx: ball.vx, vy: ball.vy };
  game.destroy();
  return kick;
}

/* ------------------------------------------------------------------ the flip and the freeze */

describe('the seat flip', () => {
  it('costs a person nothing, because the ready freeze outlasts it', () => {
    // The shell refuses a person's input for the 0.36 s the pitch takes to turn. A bot does
    // not go through the shell. The freeze is in the rules and is longer than the flip, so
    // the two arrive at the live needle together — and there is nothing for the bot to have.
    expect(READY_SECONDS).toBeGreaterThan(FLIP_SECONDS);
    const game = new GolfFootballGame();
    game.init(context({ botDifficulty: (seat) => (seat === 'p2' ? 'hard' : null) }));
    const { manager, view } = inputs();
    // Play through p1's turn on the deadlines, so the turn passes and the pitch flips.
    while (game.getActiveSeat() === 'p1') drive(game, view, manager, 1);
    // The moment the turn changed, the rules are in the freeze — for both of them.
    expect(game.match.phase).toBe('ready');
    let frozen = 0;
    while (game.match.phase === 'ready') {
      frozen += 1;
      drive(game, view, manager, 1);
    }
    expect(frozen * STEP).toBeGreaterThan(FLIP_SECONDS);
    game.destroy();
  });

  it('steps the identical match in both presentations, under a raw storm on both seats', () => {
    // The sharpest form of the parity check, and the ready freeze is what makes it possible:
    // shared-screen refuses input while the pitch turns and single-seat never turns at all,
    // but the freeze outlasts the flip, so every press the flip would have swallowed lands in
    // the freeze and is refused by the rules in *both* arms. Nothing needs a settle gate.
    const trace = (presentation: Presentation): string[] =>
      storm(presentation, presentation === 'shared-screen' ? 'p1' : 'p2');
    expect(trace('single-seat')).toEqual(trace('shared-screen'));
  });
});

function storm(presentation: Presentation, localSeat: SeatId): string[] {
  const game = new GolfFootballGame();
  const rng = new CountingRng(4242);
  game.init(context({ presentation, localSeat, rng, botDifficulty: () => null }));
  rng.counting = true;
  const { manager, view } = inputs();
  const script = new Rng(19);
  const out: string[] = [];
  let down = false;
  for (let i = 0; i < 60 * 200; i += 1) {
    // No settle gate, no waiting for the pitch: the raw storm on both keyboard halves.
    const wanted = script.float() < 0.5;
    if (wanted !== down) {
      setKeys(manager, wanted);
      down = wanted;
    }
    drive(game, view, manager, 1);
    const score = game.getScore();
    out.push(
      `${String(score.p1)}:${String(score.p2)}:${String(score.winner)}:${game.getActiveSeat()}:${String(game.match.kicks)}:${String(rng.draws)}`,
    );
    if (score.winner !== null) break;
  }
  game.destroy();
  return out;
}

/** Both keyboard halves at once. A parameter rather than a narrowed local, so the flag is a
 * boolean to the type checker as well as to the storm. */
function setKeys(manager: InputManager, down: boolean): void {
  for (const key of ['Space', 'Enter']) {
    if (down) manager.keyDown(key);
    else manager.keyUp(key);
  }
}

class CountingRng extends Rng {
  draws = 0;
  counting = false;

  override next(): number {
    if (this.counting) this.draws += 1;
    return super.next();
  }
}

/* ------------------------------------------------------------------ rule 7 */

describe('rule 7', () => {
  it('draws the two seats from different shapes, not just different colours', () => {
    // The same question `apps/web/src/data/greyscale.test.ts` asks, asked locally: a mark
    // belongs to a seat when its colour is exactly one of that seat's palette strings, and
    // the two seats must not reduce to the same set of shapes.
    const game = new GolfFootballGame();
    game.init(context({ botDifficulty: () => 'normal' }));
    const { manager, view } = inputs();
    const seen: Record<SeatId, Set<string>> = { p1: new Set(), p2: new Set() };
    let frames = 0;
    for (let i = 0; i < 60 * 120; i += 1) {
      drive(game, view, manager, 1);
      if (i % 12 !== 0) continue;
      const recorder = new Recorder();
      game.render(recorder, 0);
      const frame: Record<SeatId, Set<string>> = { p1: new Set(), p2: new Set() };
      for (const mark of recorder.marks) {
        const seat = seatOf(mark.colour);
        if (seat !== null) frame[seat].add(mark.glyph);
      }
      if (frame.p1.size > 0 && frame.p2.size > 0) {
        frames += 1;
        for (const seat of ['p1', 'p2'] as const) for (const g of frame[seat]) seen[seat].add(g);
      }
      if (game.getScore().winner !== null) break;
    }
    expect(frames, 'both seats were on the pitch together').toBeGreaterThan(10);
    const onlyP1 = [...seen.p1].filter((g) => !seen.p2.has(g));
    const onlyP2 = [...seen.p2].filter((g) => !seen.p1.has(g));
    expect(onlyP1.length, `p1 has no shape p2 lacks: ${[...seen.p1].join(', ')}`).toBeGreaterThan(
      0,
    );
    expect(onlyP2.length, `p2 has no shape p1 lacks: ${[...seen.p2].join(', ')}`).toBeGreaterThan(
      0,
    );
    game.destroy();
  });

  it('never marks a turn with a seat colour, so no signal flickers', () => {
    // The halo on the ball to be kicked is drawn in ink. In a seat colour it would be a
    // rule 7 signal present in only half the frames, which is not something a player can
    // navigate by — and it is the shell's turn indicator's job in any case.
    const game = new GolfFootballGame();
    game.init(context({ botDifficulty: () => 'easy' }));
    const { manager, view } = inputs();
    const counts: Record<SeatId, number[]> = { p1: [], p2: [] };
    for (let i = 0; i < 60 * 60; i += 1) {
      drive(game, view, manager, 1);
      if (i % 15 !== 0) continue;
      const recorder = new Recorder();
      game.render(recorder, 0);
      for (const seat of ['p1', 'p2'] as const) {
        counts[seat].push(recorder.marks.filter((m) => seatOf(m.colour) === seat).length);
      }
    }
    for (const seat of ['p1', 'p2'] as const) {
      expect(counts[seat].length, `${seat} was never sampled`).toBeGreaterThan(10);
      // One value for the whole match: the ball, its mark, the scoreboard token and its
      // mark. Four for seat one, whose mark is a ring, and six for seat two, whose mark is
      // a cross drawn as two lines — which is itself part of what tells them apart.
      expect(new Set(counts[seat]).size, `${seat}'s seat-coloured marks come and go`).toBe(1);
      expect(counts[seat][0]).toBe(seat === 'p1' ? 4 : 6);
    }
    game.destroy();
  });
});

function seatOf(colour: string): SeatId | null {
  for (const seat of ['p1', 'p2'] as const) {
    const palette = SEAT_PALETTE[seat];
    if (
      colour === palette.base ||
      colour === palette.deep ||
      colour === palette.tint ||
      colour === palette.soft
    ) {
      return seat;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ balance, through the shell */

describe('balance through the shell', () => {
  it('gives neither seat more than the 45-55 band at equal skill', () => {
    // The same measurement `apps/web/src/data/balance-aggregate.test.ts` makes: both bots on
    // one tier, both opening seats, seat one's share of the decided matches. Small here — the
    // recorded numbers in SPEC.md are over 2000 matches a tier.
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      let one = 0;
      let two = 0;
      for (let s = 0; s < 24; s += 1) {
        for (const openingSeat of ['p1', 'p2'] as const) {
          const game = new GolfFootballGame();
          game.init(
            context({
              rng: new Rng(1000003 + s * 7919),
              openingSeat,
              botDifficulty: () => tier,
            }),
          );
          const { manager, view } = inputs();
          let winner: MatchScore['winner'] = null;
          for (let i = 0; i < 60 * 600 && winner === null; i += 1) {
            drive(game, view, manager, 1);
            winner = game.getScore().winner;
          }
          expect(winner, `${tier} seed ${String(s)} never finished`).not.toBeNull();
          if (winner === 'p1') one += 1;
          else if (winner === 'p2') two += 1;
          game.destroy();
        }
      }
      const share = one / (one + two);
      expect(share, `${tier} gave seat one ${(share * 100).toFixed(1)}%`).toBeGreaterThan(0.33);
      expect(share, `${tier} gave seat one ${(share * 100).toFixed(1)}%`).toBeLessThan(0.67);
    }
  });

  it('starts both balls the same distance from the cup', () => {
    const game = new GolfFootballGame();
    game.init(context());
    expect(distanceToCup(game.match.p1.x, game.match.p1.y)).toBeCloseTo(
      distanceToCup(game.match.p2.x, game.match.p2.y),
      12,
    );
    game.destroy();
  });
});
