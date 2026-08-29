import { Rng, SEATS, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  GROUND_Y,
  LANE_HEIGHT,
  LANE_WIDTH,
  RUNNER_HALF,
  RUNNER_RADIUS,
  RUNNER_X,
  SPARK_SECONDS,
  WARN_SECONDS,
  botPress,
  courseSeconds,
  createBotState,
  createGame,
  enterLead,
  halfLength,
  hazardX,
  jumpHeight,
  resetBotState,
  resetGame,
  runnerOf,
  step,
  toBoardX,
  toBoardY,
  valueOf,
  visibleLead,
  winnerOf,
} from './rules.js';
import type { Beast, BotDifficulty, BotState, Game as Field, Hazard } from './rules.js';

/**
 * Stampede — two lanes, one herd, and one button each.
 *
 * `rules.ts` holds the whole simulation in logical units and in seconds. This file does
 * three things and nothing else: it turns a key or a finger into the single bit the rules
 * read, it gives each bot seat its own generator, and it draws. It adds nothing to the
 * simulation — a test renders forty frames at three alphas and asserts nothing moved.
 *
 * **Nothing here is rotated, and there is no text anywhere in the game.** Seat two's lane
 * is seat one's lane turned half a turn about the middle of the board, which `toBoardX`
 * and `toBoardY` in `rules.ts` express and this file is the only caller of. So each player
 * reads their own lane upright with the device the right way up for them, the picture is
 * unchanged by turning the device over, and there is no glyph on screen for the half-turn
 * to leave upside down.
 *
 * The consequence worth stating: **a beast entering on your left enters on your left**,
 * whichever side of the device you are sitting on, and the two players see it come from
 * opposite ends of the same board at the same instant.
 */

const COLOUR_SKY = '#f2e7d2';
const COLOUR_HAZE = '#e3d4b8';
const COLOUR_GROUND = '#c7a173';
const COLOUR_GROUND_DEEP = '#a8804f';
const COLOUR_INK = '#2c2117';
const COLOUR_DUST = 'rgba(108, 82, 50, 0.45)';
const COLOUR_BULL = '#4e3a26';
const COLOUR_GOAT = '#8e7550';
const COLOUR_TRACK = 'rgba(44, 33, 23, 0.16)';

/** Drawn height of each beast, above the ground line. Shape, not colour, is the signal. */
const BULL_HEIGHT = 62;
const GOAT_HEIGHT = 40;

/** How far past the lane edge a warning marker sits. Inside the board, never off it. */
const WARN_INSET = 26;

/** The centre strip both players read: course progress, drawn once and shared. */
const STRIP_HALF = 7;

/** An arbitrary odd word, so the two openings of a best-of land in unrelated streams. */
const OPENER_SALT = 0x5bf03635;

export class StampedeGame implements Game {
  readonly #field: Field = createGame();
  readonly #botState: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };

  /**
   * A generator per seat, both derived in `init` from the one the shell hands us.
   *
   * Separate streams because the *number* of values a tier draws is a function of how many
   * beasts it decides to jump for, and a tier that gives up an unwinnable half of a choice
   * plans fewer times than one that does not. On a shared stream that would make one seat's
   * play a function of which tier was sitting opposite — Star Catcher measured that shape at
   * 1.4 points of win rate, and Cup Pong's SPEC has the table. A test asserts seat two plays
   * the identical match against `easy` and against `hard`.
   */
  #rng: Record<SeatId, Rng> = { p1: new Rng(1), p2: new Rng(2) };
  #difficulty: Record<SeatId, BotDifficulty | null> = { p1: null, p2: null };

  /**
   * The fixed step the shell is running at, kept only so `render` can carry the picture
   * forward by `alpha` of one step. Never read by a rule and never fed back into one.
   */
  #stepSeconds = 1 / 60;

  /** Read-only view for tests and the balance harness. Never mutate through it. */
  get field(): Readonly<Field> {
    return this.#field;
  }

