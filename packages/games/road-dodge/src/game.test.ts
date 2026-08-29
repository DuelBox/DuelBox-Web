import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  LANE_WIDTH,
  ROAD_HEIGHT,
  ROAD_TOP,
  ROAD_WIDTH,
  RoadDodgeGame,
  roadLeft,
  trackToScreenY,
} from './game.js';
import { CAR_Y, LANES, TRACK_LENGTH } from './rules.js';
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

  /** Direction keys, as the engine reports them: components in [-1, 1]. */
  steer(seat: SeatId, x: number): void {
    this.#of(seat).move.x = x;
  }

  tap(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = true;
    target.actionHeld = true;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = false;
    target.actionHeld = false;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
  presentation: 'shared-screen' | 'single-seat' = 'shared-screen',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

type DrawArg = number | string | boolean | undefined;

/** Logs every call and every argument, so no draw can pass unobserved. */
class RecordingRenderer implements Renderer {
  readonly ops: string[] = [];
  readonly args: DrawArg[] = [];

  clear(colour: string): void {
    this.#record('clear', colour);
  }

  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#record('rect', x, y, width, height, colour);
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#record('strokeRect', x, y, width, height, lineWidth, colour);
  }

  circle(x: number, y: number, radius: number, colour: string): void {
    this.#record('circle', x, y, radius, colour);
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#record('strokeCircle', x, y, radius, lineWidth, colour);
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.#record('line', x1, y1, x2, y2, lineWidth, colour);
  }

  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    this.#record('text', value, x, y, sizePx, colour, align);
  }

  pushSeatRotation(rotated: boolean): void {
    this.#record('pushSeatRotation', rotated);
  }

  pushRotation(radians: number): void {
    this.pushSeatRotation(radians !== 0);
  }

  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  #record(op: string, ...values: DrawArg[]): void {
    this.ops.push(op);
    for (const value of values) this.args.push(value);
  }
}

/** How many arguments each recorded op contributes, so args can be walked per call. */
const ARG_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  clear: 1,
  rect: 5,
  strokeRect: 6,
  circle: 4,
  strokeCircle: 5,
  line: 6,
  text: 6,
  pushSeatRotation: 1,
  popSeatRotation: 0,
});

/** Centre of a lane on a seat's road, in logical units. */
function laneCentreX(seat: SeatId, lane: number): number {
  return roadLeft(seat) + (lane + 0.5) * LANE_WIDTH;
}

describe('the two roads', () => {
  it('fit side by side inside the logical play area without overlapping', () => {
    const p1Left = roadLeft('p1');
    const p2Left = roadLeft('p2');
    expect(p1Left).toBeGreaterThan(0);
    expect(p1Left + ROAD_WIDTH, 'p1 must end before p2 begins').toBeLessThanOrEqual(p2Left);
    expect(p2Left + ROAD_WIDTH).toBeLessThanOrEqual(manifest.logical.width);
    expect(ROAD_TOP + ROAD_HEIGHT).toBeLessThanOrEqual(manifest.logical.height);
  });

  it('give both seats exactly the same road', () => {
    // Rule 9 in miniature: neither seat may see more of the play area than the other.
    expect(roadLeft('p1') - 0).toBeGreaterThan(0);
    expect(manifest.logical.width - (roadLeft('p2') + ROAD_WIDTH)).toBe(roadLeft('p1'));
  });

  it('maps the track onto the road and reverses it for the opposite seat', () => {
    expect(trackToScreenY(0, false)).toBe(ROAD_TOP);
    expect(trackToScreenY(TRACK_LENGTH, false)).toBe(ROAD_TOP + ROAD_HEIGHT);
    // Flipped, the same track point lands the same distance from the other end, so the
    // seat opposite watches its traffic come towards it rather than away.
    expect(trackToScreenY(0, true)).toBe(ROAD_TOP + ROAD_HEIGHT);
    expect(trackToScreenY(TRACK_LENGTH, true)).toBe(ROAD_TOP);
    expect(trackToScreenY(CAR_Y, false) + trackToScreenY(CAR_Y, true)).toBeCloseTo(
      ROAD_TOP * 2 + ROAD_HEIGHT,
      6,
    );
  });
});

