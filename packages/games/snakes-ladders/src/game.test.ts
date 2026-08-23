import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOARD,
  BOARD_BOTTOM,
  BOARD_LEFT,
  BOARD_TOP,
  CELL,
  DIE_SIZE,
  DIE_Y,
  SnakesandLaddersGame,
  START_Y,
  TOKEN_RADIUS,
  dieBoxX,
  fieldCentreX,
  fieldCentreY,
  tokenCentre,
} from './game.js';
import { DICE, FIELDS, LADDERS, SNAKES, START, snakeAt } from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

interface MutableSeatInput {
  move: Vec2;
  pointer: Vec2 | null;
  actionPressed: boolean;
  actionHeld: boolean;
  actionReleased: boolean;
  holdSeconds: number;
}

function blankSeat(): MutableSeatInput {
  return {
    move: vec2(),
    pointer: null,
    actionPressed: false,
    actionHeld: false,
    actionReleased: false,
    holdSeconds: 0,
  };
}

class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  press(seat: SeatId): void {
    this.#of(seat).actionPressed = true;
  }

  release(seat: SeatId): void {
    this.#of(seat).actionPressed = false;
  }

  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
  }

  steer(seat: SeatId, x: number): void {
    this.#of(seat).move.x = x;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

type DrawArg = number | string | boolean | undefined;

interface DrawCall {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

class RecordingRenderer implements Renderer {
  readonly calls: DrawCall[] = [];

  get ops(): string[] {
    return this.calls.map((call) => call.op);
  }

  get args(): DrawArg[] {
    return this.calls.flatMap((call) => [...call.args]);
  }

  clear(colour: string): void {
    this.#record('clear', colour);
  }
  rect(x: number, y: number, w: number, h: number, colour: string): void {
    this.#record('rect', x, y, w, h, colour);
  }
  strokeRect(x: number, y: number, w: number, h: number, lw: number, colour: string): void {
    this.#record('strokeRect', x, y, w, h, lw, colour);
  }
  circle(x: number, y: number, r: number, colour: string): void {
    this.#record('circle', x, y, r, colour);
  }
  strokeCircle(x: number, y: number, r: number, lw: number, colour: string): void {
    this.#record('strokeCircle', x, y, r, lw, colour);
  }
  line(x1: number, y1: number, x2: number, y2: number, lw: number, colour: string): void {
    this.#record('line', x1, y1, x2, y2, lw, colour);
  }
  text(v: string, x: number, y: number, size: number, colour: string, align?: TextAlign): void {
    this.#record('text', v, x, y, size, colour, align);
  }
  pushSeatRotation(rotated: boolean): void {
    this.#record('pushSeatRotation', rotated);
  }
  pushRotation(radians: number): void {
    this.#record('pushRotation', radians);
  }
  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  #record(op: string, ...values: DrawArg[]): void {
    this.calls.push({ op, args: values });
  }
}

/** Put a game in the middle of a turn, which is where most of the behaviour lives. */
function choosing(game: SnakesandLaddersGame, seat: SeatId, field: number, dice: number[]): void {
  game.position.seat = seat;
  if (seat === 'p1') game.position.p1 = field;
  else game.position.p2 = field;
  for (let i = 0; i < DICE; i += 1) game.position.dice[i] = dice[i] ?? 1;
  game.position.phase = 'choosing';
}

function playOut(game: SnakesandLaddersGame, steps: number): void {
  const input = new ScriptedInput();
  for (let i = 0; i < steps && game.getScore().winner === null; i += 1) game.update(STEP, input);
}

describe('the geometry', () => {
  it('keeps every field inside the logical box', () => {
    for (let field = 1; field <= FIELDS; field += 1) {
      expect(fieldCentreX(field)).toBeGreaterThan(BOARD_LEFT);
      expect(fieldCentreX(field)).toBeLessThan(BOARD - BOARD_LEFT);
      expect(fieldCentreY(field)).toBeGreaterThan(BOARD_TOP);
      expect(fieldCentreY(field)).toBeLessThan(BOARD_BOTTOM);
    }
  });

  it('spaces consecutive fields exactly one cell apart', () => {
    // The board snakes back on itself, so a step is one cell sideways along a row and one
    // cell upward at the end of it — never a diagonal, which would misdraw every ladder.
    for (let field = 1; field < FIELDS; field += 1) {
      const dx = Math.abs(fieldCentreX(field + 1) - fieldCentreX(field));
      const dy = Math.abs(fieldCentreY(field + 1) - fieldCentreY(field));
      expect(dx + dy).toBeCloseTo(CELL, 6);
    }
  });

  it('puts field one at the bottom left and the last field above it', () => {
    expect(fieldCentreX(1)).toBeCloseTo(fieldCentreX(FIELDS), 6);
    expect(fieldCentreY(1)).toBeGreaterThan(fieldCentreY(FIELDS));
  });

  it('never stacks the two tokens exactly on top of each other', () => {
    for (let field = 1; field <= FIELDS; field += 1) {
      const one = tokenCentre('p1', field);
      const two = tokenCentre('p2', field);
      expect(Math.hypot(one.x - two.x, one.y - two.y)).toBeGreaterThan(TOKEN_RADIUS);
    }
  });

  it('parks both tokens off the board before the first roll', () => {
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const centre = tokenCentre(seat, START);
      expect(centre.y).toBeGreaterThan(BOARD_BOTTOM);
      expect(centre.y + TOKEN_RADIUS).toBeLessThan(BOARD);
    }
    const one = tokenCentre('p1', START);
    const two = tokenCentre('p2', START);
    expect(Math.abs(one.x - two.x), 'well apart').toBeGreaterThan(300);
  });

  it('lays the two dice side by side, clear of the board and of each other', () => {
    expect(dieBoxX(1) - (dieBoxX(0) + DIE_SIZE)).toBeGreaterThan(20);
    expect(DIE_Y).toBeGreaterThan(BOARD_BOTTOM);
    expect(DIE_Y + DIE_SIZE).toBeLessThan(BOARD);
  });

  it('keeps the waiting tokens off the dice', () => {
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const centre = tokenCentre(seat, START);
      for (let index = 0; index < DICE; index += 1) {
        const left = dieBoxX(index);
        const overlaps =
          centre.x > left - TOKEN_RADIUS && centre.x < left + DIE_SIZE + TOKEN_RADIUS;
        expect(overlaps, 'not on top of a die').toBe(false);
      }
    }
    expect(START_Y).toBeGreaterThan(BOARD_BOTTOM);
  });
});

