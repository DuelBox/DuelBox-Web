import { beforeEach, describe, expect, it } from 'vitest';
import { Rng, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { ShurikenGame } from './game.js';
import { manifest } from './manifest.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CANES_PER_SEAT,
  MAX_AIM,
  MAX_SPIN,
  MAX_THROWS,
  THROW_X,
  THROW_Y,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

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
    }
  }
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

  clear(): void {
    this.calls += 1;
  }
  rect(): void {
    this.calls += 1;
    this.rects += 1;
  }
  strokeRect(): void {
    this.calls += 1;
    this.rects += 1;
  }
  circle(x: number, y: number, radius: number): void {
    this.calls += 1;
    this.circles += 1;
    expect(Number.isFinite(x + y + radius)).toBe(true);
    expect(radius).toBeGreaterThan(0);
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

function step(game: ShurikenGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

/** Put a finger on the glass at a place on the board, in the frame that seat reads. */
function touch(input: FakeInput, seat: SeatId, x: number, y: number, rotated = false): void {
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = rotated ? { x: BOARD_WIDTH - x, y: BOARD_HEIGHT - y } : { x, y };
  target.actionHeld = true;
}

/** Lift, which is what commits a pointer throw. The pointer is gone by then, as it is in life. */
function lift(input: FakeInput, seat: SeatId): void {
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = null;
  target.actionHeld = false;
  target.actionReleased = true;
}

/** Throw with the keys: hold a direction for a while, then press. */
function keyThrow(
  game: ShurikenGame,
  input: FakeInput,
  seat: SeatId,
  dx: number,
  dy: number,
): void {
  input.clear();
  const target = seat === 'p1' ? input.p1 : input.p2;
  set(target.move, dx, dy);
  step(game, input, 12);
  input.clear();
  (seat === 'p1' ? input.p1 : input.p2).actionPressed = true;
  step(game, input);
  input.clear();
  step(game, input, 200);
}

describe('taking turns', () => {
  let game: ShurikenGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new ShurikenGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('starts with six canes a seat and p1 to throw', () => {
    expect(game.getScore()).toEqual({ p1: CANES_PER_SEAT, p2: CANES_PER_SEAT, winner: null });
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('reports canes still standing, which is the number the game is about', () => {
    // Not throws made, not points scored. What is left of your grove is the score and the
    // health bar at once, and it is drawn on the board as well as printed by the shell.
    game.state.canes[CANES_PER_SEAT]!.standing = false;
    expect(game.getScore().p2).toBe(CANES_PER_SEAT - 1);
  });

  it('passes the grove to the other seat after a throw', () => {
    keyThrow(game, input, 'p1', 1, 0);
    expect(game.getActiveSeat()).toBe('p2');
    expect(game.state.p1Throws).toBe(1);
  });

  it('ignores the seat whose turn it is not', () => {
    input.p2.actionPressed = true;
    set(input.p2.move, 1, 0);
    step(game, input, 30);
    expect(game.state.throws).toBe(0);
    expect(game.state.aim).toBe(0);
  });

  it('accepts nothing while a blade is in the air', () => {
    input.p1.actionPressed = true;
    step(game, input);
    expect(game.state.phase).toBe('flying');
    input.clear();
    input.p1.actionPressed = true;
    step(game, input, 2);
    expect(game.state.throws).toBe(1);
  });
});

describe('playing with the keyboard alone', () => {
  let game: ShurikenGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new ShurikenGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('swings the sight with left and right', () => {
    set(input.p1.move, 1, 0);
    step(game, input, 20);
    expect(game.state.aim).toBeGreaterThan(0.1);
    input.clear();
    set(input.p1.move, -1, 0);
    step(game, input, 40);
    expect(game.state.aim).toBeLessThan(0);
  });

  it('winds spin on with up and down', () => {
    set(input.p1.move, 0, 1);
    step(game, input, 20);
    expect(game.state.spin).toBeGreaterThan(0.2);
    input.clear();
    set(input.p1.move, 0, -1);
    step(game, input, 40);
    expect(game.state.spin).toBeLessThan(0);
  });

  it('never swings past the cone or the spin range, however long a key is held', () => {
    set(input.p1.move, 1, 1);
    step(game, input, 600);
    expect(game.state.aim).toBe(MAX_AIM);
    expect(game.state.spin).toBe(MAX_SPIN);
  });

  it('throws on the press, because there is nothing to preview while a key is down', () => {
    set(input.p1.move, 1, 0);
    step(game, input, 10);
    input.clear();
    input.p1.actionPressed = true;
    step(game, input);
    expect(game.state.phase).toBe('flying');
    expect(game.state.shot.heading).toBeGreaterThan(0);
  });

  it('plays a whole match with keys and nothing else', () => {
    const seen = new Set<string>();
    for (let turn = 0; turn < MAX_THROWS && game.getScore().winner === null; turn += 1) {
      const seat = game.getActiveSeat();
      seen.add(seat);
      keyThrow(game, input, seat, turn % 3 === 0 ? 1 : -1, turn % 2 === 0 ? 1 : -1);
    }
    expect(seen.size, 'both seats took turns').toBe(2);
    expect(game.state.throws).toBeGreaterThan(4);
  });
});

describe('playing with a thumb alone', () => {
  let game: ShurikenGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new ShurikenGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('points the throw at the finger', () => {
    touch(input, 'p1', THROW_X + 200, THROW_Y - 200);
    step(game, input, 2);
    expect(game.state.aim).toBeCloseTo(Math.PI / 4, 4);
    touch(input, 'p1', THROW_X - 200, THROW_Y - 200);
    step(game, input, 2);
    expect(game.state.aim).toBeCloseTo(-Math.PI / 4, 4);
  });

  it('adds spin from the sideways travel of the finger, and none from its arrival', () => {
    touch(input, 'p1', THROW_X, THROW_Y - 300);
    step(game, input);
    expect(game.state.spin, 'a finger arriving has not travelled yet').toBe(0);
    for (let i = 1; i <= 20; i += 1) {
      touch(input, 'p1', THROW_X + i * 12, THROW_Y - 300);
      step(game, input);
    }
    expect(game.state.spin).toBeGreaterThan(0.5);

    // And back the other way takes it off again, which is what a sweep is.
    for (let i = 20; i >= -20; i -= 1) {
      touch(input, 'p1', THROW_X + i * 12, THROW_Y - 300);
      step(game, input);
    }
    expect(game.state.spin).toBeLessThan(0);
  });

  it('throws when the finger lifts, not while it is down', () => {
    touch(input, 'p1', THROW_X + 120, THROW_Y - 300);
    step(game, input, 10);
    expect(game.state.phase, 'holding must not throw').toBe('aiming');
    lift(input, 'p1');
    step(game, input);
    expect(game.state.phase).toBe('flying');
  });

  it('reads the far seat through the half-turn it is looking at', () => {
    // p2 sits opposite. Its finger arrives in device coordinates, and the same place on the
    // board for p2 is the mirror of the place it is for p1 — the engine's `toWorld`, which
    // is the one definition of that and never reimplemented here.
    const shared = new ShurikenGame();
    shared.init(makeContext(null, null, 'shared-screen', 'p1'));
    const keys = new FakeInput();
    keys.p1.actionPressed = true;
    step(shared, keys, 1);
    keys.clear();
    // Run the throw and the turn out, so p2 is to play and the board has settled facing it.
    step(shared, keys, 260);
    expect(shared.getActiveSeat()).toBe('p2');

    touch(keys, 'p2', THROW_X + 200, THROW_Y - 200, true);
    step(shared, keys, 2);
    expect(shared.state.aim).toBeCloseTo(Math.PI / 4, 4);
  });

  it('plays a whole match with a thumb and nothing else', () => {
    let turns = 0;
    while (game.getScore().winner === null && turns < MAX_THROWS) {
      const seat = game.getActiveSeat();
      touch(input, seat, THROW_X + (turns % 2 === 0 ? 180 : -180), THROW_Y - 420);
      step(game, input, 6);
      lift(input, seat);
      step(game, input);
      input.clear();
      step(game, input, 200);
      turns += 1;
    }
    expect(game.state.throws).toBeGreaterThan(4);
  });
});

describe('the two instruments', () => {
  it('reach the same throw from the keyboard and from a thumb', () => {
    // Rule 10 in this game's own terms: a finger names an angle directly and the keys walk
    // to it, and both arrive at the same throw. Neither aims finer than the other.
    const byThumb = new ShurikenGame();
    byThumb.init(makeContext(null, null));
    const thumb = new FakeInput();
    touch(thumb, 'p1', THROW_X + 300, THROW_Y - 300);
    byThumb.update(STEP, thumb);
    const wanted = byThumb.state.aim;

    const byKeys = new ShurikenGame();
    byKeys.init(makeContext(null, null));
    const keys = new FakeInput();
    set(keys.p1.move, 1, 0);
    for (let i = 0; i < 600 && byKeys.state.aim < wanted; i += 1) byKeys.update(STEP, keys);
    expect(byKeys.state.aim).toBeCloseTo(wanted, 1);
    // And in a time a person would put up with: under a second of holding a key.
    expect(wanted / 1.15).toBeLessThan(1);
  });
});

describe('the bot', () => {
  it('takes its own turns, from either seat', () => {
    // A bot in seat two only ever gets a turn once seat one has taken theirs, so the
    // person opposite has to actually play. Stepping an idle input instead proves nothing
    // about the bot and everything about the human: see 'leaves a seat with no bot alone'
    // below, which is the deliberate behaviour this test must not contradict.
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const game = new ShurikenGame();
      const input = new FakeInput();
      const person: SeatId = seat === 'p1' ? 'p2' : 'p1';
      game.init(makeContext(seat === 'p1' ? 'normal' : null, seat === 'p2' ? 'normal' : null));
      for (let turn = 0; turn < 4 && game.getScore().winner === null; turn += 1) {
        if (game.getActiveSeat() === person) keyThrow(game, input, person, 1, 0);
        else step(game, input, 240);
      }
      const throws = seat === 'p1' ? game.state.p1Throws : game.state.p2Throws;
      expect(throws, `${seat} never threw`).toBeGreaterThan(0);
      const theirs = seat === 'p1' ? game.state.p2Throws : game.state.p1Throws;
      expect(theirs, `${person} never threw, so the bot was never given a turn`).toBeGreaterThan(0);
    }
  });

  it('finishes a match against itself at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new ShurikenGame();
      const input = new FakeInput();
      game.init(makeContext(tier, tier));
      let steps = 0;
      for (; steps < 60 * 600 && game.getScore().winner === null; steps += 1) {
        game.update(STEP, input);
      }
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      expect(game.state.throws).toBeLessThanOrEqual(MAX_THROWS);
    }
  });

  it('plays a visibly different match on easy and on hard', () => {
    // The claim `bot-parity.test.ts` makes for the whole catalogue, asserted here in this
    // game's own terms so a broken tier is caught by its own suite first.
    const trace = (tier: BotDifficulty): string => {
      const game = new ShurikenGame();
      const input = new FakeInput();
      game.init(makeContext(tier, tier, 'shared-screen', 'p1', 20260823));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 25; i += 1) {
        game.update(STEP, input);
        if (i % 15 !== 0) continue;
        const score = game.getScore();
        seen.push(
          `${String(score.p1)}:${String(score.p2)}:${game.state.phase}:${game.state.aim.toFixed(3)}`,
        );
        if (score.winner !== null) break;
      }
      return seen.join('|');
    };
    expect(trace('easy')).not.toBe(trace('hard'));
  });

  it('plays a different match with a bot in the seat than with nobody', () => {
    const trace = (tier: BotDifficulty | null): string => {
      const game = new ShurikenGame();
      const input = new FakeInput();
      game.init(makeContext(tier, tier, 'shared-screen', 'p1', 20260823));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 25; i += 1) {
        game.update(STEP, input);
        seen.push(`${String(game.getScore().p1)}:${game.state.phase}`);
      }
      return seen.join('|');
    };
    expect(trace('normal')).not.toBe(trace(null));
  });

  it('leaves a seat with no bot alone', () => {
    const game = new ShurikenGame();
    const input = new FakeInput();
    game.init(makeContext(null, 'hard'));
    step(game, input, 60 * 20);
    // p1 is a human who has not touched anything, so p1 has thrown nothing and the match
    // waits for them for ever rather than playing itself.
    expect(game.state.p1Throws).toBe(0);
    expect(game.getActiveSeat()).toBe('p1');
  });
});