describe('steering', () => {
  it('changes one lane per press rather than one per step', () => {
    // A held key sliding the car across the road would be exactly the advantage over a
    // touchscreen that makes this archetype same-input-class only.
    const game = new RoadDodgeGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    const start = game.seat('p1').lane;

    input.steer('p1', 1);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.seat('p1').lane, 'thirty steps of a held key is still one lane').toBe(start + 1);

    // Back the other way, so the assertion is about the press and not about the edge of
    // a three-lane road clamping the answer for us.
    input.steer('p1', 0);
    game.update(STEP, input);
    input.steer('p1', -1);
    game.update(STEP, input);
    expect(game.seat('p1').lane, 'releasing and pressing again moves again').toBe(start);

    input.steer('p1', 0);
    game.update(STEP, input);
    input.steer('p1', -1);
    game.update(STEP, input);
    expect(game.seat('p1').lane, 'and again').toBe(start - 1);
  });

  it('never steers off the road', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    input.steer('p1', -1);
    for (let i = 0; i < 40; i += 1) {
      input.steer('p1', 0);
      game.update(STEP, input);
      input.steer('p1', -1);
      game.update(STEP, input);
      expect(game.seat('p1').lane).toBeGreaterThanOrEqual(0);
    }
    expect(game.seat('p1').lane).toBe(0);
  });

  it('sends a tap on a lane to that lane', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    expect(game.seat('p1').lane).toBe(1);

    input.tap('p1', laneCentreX('p1', 0), 500);
    game.update(STEP, input);
    expect(game.seat('p1').lane, 'a tap on the left lane moves left').toBe(0);
  });

  it('does not re-fire while a finger is held on the same lane', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(9));
    const input = new ScriptedInput();
    input.tap('p1', laneCentreX('p1', 2), 500);
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.seat('p1').lane, 'held on lane 2, the car stops at lane 2').toBe(2);
  });

  it('ignores a tap on the other seat road', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    const before = game.seat('p1').lane;
    input.tap('p1', laneCentreX('p2', 0), 500);
    game.update(STEP, input);
    expect(game.seat('p1').lane, "p1's finger on p2's road does nothing").toBe(before);
  });

  it('mirrors the opposite seat controls so its keys mean what it sees', () => {
    // The seat reading the device upside down has left and right reversed. Pressing the
    // key on your right must move the car to the lane on your right, both ways up.
    const game = new RoadDodgeGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    const start = game.seat('p2').lane;
    input.steer('p2', 1);
    game.update(STEP, input);
    expect(game.seat('p2').lane, 'the rotated seat steers the other way').toBe(start - 1);
  });

  it('does not mirror the opposite seat in single-seat play', () => {
    // Alone on their own device nothing is rotated, so nothing may be mirrored either.
    const game = new RoadDodgeGame();
    game.init(makeContext(13, null, null, 'single-seat'));
    const input = new ScriptedInput();
    const start = game.seat('p2').lane;
    input.steer('p2', 1);
    game.update(STEP, input);
    expect(game.seat('p2').lane).toBe(start + 1);
  });

  it('does not steer again for a key that was already held when the game paused', () => {
    // The first version of this cleared the held axis on resume, which read the still-down
    // key as brand new: a player who paused mid-press came back to find the car had
    // already changed lane on its own.
    const game = new RoadDodgeGame();
    game.init(makeContext(15));
    const input = new ScriptedInput();

    // Move right then settle on a left press, so neither assertion sits on a road edge.
    input.steer('p1', 1);
    game.update(STEP, input);
    input.steer('p1', 0);
    game.update(STEP, input);
    input.steer('p1', -1);
    game.update(STEP, input);
    const held = game.seat('p1').lane;

    game.onPause();
    game.onResume();
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.seat('p1').lane, 'the same key, still down, must not steer again').toBe(held);

    // Releasing and pressing afresh still works, so resume did not deafen the controls.
    input.steer('p1', 0);
    game.update(STEP, input);
    input.steer('p1', -1);
    game.update(STEP, input);
    expect(game.seat('p1').lane, 'a genuinely new press is still heard').toBe(held - 1);
  });

  it('notices a key released while the game was paused', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(17));
    const input = new ScriptedInput();
    input.steer('p1', 1);
    game.update(STEP, input);
    const before = game.seat('p1').lane;

    game.onPause();
    input.steer('p1', 0);
    game.onResume();
    game.update(STEP, input);
    input.steer('p1', -1);
    game.update(STEP, input);
    expect(game.seat('p1').lane, 'the press after the release must land').toBe(before - 1);
  });
});

