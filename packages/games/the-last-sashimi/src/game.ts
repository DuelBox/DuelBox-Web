import { Rng, SEAT_PALETTE, SeatFlip, seatRotated } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CHOPSTICK_REACH,
  CLEAN_SHARE,
  DISH_SECONDS,
  MAX_ROUNDS,
  SLOT_COUNT,
  TARGET_POINTS,
  beltAt,
  bite,
  createBotRngs,
  createBotState,
  createGame,
  driveBot,
  halfOf,
  isPresentAt,
  reachOf,
  resetBotState,
  resetGame,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Counter, Slot } from './rules.js';

/**
 * The Last Sashimi — a belt, two counters, and one press.
 *
 * Everything the simulation knows is a moment (see `rules.ts`); everything here is the picture
 * that makes those moments readable. The belt is drawn as a loop with a straight run in front
 * of each player and its two ends behind curtains, because that is the shape that makes three
 * things true at once: the run in front of you is where your decision happens, the run opposite
 * shows you what is coming to you next, and the loop is its own mirror image under the
 * half-turn, so the two players are looking at one board rather than two.
 *
 * The plates are drawn at the size the referee actually judges them at — a slice is as long as
 * its window, a rice ball as wide as its own — so what a player learns by watching is the rule.
 */

const COLOUR_ROOM = '#171214';
const COLOUR_COUNTER = '#241b1d';
const COLOUR_BELT = '#2f2529';
const COLOUR_CURTAIN = '#3a2b30';
const COLOUR_EDGE = 'rgba(244, 228, 214, 0.16)';
const COLOUR_FAINT = 'rgba(244, 228, 214, 0.13)';
const COLOUR_MUTED = 'rgba(244, 228, 214, 0.38)';
const COLOUR_PLATE = 'rgba(244, 228, 214, 0.30)';
const COLOUR_RICE = '#f6efe4';
const COLOUR_NORI = '#3f4a45';
const COLOUR_FISH = '#e8836a';
const COLOUR_FISH_DEEP = '#b9563f';
const COLOUR_TAKEN = '#5ecf9a';
const COLOUR_MISSED = '#e2594f';

/** The two straight runs, and the curtained ends that join them into a loop. */
const LANE_OFFSET_Y = 190;
const LANE_HALF_LENGTH = 300;
const LANE_HALF_DEPTH = 26;
const CURTAIN_WIDTH = 30;
/** Arc the belt covers behind a curtain. Longer than the curtain is wide: it is round a bend. */
const HIDDEN_ARC = 150;
const STRAIGHT_ARC = LANE_HALF_LENGTH * 2;
const LAP_ARC = STRAIGHT_ARC * 2 + HIDDEN_ARC * 2;
const ARC_PER_SLOT = LAP_ARC / SLOT_COUNT;
/** The one number that turns the simulation's seconds into the picture's units. */
const ARC_PER_SECOND = ARC_PER_SLOT / DISH_SECONDS;

const CENTRE_X = BOARD_WIDTH / 2;
const CENTRE_Y = BOARD_HEIGHT / 2;
const NEAR_LANE_Y = CENTRE_Y + LANE_OFFSET_Y;
const FAR_LANE_Y = CENTRE_Y - LANE_OFFSET_Y;
const LANE_LEFT_X = CENTRE_X - LANE_HALF_LENGTH;
const LANE_RIGHT_X = CENTRE_X + LANE_HALF_LENGTH;

/** Arc boundaries of the four stretches, measured from seat one's chopsticks. */
const ARC_NEAR_LEFT_END = LANE_HALF_LENGTH;
const ARC_FAR_START = ARC_NEAR_LEFT_END + HIDDEN_ARC;
const ARC_FAR_END = ARC_FAR_START + STRAIGHT_ARC;
const ARC_NEAR_RIGHT_START = ARC_FAR_END + HIDDEN_ARC;

const PLATE_HALF_WIDTH = 25;
const PLATE_HALF_DEPTH = 15;

const PIP_ROW_INSET = 100;
const PIP_SPACING = 42;
const PIP_RADIUS = 12;

/** Hoisted: the render path runs every frame and a literal here would be a dead array a frame. */
const SEATS: readonly SeatId[] = ['p1', 'p2'];
const SIDES: readonly number[] = [-1, 1];

interface BeltPoint {
  x: number;
  y: number;
  /** False behind a curtain, where a plate is out of sight. */
  visible: boolean;
}

export class TheLastSashimiGame implements Game {
  readonly #counter: Counter = createGame();
  readonly #flip = new SeatFlip();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #point: BeltPoint = { x: 0, y: 0, visible: false };