  init(context: GameContext): void {
    // The course is drawn once, here, and never touched again. Both seats run it.
    //
    // The SDK alternates `openingSeat` across the rounds of a best-of so that first-mover
    // advantage washes out, and the contract lets a real-time game ignore it. This one has
    // no first mover to wash out — both runners face the same herd from the same instant —
    // so rather than ignore the alternation it **spends it on the herd**: the two halves of
    // a best-of get two different courses instead of the same one twice. It costs a line, it
    // is something a player notices, and it leaves the seat symmetry untouched, because what
    // it changes is the course both seats run rather than either seat's share of it. A test
    // plays both openings and requires the winner to be the seat's, not the opener's.
    const opener = context.openingSeat === 'p2' ? OPENER_SALT : 0;
    const course = new Rng((context.rng.next() ^ opener) | 0);
    this.#rng = { p1: new Rng(context.rng.next() | 0), p2: new Rng(context.rng.next() | 0) };
    this.#difficulty = { p1: context.botDifficulty('p1'), p2: context.botDifficulty('p2') };
    resetBotState(this.#botState.p1);
    resetBotState(this.#botState.p2);
    resetGame(this.#field, course);
  }

  /**
   * One fixed step.
   *
   * Two booleans and a call. Nothing is allocated: the presses are primitives, the bot
   * states and generators are fields, and `step` writes into the field it was handed.
   */
  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#field.winner !== null) return;
    this.#stepSeconds = fixedDeltaSeconds;
    const pressP1 = this.#press('p1', input);
    const pressP2 = this.#press('p2', input);
    step(this.#field, fixedDeltaSeconds, pressP1, pressP2);
  }

  /**
   * One seat's press for this step, from a bot or from a person.
   *
   * `actionPressed` is the edge, true for exactly one step, and the engine raises it for a
   * key and for a finger going down alike (`InputManager`: `keys.action || pointerDown`).
   * So this file reads one bit and never asks which instrument sent it — there is no
   * pointer position, no direction and no hold length anywhere in this game to ask about.
   */
  #press(seat: SeatId, input: InputState): boolean {
    const difficulty = this.#difficulty[seat];
    if (difficulty !== null) {
      return botPress(this.#field, seat, difficulty, this.#botState[seat], this.#rng[seat]);
    }
    return input.seat(seat).actionPressed;
  }

  /**
   * Nothing to do on either edge of a pause.
   *
   * `InputManager.clear()` drops every key and pointer on the way out, which arrives as a
   * step with no press in it — and a step with no press in it is the ordinary case here.
   * Games whose input is a *held* state have to plant their feet on resume (Frozen Beaks
   * does); a game whose input is an edge has nothing to plant.
   */
  onPause(): void {}
  onResume(): void {}

  getScore(): MatchScore {
    return {
      p1: this.#field.p1.points,
      p2: this.#field.p2.points,
      winner: winnerOf(this.#field),
    };
  }

  destroy(): void {
    resetGame(this.#field, null);
    resetBotState(this.#botState.p1);
    resetBotState(this.#botState.p2);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. Declaring only the one-argument form is
  // what made render-purity tests unable to render at two different alphas (issue #2464).
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer, alpha = 0): void {
    // The simulation is evaluated from the clock rather than integrated, so carrying the
    // picture forward by part of a step is exactly asking it the same question a moment
    // later. Nothing is stored back.
    const clock = this.#field.clock + alpha * this.#stepSeconds;
    renderer.clear(COLOUR_SKY);
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      this.#drawLane(renderer, seat);
      this.#drawHerd(renderer, seat, clock);
      this.#drawRunner(renderer, seat, clock);
      this.#drawTally(renderer, seat);
    }
    this.#drawProgress(renderer);
  }

  /* ------------------------------------------------------------------ drawing helpers */

  /**
   * A mark in one seat's own shape.
   *
   * **Seat one is round and seat two is square, everywhere in this game** — bodies, eyes,
   * shadows, dust, milestone pips, all of it. Two runners on one screen doing the identical
   * thing at the identical moment is the pair most likely to be confused, and the two seat
   * colours sit at 1.03:1 under deuteranopia (`packages/engine/src/palette-vision.test.ts`),
   * so the shape is not decoration. Routing every seat-owned mark through these two helpers
   * is what stops the next ornament added to this file from being round for both.
   */
  #dot(renderer: Renderer, seat: SeatId, cx: number, cy: number, r: number, colour: string): void {
    const bx = toBoardX(seat, cx);
    const by = toBoardY(seat, cy);
    if (seat === 'p1') renderer.circle(bx, by, r, colour);
    else renderer.rect(bx - r, by - r, r * 2, r * 2, colour);
  }

  #ring(
    renderer: Renderer,
    seat: SeatId,
    cx: number,
    cy: number,
    r: number,
    width: number,
    colour: string,
  ): void {
    const bx = toBoardX(seat, cx);
    const by = toBoardY(seat, cy);
    if (seat === 'p1') renderer.strokeCircle(bx, by, r, width, colour);
    else renderer.strokeRect(bx - r, by - r, r * 2, r * 2, width, colour);
  }

  /** An axis-aligned box given by its centre and half-extents, which the half-turn preserves. */
  #box(
    renderer: Renderer,
    seat: SeatId,
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    colour: string,
  ): void {
    const bx = toBoardX(seat, cx);
    const by = toBoardY(seat, cy);
    renderer.rect(bx - hw, by - hh, hw * 2, hh * 2, colour);
  }

  #stroke(
    renderer: Renderer,
    seat: SeatId,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    colour: string,
  ): void {
    renderer.line(
      toBoardX(seat, x1),
      toBoardY(seat, y1),
      toBoardX(seat, x2),
      toBoardY(seat, y2),
      width,
      colour,
    );
  }

  /* ------------------------------------------------------------------------- the lane */

  /**
   * One seat's ground, and the band along its own outer edge that says the lane is theirs.
   *
   * The ground line is drawn where the rules put the runner's feet, and the runner's
   * footprint is marked on it at exactly {@link RUNNER_HALF} — the width the danger
   * geometry actually uses — so "where a beast reaches you" is a thing on the board rather
   * than a number in a spec.
   */
  #drawLane(renderer: Renderer, seat: SeatId): void {
    this.#box(
      renderer,
      seat,
      LANE_WIDTH / 2,
      GROUND_Y / 2,
      LANE_WIDTH / 2,
      GROUND_Y / 2,
      COLOUR_GROUND,
    );
    this.#box(renderer, seat, LANE_WIDTH / 2, LANE_HEIGHT - 30, LANE_WIDTH / 2, 30, COLOUR_HAZE);
    this.#stroke(renderer, seat, 0, GROUND_Y, LANE_WIDTH, GROUND_Y, 4, COLOUR_GROUND_DEEP);
    this.#stroke(
      renderer,
      seat,
      RUNNER_X - RUNNER_HALF,
      GROUND_Y - 6,
      RUNNER_X + RUNNER_HALF,
      GROUND_Y - 6,
      5,
      COLOUR_GROUND_DEEP,
    );
    // The seat band: one stripe for either seat, in that seat's own colour and its own
    // shape at the ends, hugging the edge of the device the player is sitting at.
    const palette = SEAT_PALETTE[seat];
    this.#box(renderer, seat, LANE_WIDTH / 2, 9, LANE_WIDTH / 2, 5, palette.tint);
    this.#dot(renderer, seat, 22, 9, 7, palette.base);
    this.#dot(renderer, seat, LANE_WIDTH - 22, 9, 7, palette.base);
  }

  /* ------------------------------------------------------------------------- the herd */

  /**
   * Every beast either close enough to be coming or not yet finished leaving.
   *
   * Drawn from the clock and from nothing else, so both lanes show the identical herd at
   * the identical instant and neither runner's own state can change what the other sees.
   * A beast is on screen from {@link visibleLead} before it arrives — as dust at the edge
   * it will come from, carrying its own silhouette — until it has run the same distance out
   * the far side.
   */
  #drawHerd(renderer: Renderer, seat: SeatId, clock: number): void {
    const field = this.#field;
    for (let i = 0; i < field.count; i += 1) {
      const hazard = field.hazards[i] as Hazard;
      const since = clock - hazard.arrival;
      const enter = enterLead(hazard);
      if (since < -visibleLead(hazard) || since > enter) continue;
      if (since < -enter) this.#drawWarning(renderer, seat, hazard, -since - enter);
      else this.#drawBeast(renderer, seat, hazard, hazardX(hazard, clock));
    }
  }

  /**
   * Dust at the edge a beast is about to come from, with the beast's own horns in it.
   *
   * The horns are the point. A `choice` asks a player which of two beasts is worth saving,
   * and asking that question at the moment both are already halfway across the lane would
   * make it a reflex rather than a decision. Putting the silhouette in the warning gives the
   * whole {@link WARN_SECONDS} plus the run across the lane to answer it — SPEC.md states
   * that total as a budget in seconds and argues it.
   */
  #drawWarning(
    renderer: Renderer,
    seat: SeatId,
    hazard: Readonly<Hazard>,
    remaining: number,
  ): void {
    const edge = hazard.dir > 0 ? WARN_INSET : LANE_WIDTH - WARN_INSET;
    const along = Math.max(0, Math.min(1, 1 - remaining / WARN_SECONDS));
    const height = hazard.beast === 'bull' ? BULL_HEIGHT : GOAT_HEIGHT;
    const y = GROUND_Y + height / 2;
    // Three plumes of dust, each a little further into the lane as the beast nears.
    for (let i = 0; i < 3; i += 1) {
      const reach = (10 + i * 14) * (0.4 + along * 0.6);
      this.#dot(renderer, seat, edge + hazard.dir * reach, GROUND_Y + 8 + i * 5, 5, COLOUR_DUST);
    }
    this.#horns(renderer, seat, hazard.beast, edge, y + height / 2, hazard.dir, COLOUR_DUST);
  }

  /**
   * One beast, drawn at exactly the length the rules make it dangerous for.
   *
   * {@link halfLength} derives the body from {@link DANGER_HALF} and the speed, so the
   * moment the drawn beast overlaps the drawn footprint is the moment the rule says it
   * does. A fast beast is longer, which is why a course that speeds up stays exactly as
   * forgiving to *time* while getting harder to *read*.
   */
  #drawBeast(renderer: Renderer, seat: SeatId, hazard: Readonly<Hazard>, x: number): void {
    const half = halfLength(hazard);
    const bull = hazard.beast === 'bull';
    const height = bull ? BULL_HEIGHT : GOAT_HEIGHT;
    const colour = bull ? COLOUR_BULL : COLOUR_GOAT;
    const y = GROUND_Y + height / 2;
    this.#box(renderer, seat, x, y, half, height / 2, colour);
    // Legs, so a beast reads as running rather than sliding: four for the bull, two for
    // the goat, and both sets planted on the same ground line the runner stands on.
    const legs = bull ? 4 : 2;
    for (let i = 0; i < legs; i += 1) {
      const at = x - half + ((i + 0.5) * (half * 2)) / legs;
      this.#stroke(renderer, seat, at, GROUND_Y, at, GROUND_Y + 10, 5, COLOUR_INK);
    }
    this.#horns(renderer, seat, hazard.beast, x + hazard.dir * half, GROUND_Y + height, 1, colour);
  }

  /**
   * The one thing that tells a bull from a goat without colour: **two horns against one**.
   *
   * Drawn at the head in the lane, and again in the warning dust, so the same silhouette
   * answers "which is worth two" at both ends of the approach.
   */
  #horns(
    renderer: Renderer,
    seat: SeatId,
    beast: Beast,
    x: number,
    y: number,
    facing: number,
    colour: string,
  ): void {
    this.#stroke(renderer, seat, x, y, x + facing * 12, y + 16, 5, colour);
    if (beast === 'bull') this.#stroke(renderer, seat, x, y, x - facing * 10, y + 18, 5, colour);
  }

  /* ---------------------------------------------------------------------- the runners */

  /**
   * One runner: on its feet, in the air, or on the floor.
   *
   * Height comes from {@link jumpHeight}, which is a function of the clock and the press
   * that launched the jump — so the drawn arc *is* the airborne interval the rule tests,
   * and a player watching the gap between hoof and horn is reading the actual referee.
   */
  #drawRunner(renderer: Renderer, seat: SeatId, clock: number): void {
    const runner = runnerOf(this.#field, seat);
    const palette = SEAT_PALETTE[seat];
    const lift = jumpHeight(runner, clock);
    const down = runner.stagger > 0;
    const cy = GROUND_Y + RUNNER_RADIUS + lift - (down ? 14 : 0);

    // A shadow that shrinks as the runner rises: the only cue for how high it is that does
    // not need the ground line in the same glance.
    this.#dot(renderer, seat, RUNNER_X, GROUND_Y + 3, RUNNER_RADIUS - lift / 14, COLOUR_TRACK);

    if (down) {
      for (let i = 0; i < 3; i += 1) {
        const at = RUNNER_X - 26 + i * 26;
        this.#stroke(renderer, seat, at, GROUND_Y + 6, at, GROUND_Y + 18, 4, COLOUR_DUST);
      }
    } else {
      // Legs, tucked while airborne and planted while standing.
      const foot = lift > 0 ? cy - RUNNER_RADIUS + 6 : GROUND_Y;
      this.#stroke(
        renderer,
        seat,
        RUNNER_X - 11,
        cy - RUNNER_RADIUS + 4,
        RUNNER_X - 11,
        foot,
        6,
        COLOUR_INK,
      );
      this.#stroke(
        renderer,
        seat,
        RUNNER_X + 11,
        cy - RUNNER_RADIUS + 4,
        RUNNER_X + 11,
        foot,
        6,
        COLOUR_INK,
      );
    }

    this.#dot(renderer, seat, RUNNER_X, cy, RUNNER_RADIUS, palette.base);
    this.#ring(renderer, seat, RUNNER_X, cy, RUNNER_RADIUS - 4, 4, palette.deep);
    // An eye, in the seat's own shape, set toward the middle of the device so it is never
    // hidden under the seat band at the outer edge.
    this.#dot(renderer, seat, RUNNER_X + 9, cy + 7, 5, COLOUR_INK);

    // A clear leaves a ring where the beast went by, a knock a broken one. Both fade, and
    // both are the seat's own shape, so which of the two runners just took a horn is
    // readable at a glance with no colour at all.
    if (runner.spark > 0) {
      this.#ring(
        renderer,
        seat,
        RUNNER_X,
        cy,
        RUNNER_RADIUS + 6 + (SPARK_SECONDS - runner.spark) * 40,
        3,
        palette.soft,
      );
    }
    if (runner.flash > 0) {
      this.#stroke(
        renderer,
        seat,
        RUNNER_X - 34,
        GROUND_Y + 40,
        RUNNER_X + 34,
        GROUND_Y + 40,
        5,
        palette.deep,
      );
    }
  }

  /**
   * What a seat has taken, as a bar along its own edge with the herd's own marks on it.
   *
   * A length rather than a number, because this game draws no text at all: a glyph would
   * be upside down for one of the two people looking at it, and there is nothing here that
   * needs saying in words. The four pips are fixed milestones in the seat's own shape, so
   * the bar reads as that seat's property and not as a shared gauge.
   */
  #drawTally(renderer: Renderer, seat: SeatId): void {
    const runner = runnerOf(this.#field, seat);
    const total = this.#field.total;
    const palette = SEAT_PALETTE[seat];
    const left = 60;
    const width = LANE_WIDTH - left * 2;
    const along = total === 0 ? 0 : Math.max(0, Math.min(1, runner.points / total));
    this.#box(renderer, seat, LANE_WIDTH / 2, 30, width / 2, 5, COLOUR_TRACK);
    this.#box(renderer, seat, left + (width * along) / 2, 30, (width * along) / 2, 5, palette.soft);
    for (let i = 1; i <= 4; i += 1) {
      this.#dot(renderer, seat, left + (width * i) / 4, 30, 6, palette.base);
    }
  }

  /**
   * How much of the course is left, as a strip on the centre line.
   *
   * One object, drawn once, in neither seat's colour, growing from the middle toward both
   * ends — so neither player is reading a clock the other cannot, and turning the device
   * over leaves it exactly where it was.
   */
  #drawProgress(renderer: Renderer): void {
    const length = courseSeconds(this.#field);
    const along = length === 0 ? 0 : Math.max(0, Math.min(1, this.#field.clock / length));
    const span = (BOARD_WIDTH - 120) * along;
    renderer.rect(
      60,
      BOARD_HEIGHT / 2 - STRIP_HALF,
      BOARD_WIDTH - 120,
      STRIP_HALF * 2,
      COLOUR_HAZE,
    );
    renderer.rect(
      BOARD_WIDTH / 2 - span / 2,
      BOARD_HEIGHT / 2 - STRIP_HALF,
      span,
      STRIP_HALF * 2,
      COLOUR_GROUND_DEEP,
    );
    // Where each beast still to come falls on that strip, as a tick whose height is what it
    // is worth. Both players read the same one, from opposite sides of the same line.
    const field = this.#field;
    for (let i = 0; i < field.count; i += 1) {
      const hazard = field.hazards[i] as Hazard;
      const at = length === 0 ? 0 : hazard.arrival / length;
      const x = 60 + (BOARD_WIDTH - 120) * at;
      const h = valueOf(hazard.beast) * 4;
      renderer.line(x, BOARD_HEIGHT / 2 - h, x, BOARD_HEIGHT / 2 + h, 3, COLOUR_INK);
    }
  }
}