describe('lifecycle and render', () => {
  it('renders a balanced frame and draws no text of its own', () => {
    const game = new ShurikenGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, 5);

    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.depth).toBe(0);
    expect(renderer.maxDepth).toBe(1);
    expect(renderer.circles).toBeGreaterThan(0);
    expect(renderer.rects).toBeGreaterThan(0);
    // The shell owns the HUD, the countdown and the result. A game drawing its own would
    // be a second scoreboard disagreeing with the first.
    expect(renderer.texts).toBe(0);
  });

  it('draws the blade in the air and the hand when it is not', () => {
    const game = new ShurikenGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    const aiming = new RecordingRenderer();
    game.render(aiming);
    input.p1.actionPressed = true;
    step(game, input, 10);
    const flying = new RecordingRenderer();
    game.render(flying);
    expect(game.state.phase).toBe('flying');
    expect(flying.lines).toBeGreaterThan(0);
    expect(aiming.calls).not.toBe(flying.calls);
  });

  it('never rotates in single-seat presentation', () => {
    const game = new ShurikenGame();
    const input = new FakeInput();
    game.init(makeContext('normal', 'normal', 'single-seat', 'p1'));
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 60 * 12; i += 1) {
      game.update(STEP, input);
      game.render(renderer);
    }
    expect(renderer.angles.every((angle) => angle === 0)).toBe(true);
  });

  it('turns to face the far seat in shared-screen', () => {
    const game = new ShurikenGame();
    const input = new FakeInput();
    game.init(makeContext('normal', 'normal', 'shared-screen', 'p1'));
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 60 * 12; i += 1) {
      game.update(STEP, input);
      game.render(renderer);
    }
    expect(renderer.angles.some((angle) => angle > 0.01)).toBe(true);
  });

  it('simulates the identical match in both presentations', () => {
    // Presentation is placement and rotation, never rules. If the two diverged, a remote
    // match between a shared screen and a single seat would desynchronise.
    const trace = (presentation: Presentation): string => {
      const game = new ShurikenGame();
      const input = new FakeInput();
      game.init(makeContext('normal', 'hard', presentation, 'p1', 555));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 120 && game.getScore().winner === null; i += 1) {
        game.update(STEP, input);
        const score = game.getScore();
        seen.push(`${String(score.p1)}:${String(score.p2)}:${game.state.shot.x.toFixed(4)}`);
      }
      return seen.join('|');
    };
    expect(trace('shared-screen')).toBe(trace('single-seat'));
  });

  it('replays identically from the same seed', () => {
    const play = (): string => {
      const game = new ShurikenGame();
      const input = new FakeInput();
      game.init(makeContext('hard', 'easy', 'shared-screen', 'p1', 24680));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 200 && game.getScore().winner === null; i += 1) {
        game.update(STEP, input);
        const score = game.getScore();
        seen.push(`${String(score.p1)}:${String(score.p2)}`);
      }
      return seen.join('|');
    };
    expect(play()).toBe(play());
  });

  it('survives a pause and a resume in the middle of a flight', () => {
    const game = new ShurikenGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    input.p1.actionPressed = true;
    step(game, input, 3);
    input.clear();
    game.onPause();
    game.onResume();
    step(game, input, 200);
    expect(game.state.throws).toBe(1);
    expect(game.getActiveSeat()).toBe('p2');
  });

  it('stands a fresh grove back up on destroy', () => {
    const game = new ShurikenGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'hard'));
    step(game, input, 60 * 30);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: CANES_PER_SEAT, p2: CANES_PER_SEAT, winner: null });
    expect(game.state.throws).toBe(0);
  });

  it('can be initialised twice without carrying anything over', () => {
    const game = new ShurikenGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'hard'));
    step(game, input, 60 * 20);
    game.init(makeContext(null, null, 'single-seat', 'p1', 99));
    expect(game.getScore()).toEqual({ p1: CANES_PER_SEAT, p2: CANES_PER_SEAT, winner: null });
    expect(game.getActiveSeat()).toBe('p1');
    step(game, input, 60 * 5);
    expect(game.state.throws, 'the old bots must not still be playing').toBe(0);
  });
});