  #botRng: { p1: Rng; p2: Rng } = { p1: new Rng(1), p2: new Rng(2) };
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get counter(): Counter {
    return this.#counter;
  }

  init(context: GameContext): void {
    // A generator per seat, both drawn from the match's own before anything else touches it.
    this.#botRng = createBotRngs(context.rng);
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    // The shell alternates who opens across the rounds of a best-of so first-mover advantage
    // washes out. Assuming `p1` here would quietly undo that (issue #2466), and on a shared
    // belt the opener genuinely picks first.
    resetGame(this.#counter, context.openingSeat, context.rng);
    this.#flip.snap(this.#shouldRotate());
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    // Stepped before the early return, so the board finishes turning to face the winner rather
    // than freezing half way round.
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#winner !== null) return;

    this.#take(input, fixedDeltaSeconds);
    step(this.#counter, fixedDeltaSeconds);
    this.#winner = winnerOf(this.#counter);
  }

  #take(input: InputState, fixedDeltaSeconds: number): void {
    const active = this.#counter.active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;

    if (difficulty !== null) {
      const state = active === 'p1' ? this.#botP1State : this.#botP2State;
      driveBot(this.#counter, active, difficulty, state, this.#botRng[active], fixedDeltaSeconds);
      return;
    }

    // Nothing is accepted while the board is part-way round: the belt a player is reading is
    // moving under them, so a tap would name a moment they did not mean. The rules' ready
    // freeze is what makes this cost nothing — the chopsticks are frozen for longer than the
    // turn takes, for a bot as much as for a person, so this gate never refuses a press the
    // simulation would have taken.
    if (!this.#flip.acceptsInput) return;
    if (!input.seat(active).actionPressed) return;
    bite(this.#counter, active);
  }

  #shouldRotate(): boolean {
    // `seatView` is the one definition of when a seat reads the board upside down.
    return seatRotated(this.#counter.active, this.#presentation, this.#localSeat);
  }

  getActiveSeat(): SeatId {
    return this.#counter.active;
  }

  getScore(): MatchScore {
    return { p1: this.#counter.p1Points, p2: this.#counter.p2Points, winner: this.#winner };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#counter, 'p1', new Rng(0));
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks against
  // the class as well as against `Game`. This game interpolates nothing between fixed steps —
  // every plate's position is read straight off the simulation clock — so the implementation
  // below ignores alpha, and a test asserts two alphas draw the identical picture.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_ROOM);
    renderer.pushRotation(this.#flip.angle);
    this.#drawRoom(renderer);
    this.#drawBelt(renderer);
    this.#drawPlates(renderer);
    for (const seat of SEATS) this.#drawChopsticks(renderer, seat);
    this.#drawOutcome(renderer);
    for (const seat of SEATS) this.#drawPips(renderer, seat);
    renderer.popSeatRotation();
  }

  #drawRoom(renderer: Renderer): void {
    renderer.rect(24, 24, BOARD_WIDTH - 48, BOARD_HEIGHT - 48, COLOUR_COUNTER);
    renderer.line(24, CENTRE_Y, BOARD_WIDTH - 24, CENTRE_Y, 2, COLOUR_EDGE);
    // Rounds left, as a bar on the halfway line — one object, shared by both players.
    const left = Math.max(0, 1 - (this.#counter.round - 1) / MAX_ROUNDS);
    const width = BOARD_WIDTH - 160;
    renderer.rect(CENTRE_X - width / 2, CENTRE_Y - 3, width * left, 6, COLOUR_MUTED);
  }

  /**
   * The belt: a run in front of each player, joined at both ends behind a curtain.
   *
   * The far run is drawn as fully as the near one. It is not decoration — it is half the
   * information the game gives you, because what is on the opposite run now is what reaches
   * your own chopsticks half a lap from now, and a plate the other player has just taken shows
   * as a bare plate all the way round.
   */
  #drawBelt(renderer: Renderer): void {
    for (const y of [NEAR_LANE_Y, FAR_LANE_Y]) {
      renderer.rect(
        LANE_LEFT_X,
        y - LANE_HALF_DEPTH,
        LANE_HALF_LENGTH * 2,
        LANE_HALF_DEPTH * 2,
        COLOUR_BELT,
      );
    }
    for (const side of SIDES) {
      const x = side < 0 ? LANE_LEFT_X - CURTAIN_WIDTH : LANE_RIGHT_X;
      renderer.rect(
        x,
        FAR_LANE_Y - LANE_HALF_DEPTH - 8,
        CURTAIN_WIDTH,
        NEAR_LANE_Y - FAR_LANE_Y + LANE_HALF_DEPTH * 2 + 16,
        COLOUR_CURTAIN,
      );
    }
  }

  /** Every slot, at the position its own clock puts it. Bare plates included. */
  #drawPlates(renderer: Renderer): void {
    const belt = beltAt(this.#counter);
    const clock = this.#counter.clock;
    for (let i = 0; i < this.#counter.slots.length; i += 1) {
      const slot = this.#counter.slots[i] as Slot;
      this.#locate(i, belt);
      if (!this.#point.visible) continue;
      const x = this.#point.x;
      const y = this.#point.y;
      renderer.strokeRect(
        x - PLATE_HALF_WIDTH,
        y - PLATE_HALF_DEPTH,
        PLATE_HALF_WIDTH * 2,
        PLATE_HALF_DEPTH * 2,
        2,
        COLOUR_PLATE,
      );
      if (!isPresentAt(slot, clock)) continue;
      if (slot.kind === 'sashimi') this.#drawSashimi(renderer, x, y);
      else this.#drawOnigiri(renderer, x, y);
    }
  }

  /**
   * A slice, drawn as long as the window it gives you.
   *
   * A rectangle with a band down it, against a rice ball drawn as a triangle: two plates told
   * apart by outline before either of them is a colour, which is rule 7 applied to the thing a
   * player is actually choosing between.
   */
  #drawSashimi(renderer: Renderer, x: number, y: number): void {
    const half = halfOf('sashimi') * ARC_PER_SECOND;
    renderer.rect(x - half, y - 10, half * 2, 20, COLOUR_FISH);
    renderer.rect(x - half, y - 3, half * 2, 5, COLOUR_FISH_DEEP);
    // The clean band, at the size the tiebreak really asks for.
    const clean = reachOf('sashimi') * CLEAN_SHARE * ARC_PER_SECOND;
    renderer.strokeRect(x - clean, y - 10, clean * 2, 20, 2, COLOUR_FISH_DEEP);
  }

  #drawOnigiri(renderer: Renderer, x: number, y: number): void {
    const half = halfOf('onigiri') * ARC_PER_SECOND;
    const top = y - 14;
    const base = y + 9;
    renderer.line(x, top, x - half, base, 3, COLOUR_RICE);
    renderer.line(x, top, x + half, base, 3, COLOUR_RICE);
    renderer.line(x - half, base, x + half, base, 3, COLOUR_RICE);
    renderer.rect(x - half * 0.7, y + 1, half * 1.4, 6, COLOUR_NORI);
  }

  /**
   * A seat's chopsticks: where its window is, and whose window it is.
   *
   * Seat one is round and seat two square, here and on the pips, so a greyscale screen still
   * says which counter and which score belongs to whom. Both are drawn every frame, whoever is
   * eating, because "which of these is mine" has to be answerable at a glance and not only on
   * your own turn.
   */
  #drawChopsticks(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const live = seat === this.#counter.active && this.#counter.phase !== 'over';
    const colour = live ? palette.base : palette.soft;
    const y = seat === 'p1' ? NEAR_LANE_Y : FAR_LANE_Y;
    const outward = seat === 'p1' ? 1 : -1;
    renderer.line(
      CENTRE_X,
      y - LANE_HALF_DEPTH - 10,
      CENTRE_X,
      y + LANE_HALF_DEPTH + 10,
      live ? 4 : 2,
      colour,
    );
    // The reach of the sticks themselves, either side of the line. Narrow on purpose: what
    // widens a window is the plate, and the plates are drawn at their real size.
    const reach = CHOPSTICK_REACH * ARC_PER_SECOND;
    for (const side of SIDES) {
      renderer.line(
        CENTRE_X + side * reach,
        y - LANE_HALF_DEPTH - 4,
        CENTRE_X + side * reach,
        y + LANE_HALF_DEPTH + 4,
        2,
        palette.soft,
      );
    }
    this.#seatMark(
      renderer,
      seat,
      CENTRE_X,
      y + outward * (LANE_HALF_DEPTH + 26),
      live ? 13 : 9,
      colour,
    );
  }

  /**
   * What the last press did, held on the board for as long as the chopsticks are busy.
   *
   * Double ring, single ring, cross: three outcomes told apart by shape, with colour confirming
   * what the shape already said. The chew is the flash — a player sees how long they are out of
   * the game for, which is the price the whole decision is about.
   */
  #drawOutcome(renderer: Renderer): void {
    const counter = this.#counter;
    if (counter.lastOutcome === 'none') return;
    if (counter.phase !== 'live' && counter.phase !== 'settling') return;
    const seat = counter.active;
    const y = seat === 'p1' ? NEAR_LANE_Y : FAR_LANE_Y;
    if (counter.lastOutcome === 'fumble') {
      renderer.line(CENTRE_X - 18, y - 18, CENTRE_X + 18, y + 18, 4, COLOUR_MISSED);
      renderer.line(CENTRE_X + 18, y - 18, CENTRE_X - 18, y + 18, 4, COLOUR_MISSED);
      return;
    }
    renderer.strokeCircle(CENTRE_X, y, 26, 4, COLOUR_TAKEN);
    if (counter.lastOutcome === 'clean') renderer.strokeCircle(CENTRE_X, y, 16, 4, COLOUR_TAKEN);
  }

  /**
   * Points taken, on their owner's own edge of the board.
   *
   * Fifteen slots, because fifteen is what the match is played to, so a player reads how close
   * they are rather than a number to compare. A slot filled by a clean take carries a ring
   * inside it — that is the tiebreak made visible, so a player level on points can see which way
   * it will go — and a seat that has gone backwards past nothing wears a mark to the left of the
   * row, which is the one case the fifteen slots cannot hold.
   */
  #drawPips(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const counter = this.#counter;
    const points = seat === 'p1' ? counter.p1Points : counter.p2Points;
    const clean = seat === 'p1' ? counter.p1Clean : counter.p2Clean;
    const filled = Math.max(0, Math.min(TARGET_POINTS, points));
    const ringed = Math.max(0, Math.min(TARGET_POINTS, clean));
    const y = seat === 'p1' ? BOARD_HEIGHT - PIP_ROW_INSET : PIP_ROW_INSET;
    for (let i = 0; i < TARGET_POINTS; i += 1) {
      const x = CENTRE_X + (i - (TARGET_POINTS - 1) / 2) * PIP_SPACING;
      if (i < filled) this.#seatMark(renderer, seat, x, y, PIP_RADIUS, palette.base);
      else this.#seatOutline(renderer, seat, x, y, PIP_RADIUS, COLOUR_FAINT);
      if (i < ringed) this.#seatOutline(renderer, seat, x, y, PIP_RADIUS - 5, palette.deep);
    }
    if (points > TARGET_POINTS) {
      const x = CENTRE_X + ((TARGET_POINTS - 1) / 2) * PIP_SPACING;
      this.#seatOutline(renderer, seat, x, y, PIP_RADIUS + 5, palette.base);
    }
    if (points < 0) {
      const x = CENTRE_X - ((TARGET_POINTS + 1) / 2) * PIP_SPACING;
      this.#seatOutline(renderer, seat, x, y, PIP_RADIUS, palette.base);
      renderer.line(x - PIP_RADIUS, y, x + PIP_RADIUS, y, 3, palette.base);
    }
  }

  /** Seat one is round and seat two square, everywhere on the board. Rule 7, in one place. */
  #seatMark(
    renderer: Renderer,
    seat: SeatId,
    x: number,
    y: number,
    size: number,
    colour: string,
  ): void {
    if (seat === 'p1') renderer.circle(x, y, size, colour);
    else renderer.rect(x - size, y - size, size * 2, size * 2, colour);
  }

