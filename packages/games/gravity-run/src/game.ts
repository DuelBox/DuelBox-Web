import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BLOCK_REACH,
  CEILING,
  CELL_LENGTH,
  CLEAR,
  COURSE_HEIGHT,
  COURSE_WIDTH,
  FLIP,
  FLOOR,
  HOLD,
  RACE_CELLS,
  RACE_DISTANCE,
  RISE,
  RUNNER_RADIUS,
  STREAK_FULL,
  STUMBLE_SECONDS,
  VISIBLE_CELLS,
  blockAt,
  botAsk,
  cellsOf,
  clearMatch,
  createBotState,
  createMatch,
  resetBotState,
  resetMatch,
  stepMatch,
  winnerOf,
} from './rules.js';
import type { Ask, BotDifficulty, BotState, Match, Runner } from './rules.js';

/**
 * Gravity Run — a lane each, and one thing to say to your runner: which way is down.
 *
 * The rules module holds the whole simulation. What lives here is how a person says
 * "that way" through it, and how two lanes are drawn one above the other.
 */

const COLOUR_NIGHT = '#070a12';
/** The near seat's lane is the lighter of the two, so which half is yours survives grey. */
const COLOUR_LANE_NEAR = '#1a2338';
const COLOUR_LANE_FAR = '#0d1424';
const COLOUR_SHELL = '#2f3c58';
const COLOUR_SHELL_EDGE = '#6d80a6';
const COLOUR_BLOCK = '#d8b26a';
const COLOUR_BLOCK_EDGE = '#8a6524';
const COLOUR_JOINT = 'rgba(120, 142, 186, 0.34)';
const COLOUR_DIVIDER = '#eef2fb';
const COLOUR_BONE = '#eef2fb';
const COLOUR_INK = '#070a12';
const COLOUR_TRACK = 'rgba(7, 10, 18, 0.68)';

/** Half the box, which is one seat's lane. */
const HALF_HEIGHT = COURSE_HEIGHT / 2;

/** Everything below is in the *near* seat's frame; {@link flipY} puts the far seat's in. */
const GROUND_Y = 966;
/** The lane a runner moves in, which is its own travel plus a body's worth either side. */
const CORRIDOR = RISE + RUNNER_RADIUS * 2;
const CEILING_Y = GROUND_Y - CORRIDOR;
/** The line a finger falls one side or the other of. */
const CORRIDOR_MIDDLE = GROUND_Y - CORRIDOR / 2;
const SHELL_THICKNESS = 22;

/** Where the runner sits in the window. The course scrolls past it. */
const RUNNER_X = 140;

const BAR_LEFT = 44;
const BAR_RIGHT = COURSE_WIDTH - 44;
const BAR_Y = 518;
const BAR_HEIGHT = 18;
const BAR_TICK_CELLS = 15;

/** How long a trail the runner drags at a standing start, and at full speed. */
const TRAIL_SLOW = 16;
const TRAIL_FAST = 92;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The far seat reads the device upside down, so its lane is the near seat's turned half a
 * turn about the centre of the box.
 *
 * Point symmetry rather than a mirror, and that is the whole of the seat handling: every
 * shape below is authored once in the near seat's frame and mapped through these. So each
 * player's floor is the edge of the box nearest them and each player's runner travels
 * towards their own right — neither the simulation nor the input mapping knows which
 * presentation is running, because the board is symmetric under the rotation.
 */
function flipX(seat: SeatId, x: number): number {
  return seat === 'p1' ? x : COURSE_WIDTH - x;
}

function flipY(seat: SeatId, y: number): number {
  return seat === 'p1' ? y : COURSE_HEIGHT - y;
}

function fillRect(
  renderer: Renderer,
  seat: SeatId,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: string,
): void {
  if (seat === 'p1') renderer.rect(x, y, width, height, colour);
  // A rect is anchored at its top-left, and half a turn moves that corner to the far
  // one — so the rotated origin is the *opposite* corner, not the mapped original.
  else renderer.rect(COURSE_WIDTH - x - width, COURSE_HEIGHT - y - height, width, height, colour);
}