describe('the manifest tells the truth', () => {
  it('says what the keys actually do', () => {
    const { keyboard } = manifest.controls;
    expect(keyboard).toContain('A and D');
    expect(keyboard).toContain('W and S');
    expect(keyboard).toContain('Space');
    expect(keyboard).toContain('Enter');
    // Each seat gets its own half of the keyboard, and the string says so rather than
    // offering both halves to one player.
    expect(keyboard).toMatch(/seat/i);
    expect(keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
    // And it says the half you are not holding does nothing until it is your turn, which
    // is what `#takeThrow` enforces — see 'ignores the seat whose turn it is not'.
    expect(keyboard).toMatch(/turn/i);
  });

  it('says what the pointer actually does', () => {
    const { pointer } = manifest.controls;
    expect(pointer).toMatch(/spin/i);
    expect(pointer).toMatch(/lift|release/i);
    expect(pointer.length).toBeGreaterThan(3);
  });

  it('declares the archetype the game actually is', () => {
    expect(manifest.archetype).toBe('turn-aim');
    expect(manifest.zoneSplit).toBe('shared-board');
    expect(manifest.modes).toContain('bot');
    expect(manifest.logical).toEqual({ width: BOARD_WIDTH, height: BOARD_HEIGHT });
    // A turn game has to say whose turn it is, or the shell treats it as real-time.
    expect(typeof new ShurikenGame().getActiveSeat).toBe('function');
  });
});