describe('taking a turn', () => {
  it('rolls both dice on the action key', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.phase).toBe('choosing');
    for (const die of game.position.dice) expect(die).toBeGreaterThan(0);
  });

  it('rolls on a tap as well, so a thumb can start a turn', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(4));
    const input = new ScriptedInput();
    input.point('p1', BOARD / 2, BOARD / 2);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.phase).toBe('choosing');
  });

  it('does nothing at all while nobody presses anything', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(5));
    playOut(game, 600);
    expect(game.position.phase).toBe('rolling');
    expect(game.getScore()).toEqual({ p1: START, p2: START, winner: null });
  });

  it('moves the token on the die under the cursor', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(6));
    choosing(game, 'p1', 10, [1, 5]);
    const input = new ScriptedInput();
    input.steer('p1', 1);
    game.update(STEP, input);
    expect(game.cursorDie, 'a fresh press moves the cursor at once').toBe(1);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.p1).toBe(15);
  });

  it('moves on the die a finger lands on', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(7));
    choosing(game, 'p1', 10, [1, 5]);
    const input = new ScriptedInput();
    input.point('p1', dieBoxX(0) + DIE_SIZE / 2, DIE_Y + DIE_SIZE / 2);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.p1).toBe(11);
  });

  it('reads a tap on the board as "take me there"', () => {
    // The two landings are the only two places the token can go, so the nearer one is what
    // the finger meant. Making a player hit a die exactly turns the decision into aiming.
    const game = new SnakesandLaddersGame();
    game.init(makeContext(8));
    choosing(game, 'p1', 10, [1, 5]);
    const target = tokenCentre('p1', 15);
    const input = new ScriptedInput();
    input.point('p1', target.x, target.y);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.p1).toBe(15);
  });

  it('answers a tap off the edge of the board rather than swallowing it', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(9));
    choosing(game, 'p1', 10, [1, 5]);
    const input = new ScriptedInput();
    input.point('p1', -400, -400);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.phase, 'the turn moved on').not.toBe('choosing');
  });

  it('never acts for the seat that is not to move', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(10));
    const input = new ScriptedInput();
    input.press('p2');
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.position.phase).toBe('rolling');
    expect(game.position.seat).toBe('p1');
  });

  it('holds a snake or a ladder on screen longer than a plain move', () => {
    // A slide nobody saw looks like a bad die, and a board that turns round the instant a
    // key goes down looks like the game skipped a turn.
    const plain = new SnakesandLaddersGame();
    plain.init(makeContext(11));
    choosing(plain, 'p1', 10, [1, 1]);
    const climb = new SnakesandLaddersGame();
    climb.init(makeContext(11));
    choosing(climb, 'p1', 1, [2, 2]);

    const input = new ScriptedInput();
    input.press('p1');
    plain.update(STEP, input);
    climb.update(STEP, input);
    expect(plain.position.lastKind).toBe('none');
    expect(climb.position.lastKind).toBe('ladder');

    input.release('p1');
    for (let i = 0; i < 24; i += 1) {
      plain.update(STEP, input);
      climb.update(STEP, input);
    }
    expect(plain.position.seat, 'a plain move has already changed hands').toBe('p2');
    expect(climb.position.seat, 'the climb is still being shown').toBe('p1');

    for (let i = 0; i < 24; i += 1) climb.update(STEP, input);
    expect(climb.position.seat).toBe('p2');
  });

  it('says whose turn it is at every moment', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(12, 'normal', 'normal'));
    const seen = new Set<SeatId>();
    const input = new ScriptedInput();
    for (let i = 0; i < 1200 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
      seen.add(game.getActiveSeat());
    }
    expect([...seen].sort()).toEqual(['p1', 'p2']);
  });
});