function stroke(
  renderer: Renderer,
  seat: SeatId,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  colour: string,
): void {
  renderer.line(flipX(seat, x1), flipY(seat, y1), flipX(seat, x2), flipY(seat, y2), width, colour);
}

export class GravityRunGame implements Game {
  readonly #match: Match = createMatch();
  readonly #p1Bot: BotState = createBotState();
  readonly #p2Bot: BotState = createBotState();

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  /**
   * What each seat has asked for and not yet spent.
   *
   * A tap that lands during the flip cadence is *kept* rather than dropped, which matters
   * more than it sounds: without it a player has to press again at the exact moment the
   * lockout ends, and the game turns into one about timing a press rather than about
   * choosing a moment. Spent by the flip it releases, so one tap is one flip; a key or a
   * finger held down re-asks on every step and so keeps flipping at the cadence.
   */
  #p1Want: Ask = HOLD;
  #p2Want: Ask = HOLD;
  #winner: SeatId | 'draw' | null = null;

  /** Read-only view for the tests and the balance harness. Never mutate through it. */
  get match(): Match {
    return this.#match;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    this.#p1Want = HOLD;
    this.#p2Want = HOLD;
    resetBotState(this.#p1Bot);
    resetBotState(this.#p2Bot);
    resetMatch(this.#match, this.#rng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    const p1 = this.#wantOf('p1', input, fixedDeltaSeconds);
    const p2 = this.#wantOf('p2', input, fixedDeltaSeconds);
    const strode = stepMatch(this.#match, fixedDeltaSeconds, p1, p2);

    // A latched ask is spent by the flip it released — and dropped outright by a fall,
    // because a runner is picked up on the surface its cell leaves open and a stale ask
    // would throw it straight back off. A bot never latches: it is asked afresh every
    // step, so clearing here costs it nothing.
    if (strode.p1 !== 'idle') this.#p1Want = HOLD;
    if (strode.p2 !== 'idle') this.#p2Want = HOLD;

    this.#winner = winnerOf(this.#match);
  }

  #wantOf(seat: SeatId, input: InputState, fixedDeltaSeconds: number): Ask {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      return botAsk(
        this.#match,
        seat,
        difficulty,
        seat === 'p1' ? this.#p1Bot : this.#p2Bot,
        fixedDeltaSeconds,
        this.#rng,
      );
    }

    const asked = this.#askedBy(seat, input);
    if (asked !== HOLD) {
      if (seat === 'p1') this.#p1Want = asked;
      else this.#p2Want = asked;
    }
    return seat === 'p1' ? this.#p1Want : this.#p2Want;
  }

  /**
   * What a person is asking for this step, or {@link HOLD} for nothing.
   *
   * **A finger names a surface rather than toggling.** There are only two of them, both
   * are directly under the player's own thumb, and an absolute ask cannot be got out of
   * step with the runner — a toggle punishes the tap the game already registered, which is
   * the one mistake a player cannot see coming. It is read in the seat's own frame, so
   * each player's own half of their own lane is their floor: they are looking at the same
   * corridor from the other end of the room.
   *
   * Keys need no such mapping, which is the part worth noticing. `W` is seat one's up and
   * the up arrow is seat two's up whichever way up either of them is sitting, so the
   * keyboard path is the same three lines for both seats and cannot get the mirror wrong.
   * All five of a seat's keys act, because in a party game a hand lands where it lands:
   * up and down name a surface outright, and the other three flip to the other one — the
   * genre's own instruction, and what the action key has always meant.
   */
  #askedBy(seat: SeatId, input: InputState): Ask {
    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      const own = seat === 'p1' ? pointer.y : COURSE_HEIGHT - pointer.y;
      return own > CORRIDOR_MIDDLE ? FLOOR : CEILING;
    }
    const move = seatInput.move;
    if (move.y < 0) return CEILING;
    if (move.y > 0) return FLOOR;
    if (move.x !== 0 || seatInput.actionHeld || seatInput.actionPressed) return FLIP;
    return HOLD;
  }

  getActiveSeat(): SeatId | null {
    // Never: both runners are live at once, so the shell keeps a pointer zone for each seat.
    return null;
  }

  getScore(): MatchScore {
    return {
      p1: cellsOf(this.#match, 'p1'),
      p2: cellsOf(this.#match, 'p2'),
      winner: this.#winner,
    };
  }

  /**
   * A key held across a pause must not flip on the way back in.
   *
   * The engine drops its own keys and pointers on a pause, but the latch above is ours and
   * it survives one, so a player who paused with a finger down would return to a runner
   * already falling the other way.
   */
  onPause(): void {
    this.#p1Want = HOLD;
    this.#p2Want = HOLD;
  }

  onResume(): void {
    this.#p1Want = HOLD;
    this.#p2Want = HOLD;
  }

  destroy(): void {
    this.#botP1 = null;
    this.#botP2 = null;
    this.#p1Want = HOLD;
    this.#p2Want = HOLD;
    this.#winner = null;
    resetBotState(this.#p1Bot);
    resetBotState(this.#p2Bot);
    clearMatch(this.#match);
  }

  /**
   * Draws the state as it stands.
   *
   * The interpolation alpha the contract offers is deliberately not read. Every moving
   * thing here — the runner's height, its distance along the course — is already a
   * continuous value the simulation carries at full resolution, so a frame is the state
   * as it stands rather than a guess between two of them.
   */
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_NIGHT);
    this.#drawLane(renderer, 'p1');
    this.#drawLane(renderer, 'p2');
    // The line between the two lanes. Both seats' floor is at their own outer edge, so
    // without it the middle of the screen reads as one very tall ceiling.
    renderer.rect(0, HALF_HEIGHT - 2, COURSE_WIDTH, 4, COLOUR_DIVIDER);
  }

  #drawLane(renderer: Renderer, seat: SeatId): void {
    const runner = seat === 'p1' ? this.#match.p1 : this.#match.p2;
    fillRect(
      renderer,
      seat,
      0,
      HALF_HEIGHT,
      COURSE_WIDTH,
      HALF_HEIGHT,
      seat === 'p1' ? COLOUR_LANE_NEAR : COLOUR_LANE_FAR,
    );

    // The two walls the runner is thrown between.
    fillRect(renderer, seat, 0, GROUND_Y, COURSE_WIDTH, COURSE_HEIGHT - GROUND_Y, COLOUR_SHELL);
    fillRect(
      renderer,
      seat,
      0,
      CEILING_Y - SHELL_THICKNESS,
      COURSE_WIDTH,
      SHELL_THICKNESS,
      COLOUR_SHELL,
    );
    stroke(renderer, seat, 0, GROUND_Y, COURSE_WIDTH, GROUND_Y, 3, COLOUR_SHELL_EDGE);
    stroke(renderer, seat, 0, CEILING_Y, COURSE_WIDTH, CEILING_Y, 3, COLOUR_SHELL_EDGE);

    this.#drawCourse(renderer, seat, runner);
    this.#drawRunner(renderer, seat, runner);
    this.#drawTally(renderer, seat, runner);
  }

  /**
   * The stretch of course inside this seat's window.
   *
   * Every cell is placed from the runner's own distance, so the course slides continuously
   * rather than stepping a cell at a time — and the window is the same width for both
   * seats, so neither ever sees more of what is coming than the other (rule 9).
   */
  #drawCourse(renderer: Renderer, seat: SeatId, runner: Readonly<Runner>): void {
    const first = runner.cell - 1;
    for (let index = first; index <= runner.cell + VISIBLE_CELLS + 1; index += 1) {
      const x = RUNNER_X + (index * CELL_LENGTH - runner.distance);
      const left = x < 0 ? 0 : x;
      const right = Math.min(x + CELL_LENGTH, COURSE_WIDTH);
      if (right <= left) continue;

      // A joint at every cell edge, so the course reads as a run of cells and the size of
      // one cell is legible without motion.
      if (x >= 0 && x <= COURSE_WIDTH) {
        stroke(renderer, seat, x, CEILING_Y, x, GROUND_Y, 1.5, COLOUR_JOINT);
      }

      const block = blockAt(this.#match.course, index);
      if (block === CLEAR) continue;
      const top = block === FLOOR ? GROUND_Y - BLOCK_REACH : CEILING_Y;
      fillRect(renderer, seat, left, top, right - left, BLOCK_REACH, COLOUR_BLOCK);
      fillRect(
        renderer,
        seat,
        left,
        block === FLOOR ? top : top + BLOCK_REACH - 7,
        right - left,
        7,
        COLOUR_BLOCK_EDGE,
      );
      // Teeth along the inner edge, so a block reads as a hazard in silhouette rather
      // than as a wall, and so the two kinds differ by which way the teeth point.
      const toothY = block === FLOOR ? top : top + BLOCK_REACH;
      for (let tooth = left + 10; tooth < right - 6; tooth += 20) {
        stroke(
          renderer,
          seat,
          tooth,
          toothY,
          tooth + 10,
          toothY + (block === FLOOR ? -14 : 14),
          4,
          COLOUR_BLOCK_EDGE,
        );
      }
    }

    this.#drawFinish(renderer, seat, runner);
  }

  /** The line, once it is in sight. Bars rather than a word, so it needs no language. */
  #drawFinish(renderer: Renderer, seat: SeatId, runner: Readonly<Runner>): void {
    const x = RUNNER_X + (RACE_DISTANCE - runner.distance);
    if (x < 8 || x > COURSE_WIDTH - 8) return;
    for (let i = 0; i < 8; i += 1) {
      const y = CEILING_Y + i * (CORRIDOR / 8);
      fillRect(renderer, seat, x - 6, y, 12, CORRIDOR / 16, i % 2 === 0 ? COLOUR_BONE : COLOUR_INK);
    }
  }

  /**
   * The runner, upright or flat.
   *
   * Rule 7: the near seat's is a disc with a solid core; the far seat's is a square with a
   * bar across it. Two runners in two lanes are rarely confused, but a screenshot in
   * greyscale still has to say which is which, and so does a player who cannot tell red
   * from blue.
   */
  #drawRunner(renderer: Renderer, seat: SeatId, runner: Readonly<Runner>): void {
    const palette = SEAT_PALETTE[seat];
    const centreY = GROUND_Y - RUNNER_RADIUS - runner.height;

    if (runner.down > 0) {
      this.#drawFallen(renderer, seat, runner, centreY, palette.deep);
      return;
    }

    // A trail whose length is the runner's speed. The only thing on screen that says how
    // fast you are going, and it says it in length rather than in colour.
    const trail = TRAIL_SLOW + (TRAIL_FAST - TRAIL_SLOW) * clamp01(runner.streak / STREAK_FULL);
    stroke(
      renderer,
      seat,
      RUNNER_X - trail,
      centreY,
      RUNNER_X - RUNNER_RADIUS,
      centreY,
      6,
      palette.soft,
    );

    if (seat === 'p1') {
      renderer.circle(flipX(seat, RUNNER_X), flipY(seat, centreY), RUNNER_RADIUS, palette.base);
      renderer.circle(flipX(seat, RUNNER_X), flipY(seat, centreY), RUNNER_RADIUS - 9, palette.deep);
    } else {
      fillRect(
        renderer,
        seat,
        RUNNER_X - RUNNER_RADIUS,
        centreY - RUNNER_RADIUS,
        RUNNER_RADIUS * 2,
        RUNNER_RADIUS * 2,
        palette.base,
      );
      fillRect(
        renderer,
        seat,
        RUNNER_X - RUNNER_RADIUS,
        centreY - 6,
        RUNNER_RADIUS * 2,
        12,
        palette.deep,
      );
    }

    // Which way is down, as an arrow on the runner's leading edge. A gravity game whose
    // gravity can only be inferred from watching the runner move is a game that has to be
    // played twice before it can be read once.
    const way = runner.pull === FLOOR ? 1 : -1;
    const tip = centreY + way * (RUNNER_RADIUS + 16);
    stroke(renderer, seat, RUNNER_X, centreY + way * RUNNER_RADIUS, RUNNER_X, tip, 4, COLOUR_BONE);
    stroke(renderer, seat, RUNNER_X - 9, tip - way * 9, RUNNER_X, tip, 4, COLOUR_BONE);
    stroke(renderer, seat, RUNNER_X + 9, tip - way * 9, RUNNER_X, tip, 4, COLOUR_BONE);
  }

  /**
   * Flattened, and how long there is left of it.
   *
   * The runner lies down, so being caught is legible in silhouette; the cross over it and
   * the bar beside it say the same thing twice more, in shape and in length rather than in
   * colour, because "you are out of this for a second" is the single most important thing
   * the screen ever has to tell a player.
   */
  #drawFallen(
    renderer: Renderer,
    seat: SeatId,
    runner: Readonly<Runner>,
    centreY: number,
    colour: string,
  ): void {
    fillRect(
      renderer,
      seat,
      RUNNER_X - RUNNER_RADIUS * 2,
      centreY - RUNNER_RADIUS / 2,
      RUNNER_RADIUS * 4,
      RUNNER_RADIUS,
      colour,
    );
    stroke(
      renderer,
      seat,
      RUNNER_X - 16,
      centreY - 16,
      RUNNER_X + 16,
      centreY + 16,
      5,
      COLOUR_BONE,
    );
    stroke(
      renderer,
      seat,
      RUNNER_X - 16,
      centreY + 16,
      RUNNER_X + 16,
      centreY - 16,
      5,
      COLOUR_BONE,
    );

    // The bar sits on the middle of the corridor rather than on the runner: a runner
    // caught against the ceiling has no room above it, and a recovery clock that moves
    // about is one a player has to find before they can read it.
    const recovered = clamp01(1 - runner.down / STUMBLE_SECONDS);
    fillRect(renderer, seat, RUNNER_X - 60, CORRIDOR_MIDDLE - 4, 120, 8, COLOUR_TRACK);
    fillRect(renderer, seat, RUNNER_X - 60, CORRIDOR_MIDDLE - 4, 120 * recovered, 8, COLOUR_BONE);
  }

  /**
   * How far along, as a bar across the seat's own end of the box.
   *
   * The shell's HUD prints both scores as numbers. What it cannot give a player mid-stride
   * is *how close the race is* without reading two of them, so each seat's bar fills from
   * its own outer edge and the ticks are every fifteen cells, which is what the eye counts.
   */
  #drawTally(renderer: Renderer, seat: SeatId, runner: Readonly<Runner>): void {
    const palette = SEAT_PALETTE[seat];
    const span = BAR_RIGHT - BAR_LEFT;
    const filled = span * clamp01(runner.distance / RACE_DISTANCE);

    fillRect(renderer, seat, BAR_LEFT, BAR_Y, span, BAR_HEIGHT, COLOUR_TRACK);
    fillRect(renderer, seat, BAR_LEFT, BAR_Y, filled, BAR_HEIGHT, palette.base);
    if (seat === 'p2') {
      // Hatched rather than solid — rule 7 again, so the two bars differ by pattern.
      for (let x = BAR_LEFT + 5; x < BAR_LEFT + filled; x += 11) {
        fillRect(renderer, seat, x, BAR_Y, 3, BAR_HEIGHT, COLOUR_INK);
      }
    }
    for (let cell = BAR_TICK_CELLS; cell < RACE_CELLS; cell += BAR_TICK_CELLS) {
      const x = BAR_LEFT + (span * cell) / RACE_CELLS;
      stroke(renderer, seat, x, BAR_Y - 4, x, BAR_Y + BAR_HEIGHT + 4, 2, COLOUR_DIVIDER);
    }
  }
}