  #seatOutline(
    renderer: Renderer,
    seat: SeatId,
    x: number,
    y: number,
    size: number,
    colour: string,
  ): void {
    if (seat === 'p1') renderer.strokeCircle(x, y, size, 3, colour);
    else renderer.strokeRect(x - size, y - size, size * 2, size * 2, 3, colour);
  }

  /**
   * Where a slot is on the board, given how far the belt has run.
   *
   * The only place the simulation's one dimension becomes two. Writes into a field rather than
   * returning a point, because the render path walks every slot every frame.
   */
  #locate(index: number, belt: number): void {
    const slots = (index + belt) % SLOT_COUNT;
    const arc = (slots < 0 ? slots + SLOT_COUNT : slots) * ARC_PER_SLOT;
    if (arc < ARC_NEAR_LEFT_END) {
      this.#point.x = CENTRE_X - arc;
      this.#point.y = NEAR_LANE_Y;
      this.#point.visible = true;
      return;
    }
    if (arc < ARC_FAR_START) {
      this.#point.visible = false;
      return;
    }
    if (arc < ARC_FAR_END) {
      this.#point.x = LANE_LEFT_X + (arc - ARC_FAR_START);
      this.#point.y = FAR_LANE_Y;
      this.#point.visible = true;
      return;
    }
    if (arc < ARC_NEAR_RIGHT_START) {
      this.#point.visible = false;
      return;
    }
    this.#point.x = LANE_RIGHT_X - (arc - ARC_NEAR_RIGHT_START);
    this.#point.y = NEAR_LANE_Y;
    this.#point.visible = true;
  }
}