describe('the match', () => {
  it('starts with both tokens at the start', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(13));
    expect(game.getScore()).toEqual({ p1: START, p2: START, winner: null });
  });

  it('reports the field each seat stands on', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(14));
    game.position.p1 = 21;
    game.position.p2 = 8;
    expect(game.getScore().p1).toBe(21);
    expect(game.getScore().p2).toBe(8);
  });

  it('plays a whole bot match to a winner', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(15, 'hard', 'easy'));
    playOut(game, 60 * 600);
    expect(game.getScore().winner).not.toBeNull();
  });

  it('finishes with two easy bots, which is the pairing that stalls', () => {
    // The same claim the shell's own termination guard makes, kept here as well so a change
    // to this game fails in this game's tests rather than in somebody else's.
    for (let seed = 1; seed <= 6; seed += 1) {
      const game = new SnakesandLaddersGame();
      game.init(makeContext(seed * 101, 'easy', 'easy'));
      playOut(game, 60 * 600);
      expect(game.getScore().winner, `seed ${String(seed)}`).not.toBeNull();
      game.destroy();
    }
  });

  it('stops changing once it is decided', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(16, 'hard', 'easy'));
    playOut(game, 60 * 600);
    const frozen = JSON.stringify(game.getScore());
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(JSON.stringify(game.getScore())).toBe(frozen);
  });

  it('holds the win on screen before reporting it', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(17));
    choosing(game, 'p1', FIELDS - 1, [6, 6]);
    const input = new ScriptedInput();
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.phase).toBe('over');
    expect(game.getScore().winner, 'not yet').toBeNull();
    input.release('p1');
    for (let i = 0; i < 70; i += 1) game.update(STEP, input);
    expect(game.getScore().winner).toBe('p1');
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new SnakesandLaddersGame();
      game.init(makeContext(18, 'normal', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 120; i += 1) {
        game.update(STEP, input);
        if (i % 60 === 0) out.push(`${String(game.getScore().p1)}:${String(game.getScore().p2)}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('steps the same match at 60, 90 and 120 Hz', () => {
    // Every delay in the game is a whole number of tenths, so each of them is a whole
    // number of steps at all three rates and the match is the same match on all three.
    const after = (hz: number, seconds: number): string => {
      const game = new SnakesandLaddersGame();
      game.init(makeContext(19, 'hard', 'normal'));
      const input = new ScriptedInput();
      for (let i = 0; i < hz * seconds; i += 1) game.update(1 / hz, input);
      const score = game.getScore();
      return `${String(score.p1)}:${String(score.p2)}:${game.position.phase}`;
    };
    expect(after(90, 20)).toBe(after(60, 20));
    expect(after(120, 20)).toBe(after(60, 20));
  });

  it('plays a different match on easy than on hard, from the same seed', () => {
    // The shell's bot-parity guard hashes the draw calls; this asks the same question of
    // the position, and inside the twenty-five seconds that guard allows.
    const trace = (difficulty: BotDifficulty): string => {
      const game = new SnakesandLaddersGame();
      game.init(makeContext(20260823, difficulty, difficulty));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 25; i += 1) {
        game.update(STEP, input);
        if (i % 15 === 0) out.push(`${String(game.position.p1)}:${String(game.position.p2)}`);
      }
      return out.join('|');
    };
    expect(trace('hard')).not.toBe(trace('easy'));
  });

  it('plays a different match with a bot than with nobody', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(21, 'normal', 'normal'));
    playOut(game, 600);
    const withBots = JSON.stringify(game.getScore());

    const empty = new SnakesandLaddersGame();
    empty.init(makeContext(21));
    playOut(empty, 600);
    expect(JSON.stringify(empty.getScore())).not.toBe(withBots);
  });

  it('starts fresh on init and clears on destroy', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(22, 'easy', 'easy'));
    playOut(game, 60 * 200);
    game.init(makeContext(22, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: START, p2: START, winner: null });
    expect(game.position.p1Bitten).toBe(0);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: START, p2: START, winner: null });
  });

  it('survives pause and resume mid-turn', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(23, 'normal', 'normal'));
    playOut(game, 200);
    const before = JSON.stringify(game.getScore());
    game.onPause();
    game.onResume();
    expect(JSON.stringify(game.getScore())).toBe(before);
    playOut(game, 60 * 400);
    expect(game.getScore().winner).not.toBeNull();
  });
});

describe('rendering', () => {
  it('draws every field, both tokens and both dice', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(24));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const cells = renderer.calls.filter((call) => call.op === 'rect').length;
    expect(cells, 'sixty-four squares and a bar for seat two').toBeGreaterThanOrEqual(FIELDS + 1);
    const numbers = renderer.calls.filter(
      (call) => call.op === 'text' && call.args[5] === 'left',
    ).length;
    expect(numbers, 'every field is numbered').toBe(FIELDS);
  });

  it('draws every ladder as rails with rungs and every snake as a body with a head', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(25));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const ladderLines = renderer.calls.filter(
      (call) => call.op === 'line' && call.args[5] === '#2f7d4f',
    ).length;
    // Two rails, four rungs and a two-line chevron for each ladder.
    expect(ladderLines).toBe(LADDERS.length * 8);
    const snakeLines = renderer.calls.filter(
      (call) => call.op === 'line' && call.args[5] === '#a83c25',
    ).length;
    expect(snakeLines).toBe(SNAKES.length * 10);
    const heads = renderer.calls.filter(
      (call) => call.op === 'circle' && call.args[2] === 15 && call.args[3] === '#a83c25',
    ).length;
    expect(heads, 'one head per snake').toBe(SNAKES.length);
  });

  it('labels every jump with the field it leads to', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(26));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    for (const jump of [...LADDERS, ...SNAKES]) {
      expect(renderer.args, `where ${String(jump.from)} goes`).toContain(String(jump.to));
    }
  });

  it('shows both places this roll could put you', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(27));
    choosing(game, 'p1', 10, [1, 5]);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const ghosts = renderer.calls.filter(
      (call) => call.op === 'strokeCircle' && call.args[2] === TOKEN_RADIUS + 6,
    );
    expect(ghosts, 'one ring per die').toHaveLength(DICE);
    const one = tokenCentre('p1', 11);
    const two = tokenCentre('p1', 15);
    expect(ghosts.map((call) => call.args[0]).sort()).toEqual([one.x, two.x].sort());
  });

  it('draws the far end of a ladder as well as the foot it starts from', () => {
    const ladder = LADDERS[0];
    const game = new SnakesandLaddersGame();
    game.init(makeContext(28));
    choosing(game, 'p1', (ladder?.from ?? 3) - 1, [1, 1]);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const arrival = tokenCentre('p1', ladder?.to ?? 19);
    const marked = renderer.calls.some(
      (call) =>
        call.op === 'strokeCircle' && call.args[0] === arrival.x && call.args[1] === arrival.y,
    );
    expect(marked, 'the climb is shown before it is taken').toBe(true);
  });

  it('rings the die the action key would use', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(29));
    choosing(game, 'p1', 10, [1, 5]);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const chosen = renderer.calls.filter(
      (call) => call.op === 'strokeRect' && call.args[5] === SEAT_PALETTE.p1.base,
    );
    expect(chosen, 'exactly one die is armed').toHaveLength(1);
    expect(chosen[0]?.args[0]).toBe(dieBoxX(0) - 6);
  });

  it('draws the die faces as pips once they are rolled', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(30));
    const before = new RecordingRenderer();
    game.render(before);
    expect(before.args, 'a prompt while there is nothing to show').toContain('?');

    choosing(game, 'p1', 10, [5, 2]);
    const after = new RecordingRenderer();
    game.render(after);
    const pipsOn = (index: number): number =>
      after.calls.filter(
        (call) =>
          call.op === 'circle' &&
          call.args[3] === '#151a26' &&
          typeof call.args[0] === 'number' &&
          call.args[0] >= dieBoxX(index) &&
          call.args[0] <= dieBoxX(index) + DIE_SIZE,
      ).length;
    expect(pipsOn(0), 'five pips').toBe(5);
    expect(pipsOn(1), 'two pips').toBe(2);
  });

  it('rings the token of whoever is to move', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(31));
    const first = new RecordingRenderer();
    game.render(first);
    const ringed = (renderer: RecordingRenderer): DrawArg[] =>
      renderer.calls
        .filter((call) => call.op === 'strokeCircle' && call.args[2] === TOKEN_RADIUS + 7)
        .map((call) => call.args[0]);
    expect(ringed(first)).toEqual([tokenCentre('p1', START).x]);

    game.position.seat = 'p2';
    const second = new RecordingRenderer();
    game.render(second);
    expect(ringed(second)).toEqual([tokenCentre('p2', START).x]);
  });

  it('tells the two seats apart without the colour', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(32));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const rings = renderer.calls.filter(
      (call) => call.op === 'strokeCircle' && call.args[4] === SEAT_PALETTE.p1.deep,
    ).length;
    const bars = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[4] === SEAT_PALETTE.p2.deep,
    ).length;
    expect(rings, 'a ring for seat one').toBeGreaterThanOrEqual(1);
    expect(bars, 'a bar for seat two').toBeGreaterThanOrEqual(1);
  });

  it('marks a snake that has already eaten, per seat and in that seat shape', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(33));
    const clean = new RecordingRenderer();
    game.render(clean);
    const spentRings = (renderer: RecordingRenderer): number =>
      renderer.calls.filter((call) => call.op === 'strokeCircle' && call.args[2] === 9).length;
    const spentBars = (renderer: RecordingRenderer): number =>
      renderer.calls.filter(
        (call) => call.op === 'rect' && call.args[2] === 18 && call.args[3] === 8,
      ).length;
    expect(spentRings(clean)).toBe(0);
    expect(spentBars(clean)).toBe(0);

    game.position.p1Bitten = 1 << snakeAt(SNAKES[0]?.from ?? 21);
    game.position.p2Bitten = 1 << snakeAt(SNAKES[1]?.from ?? 30);
    const marked = new RecordingRenderer();
    game.render(marked);
    expect(spentRings(marked), 'seat one has been down one snake').toBe(1);
    expect(spentBars(marked), 'seat two has been down another').toBe(1);
  });

  it('names what just happened in the status line', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(34));
    const input = new ScriptedInput();

    const idle = new RecordingRenderer();
    game.render(idle);
    expect(idle.args).toContain('Roll two dice');

    choosing(game, 'p1', 10, [1, 5]);
    const picking = new RecordingRenderer();
    game.render(picking);
    expect(picking.args).toContain('Pick a die');

    choosing(game, 'p1', 19, [2, 2]);
    input.press('p1');
    game.update(STEP, input);
    const bitten = new RecordingRenderer();
    game.render(bitten);
    expect(bitten.args).toContain('Snake down to 6');
  });

  it('turns the board to face whoever is playing', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(35));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops).toContain('pushRotation');
    expect(renderer.ops).toContain('popSeatRotation');
  });

  it('draws nothing outside the logical box', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(36, 'normal', 'normal'));
    playOut(game, 900);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    for (const call of renderer.calls) {
      if (call.op === 'text') continue;
      for (const value of call.args) {
        if (typeof value !== 'number') continue;
        expect(Number.isFinite(value)).toBe(true);
        expect(value, `${call.op} drew at ${String(value)}`).toBeGreaterThan(-60);
        expect(value, `${call.op} drew at ${String(value)}`).toBeLessThan(BOARD + 60);
      }
    }
  });

  it('does not mutate the position', () => {
    const game = new SnakesandLaddersGame();
    game.init(makeContext(37, 'normal', 'normal'));
    playOut(game, 900);
    const before = JSON.stringify(game.position);
    game.render(new RecordingRenderer());
    game.render(new RecordingRenderer());
    expect(JSON.stringify(game.position)).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('snakes-ladders');
    expect(manifest.archetype).toBe('turn-board');
    expect(manifest.zoneSplit).toBe('shared-board');
    expect(manifest.modes).toEqual(['friend', 'bot']);
    expect(manifest.logical.width).toBe(BOARD);
    expect(manifest.logical.height).toBe(BOARD);
  });

  it('promises the keys the code actually reads', () => {
    // Control strings that lie are the recurring bug in this repository, so each claim in
    // the string is named here and proved by a test above: A and D steer the cursor, the
    // action key rolls and then moves, and the two seats have their own halves.
    const { keyboard } = manifest.controls;
    expect(keyboard).toContain('A and D');
    expect(keyboard).toContain('Space');
    expect(keyboard).toContain('arrow keys');
    expect(keyboard).toContain('Enter');
    expect(keyboard).toMatch(/player one/i);
    expect(keyboard).toMatch(/player two/i);
    expect(keyboard.length).toBeLessThanOrEqual(120);
  });

  it('promises the pointer idiom the code actually offers', () => {
    const { pointer } = manifest.controls;
    expect(pointer).toContain('Tap to roll');
    expect(pointer).toMatch(/square you want to move to/i);
    expect(pointer).toMatch(/die/i);
    expect(pointer.length).toBeLessThanOrEqual(120);
  });
});