describe('the match', () => {
  it('reports obstacles cleared as the score', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(21, 'hard', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 12; i += 1) game.update(STEP, input);
    const score = game.getScore();
    expect(score.p1, 'a hard bot clears obstacles').toBeGreaterThan(0);
    expect(score.p1).toBe(game.seat('p1').passed);
    expect(score.p2).toBe(game.seat('p2').passed);
  });

  it('is undecided while both are still driving', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(23, 'hard', 'hard'));
    const input = new ScriptedInput();
    game.update(STEP, input);
    expect(game.getScore().winner).toBeNull();
  });

  it('ends when one seat crashes, and the survivor wins', () => {
    // p1 drives, p2 sits still and is hit.
    const game = new RoadDodgeGame();
    game.init(makeContext(29, 'hard', null));
    const input = new ScriptedInput();
    let winner: SeatId | 'draw' | null = null;
    for (let i = 0; i < 60 * 240 && winner === null; i += 1) {
      game.update(STEP, input);
      winner = game.getScore().winner;
    }
    expect(winner, 'an idle seat must eventually crash').toBe('p1');
    expect(game.seat('p2').crashed).toBe(true);
  });

  it('stops simulating once decided', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(29, 'hard', null));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 240 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
    const frozen = game.seat('p1').passed;
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.seat('p1').passed, 'a decided match must not keep scoring').toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new RoadDodgeGame();
      game.init(makeContext(31, 'normal', 'easy'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 40; i += 1) {
        game.update(STEP, input);
        out.push(`${String(game.seat('p1').lane)}${String(game.seat('p2').lane)}`);
      }
      return out.join('');
    };
    expect(trace()).toBe(trace());
  });

  it('starts a fresh match on init rather than carrying the last one', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(33, 'easy', null));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 60; i += 1) game.update(STEP, input);
    expect(game.seat('p1').passed).toBeGreaterThan(0);

    game.init(makeContext(33, 'easy', null));
    expect(game.seat('p1').passed, 'a rematch starts at zero').toBe(0);
    expect(game.seat('p1').crashed).toBe(false);
    expect(game.getScore().winner).toBeNull();
  });

  it('clears every seat on destroy', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(35, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    game.destroy();
    expect(game.seat('p1').passed).toBe(0);
    expect(game.seat('p2').passed).toBe(0);
    expect(game.getScore().winner).toBeNull();
    // Updating a destroyed game must be inert rather than throwing.
    game.update(STEP, input);
    expect(game.getScore().p1).toBe(0);
  });
});

describe('the bot', () => {
  it('never touches the human seat', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(41, null, 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 300; i += 1) game.update(STEP, input);
    expect(game.seat('p1').lane, 'an untouched human car stays where it was put').toBe(1);
  });

  it('outlasts a seat that never moves', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(43, 'hard', null));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 240 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).toBe('p1');
  });
});

describe('rendering', () => {
  it('draws both roads and both cars', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(51));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops[0]).toBe('clear');
    expect(renderer.ops.filter((op) => op === 'rect').length).toBeGreaterThan(2);
    // Each seat's own colour appears, so a player can find their own car.
    expect(renderer.args).toContain(SEAT_PALETTE.p1.base);
    expect(renderer.args).toContain(SEAT_PALETTE.p2.base);
  });

  it('draws nothing outside the logical play area', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(53, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    for (const value of renderer.args) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value), 'every coordinate must be finite').toBe(true);
      expect(value).toBeGreaterThan(-200);
      expect(value).toBeLessThan(manifest.logical.height + 200);
    }
  });

  it('interpolates between steps rather than snapping', () => {
    // Obstacles cover about fifteen logical units a step at full speed, so drawing the
    // same position for every frame of a 120Hz screen visibly stutters.
    const game = new RoadDodgeGame();
    game.init(makeContext(59, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);

    const at = (alpha: number): DrawArg[] => {
      const renderer = new RecordingRenderer();
      game.render(renderer, alpha);
      return renderer.args;
    };
    const start = at(0);
    const end = at(1);
    const differences = start.filter((value, i) => value !== end[i]).length;
    expect(differences, 'alpha 0 and alpha 1 must not draw the same frame').toBeGreaterThan(0);
  });

  it('scrolls the road so it reads as moving', () => {
    // The dashes were static in the first version: obstacles streamed past a road that
    // stood still, which reads as a broken renderer rather than a fast car.
    const game = new RoadDodgeGame();
    game.init(makeContext(61, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 300; i += 1) game.update(STEP, input);

    const dashes = (): number[] => {
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      const out: number[] = [];
      let cursor = 0;
      for (const op of renderer.ops) {
        if (op === 'line') {
          const y1 = renderer.args[cursor + 1];
          if (typeof y1 === 'number') out.push(y1);
        }
        cursor += ARG_COUNTS[op] ?? 0;
      }
      return out;
    };
    const before = dashes();
    for (let i = 0; i < 5; i += 1) game.update(STEP, input);
    const after = dashes();
    expect(before.length, 'the road must draw dashes at all').toBeGreaterThan(4);
    expect(after.join(','), 'five steps on, the road has moved').not.toBe(before.join(','));
  });

  it('does not mutate the simulation', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(55, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 300; i += 1) game.update(STEP, input);
    const before = `${String(game.seat('p1').lane)}:${String(game.seat('p1').passed)}`;
    game.render(new RecordingRenderer(), 0);
    game.render(new RecordingRenderer(), 0.5);
    expect(`${String(game.seat('p1').lane)}:${String(game.seat('p1').passed)}`).toBe(before);
  });

  it('marks a crash so a player can see why they stopped', () => {
    const game = new RoadDodgeGame();
    game.init(makeContext(57, 'hard', null));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 240 && !game.seat('p2').crashed; i += 1) game.update(STEP, input);
    expect(game.seat('p2').crashed).toBe(true);
    const before = new RecordingRenderer();
    game.render(before, 0);

    // Rule 7: a wreck is marked by a cross, not by a colour. A red flash was the first
    // version and it was invisible on p1, whose own base colour is #ff5a4e.
    expect(before.args, 'the wreck marker must not be a seat colour').toContain('#f2f5fb');
    expect(before.args).not.toContain('#ff5a5a');

    // And it is a shape: two lines the intact car does not draw.
    const fresh = new RoadDodgeGame();
    fresh.init(makeContext(57, 'hard', null));
    const intact = new RecordingRenderer();
    fresh.render(intact, 0);
    const linesWhenWrecked = before.ops.filter((op) => op === 'line').length;
    const linesWhenIntact = intact.ops.filter((op) => op === 'line').length;
    expect(linesWhenWrecked, 'a wrecked car draws strokes an intact one does not').toBeGreaterThan(
      linesWhenIntact,
    );
  });
});

describe('the manifest', () => {
  it('declares the archetype it is', () => {
    expect(manifest.archetype).toBe('rt-race');
    expect(manifest.id).toBe('road-dodge');
  });

  it('declares itself same-input-class only', () => {
    // docs/input-parity.md rules rt-race genuinely unfair across input families: the
    // interaction is rapid discrete input, which is what a key is for and a touchscreen
    // is worst at. Shipping it cross-device would ship a match one player cannot win.
    expect(manifest.sameInputClassOnly).toBe(true);
  });

  it('has room on the board for every lane', () => {
    expect(LANE_WIDTH * LANES).toBeCloseTo(ROAD_WIDTH, 6);
  });
});
