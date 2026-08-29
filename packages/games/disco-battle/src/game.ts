import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  APPROACH_SECONDS,
  FLASH_SECONDS,
  GOOD_SECONDS,
  NOTE_COUNT,
  PERFECT_SECONDS,
  approachOf,
  createBotState,
  createState,
  driveBot,
  firstDrawable,
  judgedBy,
  remainingOf,
  resetBotState,
  resetState,
  sideOf,
  step,
} from './rules.js';
import type { BotDifficulty, BotState, State, Verdict } from './rules.js';

/**
 * Disco Battle — two lanes running out from the middle of the device to a platform at each end.
 *
 * `rules.ts` owns the whole simulation and states every quantity in seconds. This file is the
 * only place a unit of board exists, and it earns its keep by turning one number —
 * {@link APPROACH_SPEED} — into the entire picture: a note's distance from a platform *is* the
 * time left before it lands, and the two timing windows are drawn as bands of exactly the
 * height those tolerances are worth.
 *
 * ## Everything here has to be readable with the sound off, because there is no sound
 *
 * The engine has an audio system and nothing is wired to it; no sound file exists in this
 * repository (#168, #169, #170). A rhythm game is the worst case for that, so this one is
 * designed as if audio were never coming:
 *
 * - **The beat is a moving shape, not a click.** A note travels a lane of fixed length at a
 *   fixed speed, so the gap between it and the platform is a linear picture of the seconds
 *   left. Reading it is the game.
 * - **The tolerance is a band, not a number.** `PERFECT_SECONDS x APPROACH_SPEED` is 13.5
 *   units and `GOOD_SECONDS x APPROACH_SPEED` is 32.4, and both are drawn at that size
 *   straddling the platform. A player is never told a window in milliseconds; they are shown
 *   the shape they have to land inside.
 * - **Every judgement leaves a mark of its own shape** in the gutter behind the platform, and
 *   a press that scored also drops a marker at the point on the lane where it actually landed
 *   — so a player learns *which way* they were wrong without a word of text or a note of sound.
 *
 * ## Rule 7: the two seats are two different primitives, everywhere, with no exception
 *
 * The board is its own half-turn image, and `greyscale.test.ts` throws away position and
 * rotation before it compares the seats — so "seat one is the lane at the bottom" is, to that
 * harness, no distinction at all. What separates them is the silhouette:
 *
 * - **every mark drawn in one of seat one's four palette colours is a circle**, and
 * - **every mark drawn in one of seat two's four palette colours is a square.**
 *
 * That holds for platforms, notes, judgement marks and press markers alike, and it is stated
 * as an invariant rather than a habit because the harness's evidence collapses the moment the
 * other seat draws the same primitive even once. `game.test.ts` asserts it over a whole match:
 * no seat-coloured `rect` is ever drawn for seat one, and no seat-coloured `circle` for seat
 * two. Everything else on the board — lanes, bands, the platform line, the clock — is neutral
 * and shared, because it belongs to neither player.
 */

/* ------------------------------------------------------------------- the board */

const BOARD_WIDTH = 600;
const BOARD_HEIGHT = 1000;
const CENTRE_Y = BOARD_HEIGHT / 2;

/**
 * How long a lane is, and therefore how fast a note travels it.
 *
 * The **only** conversion between the simulation and the board in the whole game. A note is
 * born on the centre line at `approach = 1` and lands on a platform at `approach = 0`, so
 * `APPROACH_SECONDS` of music is exactly `LANE_SPAN` of board and a note's height above the
 * platform is its remaining time to the pixel. Every other length below is derived from it or
 * is chrome.
 */
const LANE_SPAN = 360;
const APPROACH_SPEED = LANE_SPAN / APPROACH_SECONDS;

const PLATFORM_Y_P1 = CENTRE_Y + LANE_SPAN;
const PLATFORM_Y_P2 = CENTRE_Y - LANE_SPAN;

const LANE_LEFT = 84;
const LANE_WIDTH = 432;
const LANE_CENTRE_X = LANE_LEFT + LANE_WIDTH / 2;
/** How far the two outer receptors sit from the middle of a lane. */
const LANE_ARM = 150;

/** The two windows, at the size the player is actually being asked for. */
const PERFECT_BAND = PERFECT_SECONDS * APPROACH_SPEED;
const GOOD_BAND = GOOD_SECONDS * APPROACH_SPEED;

/**
 * How far past its platform a note is still drawn, as a fraction of the lane.
 *
 * Bounded by the board rather than by taste: `0.3 x 360` is 108 units, which puts the far
 * edge of a departing note at 977 on seat one's side and 23 on seat two's, inside the logical
 * box with room to spare. `cross-viewport.test.ts` records every number that reaches the
 * renderer, so a note that scrolled off the bottom would be a failure rather than a smudge.
 */
const NOTE_EXIT = -0.3;

/* ------------------------------------------------------------------- the marks */

const NOTE_MAIN = 21;
const NOTE_ARM = 12;
/** Seat two's square drawn at the same **area** as seat one's disc: `sqrt(pi) / 2`. */
const SQUARE = Math.sqrt(Math.PI) / 2;

const HUB_MAIN = 26;
const HUB_ARM = 15;

/** Where a judgement mark sits, measured out from the platform past the good band. */
const GUTTER = 64;
const PIP = 11;
const PIP_GAP = 34;

/* ----------------------------------------------------------------- the colours */

/**
 * Nothing here is a seat colour, and that is load-bearing rather than tidy.
 *
 * `greyscale.test.ts` attributes a mark to a seat by an exact palette string, so every
 * neutral tone below is a mark that belongs to the board rather than to a player — which is
 * what the lanes, the windows and the clock actually are. Both seats are asked for the same
 * tolerance, so the bands must look the same on both sides of the device.
 */
const COLOUR_FLOOR = '#0b0b16';
const COLOUR_LANE = '#191932';
const COLOUR_BAND_GOOD = '#2c2c55';
const COLOUR_BAND_PERFECT = '#474789';
const COLOUR_BEAT_LINE = '#dcdcf4';
const COLOUR_STAGE = '#23233f';
const COLOUR_CHALK = 'rgba(226, 232, 248, 0.5)';
const COLOUR_GRID = 'rgba(226, 232, 248, 0.16)';

/* --------------------------------------------------------------- the seat sign */

/**
 * Which way a lane runs. Seat one's notes travel down the board, seat two's up.
 *
 * A sign rather than a branch, so the two lanes are one piece of arithmetic evaluated twice
 * and there is no second copy of the geometry to drift. `PLATFORM_Y_P2 = 1000 - PLATFORM_Y_P1`
 * exactly, so the board is its own half-turn image and neither seat can be shown a note a
 * moment sooner than the other (rule 9).
 */
function platformYOf(seat: SeatId): number {
  return seat === 'p1' ? PLATFORM_Y_P1 : PLATFORM_Y_P2;
}

function laneSignOf(seat: SeatId): number {
  return seat === 'p1' ? 1 : -1;
}

export class DiscoBattleGame implements Game {
  readonly #state: State = createState();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  /**
   * Three streams from the one seed the shell hands over.
   *
   * The track has its own, so the music is a function of the match seed and never of how many
   * values a tier happened to draw — two `hard` bots and two `easy` ones must be able to play
   * the *same* forty seconds, or a tier comparison is comparing two different songs. Each seat
   * then has its own for the reason Snowball Throw gives: on one shared stream whichever seat
   * is polled first takes the earlier value every time, which is a seat bias dressed as chance.
   *
   * **Which of the two seat streams goes to which seat is decided by `openingSeat`.** See
   * {@link DiscoBattleGame.init}.
   */
  #trackRng = new Rng(1);
  #botP1Rng = new Rng(2);
  #botP2Rng = new Rng(3);

  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #ready = false;

  /**
   * The last fixed delta, kept only so `render` can place a note between two steps.
   *
   * A note moves three units a step, which strobes visibly on a display running above the
   * simulation rate — and the note is the one object a player is watching. Read in `render`
   * and nowhere else; nothing in the simulation depends on it.
   */
  #delta = 1 / 60;

  /** Read-only view for the harness and the tests. Never mutate through it. */
  get state(): Readonly<State> {
    return this.#state;
  }

  init(context: GameContext): void {
    this.#trackRng = new Rng(context.rng.next() | 0);
    // The two seat streams are drawn in a fixed order and then handed out **by role rather
    // than by seat**. This is the whole of `openingSeat` in this game, and it is worth the
    // three lines.
    //
    // A real-time game has no opener and the contract says it may ignore the field — but the
    // shell alternates it across the rounds of a best-of precisely so that whatever is
    // asymmetric between the two seats washes out, and in this game exactly one thing is:
    // the *order* the two bot streams are drawn in. Everything else the two seats touch is
    // shared — one track, one clock, one cursor — and `rules.test.ts` proves that swapping
    // the two streams mirrors the match exactly, 0 mismatches in 360. So handing them out by
    // the opener makes a pair of rounds an exact complement of each other, and seat one's
    // share over any seed set 50.0% by construction rather than 50-ish by sampling.
    //
    // It is not decoration. `balance-aggregate.test.ts` plays each seed once from each
    // opener, so before this the two halves of a pair were the *same* match counted twice
    // and the fifty-seed push sample read seat one at 64.0% at `hard`. With it, the sample
    // is 50.0% exactly, at every tier and every sample size. That is Maze Paint's lesson —
    // aim for a symmetry proof rather than a 50% measurement — applied to the one asymmetry
    // this game has left.
    const first = new Rng(context.rng.next() | 0);
    const second = new Rng(context.rng.next() | 0);
    const openerLeads = context.openingSeat === 'p1';
    this.#botP1Rng = openerLeads ? first : second;
    this.#botP2Rng = openerLeads ? second : first;
    // Presentation and local seat are snapshotted here and never read again outside `render`.
    // A simulation that consulted either would step two different matches on two devices,
    // which is what `presentation-parity.test.ts` exists to catch.
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#ready = true;
    this.#delta = 1 / 60;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetState(this.#state, this.#trackRng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (!this.#ready) return;
    if (this.#state.winner !== null) return;
    this.#delta = fixedDeltaSeconds;

    // Both seats are read before either is judged, and neither read can see the other, so the
    // order of these two lines cannot matter. That is the whole of the seat symmetry.
    const pressP1 = this.#pressOf('p1', input, fixedDeltaSeconds);
    const pressP2 = this.#pressOf('p2', input, fixedDeltaSeconds);
    step(this.#state, fixedDeltaSeconds, pressP1, pressP2);
  }

  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer, alpha = 0): void {
    renderer.clear(COLOUR_FLOOR);
    // In single-seat play the local player owns the whole viewport, so the board is turned to
    // put their own lane under their thumb. Presentation only: `update` never sees this, and
    // the two seats still see exactly as much of the track as each other (rule 9).
    renderer.pushSeatRotation(this.#presentation === 'single-seat' && this.#localSeat === 'p2');

    this.#drawStage(renderer);
    this.#drawClock(renderer);
    this.#drawLane(renderer, 'p1');
    this.#drawLane(renderer, 'p2');
    this.#drawNotes(renderer, 'p1', alpha);
    this.#drawNotes(renderer, 'p2', alpha);
    this.#drawPlatform(renderer, 'p1');
    this.#drawPlatform(renderer, 'p2');
    this.#drawJudgement(renderer, 'p1');
    this.#drawJudgement(renderer, 'p2');

    renderer.popSeatRotation();
  }

  onPause(): void {}

  onResume(): void {
    // Nothing to settle. The engine derives a press from an edge, so an action still held down
    // across a pause cannot read as a fresh tap on the step play resumes.
  }

  getScore(): MatchScore {
    return { p1: this.#state.p1.score, p2: this.#state.p2.score, winner: this.#state.winner };
  }

  destroy(): void {
    this.#ready = false;
    this.#botP1 = null;
    this.#botP2 = null;
    this.#delta = 1 / 60;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetState(this.#state, this.#trackRng);
  }

  /* ------------------------------------------------------------------ driving */

  /**
   * One bit for one seat: the whole of this game's input.
   *
   * A bot goes through the same bit a person does — it cannot press half a note early or read
   * a window a player cannot see — so rule 6 is not a policy here, there is simply nowhere for
   * a bot to be told anything extra.
   */
  #pressOf(seat: SeatId, input: InputState, fixedDeltaSeconds: number): boolean {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const bot = seat === 'p1' ? this.#botP1State : this.#botP2State;
      const rng = seat === 'p1' ? this.#botP1Rng : this.#botP2Rng;
      return driveBot(this.#state, difficulty, bot, rng, fixedDeltaSeconds);
    }
    // Not the pointer position, not the move vector, not the hold. A tap anywhere in your own
    // half and a press of your own key are the same event, which is why this game is fair
    // across every input family without a caveat.
    return input.seat(seat).actionPressed;
  }

  /* ------------------------------------------------------------------ drawing */

  /**
   * Where a note is on the board, part-way between two steps.
   *
   * The clock is nudged by `alpha` deltas rather than the note's position being lerped between
   * two remembered ones, because a note's place *is* a function of the clock — so there is one
   * arithmetic here rather than two that have to agree, and a note that has just been created
   * needs no special case.
   */
  #approachAt(note: number, alpha: number): number {
    return approachOf(this.#state, note) - (alpha * this.#delta) / APPROACH_SECONDS;
  }

  #noteYOf(seat: SeatId, approach: number): number {
    return platformYOf(seat) - laneSignOf(seat) * approach * LANE_SPAN;
  }

  /** The strip the notes are born on, shared and exactly between the two seats. */
  #drawStage(renderer: Renderer): void {
    renderer.rect(0, CENTRE_Y - 9, BOARD_WIDTH, 18, COLOUR_STAGE);
    renderer.line(LANE_LEFT, CENTRE_Y, LANE_LEFT + LANE_WIDTH, CENTRE_Y, 2, COLOUR_GRID);
  }

  /**
   * How much of the track is left, as two bars on the side margins growing out from the middle.
   *
   * One object, symmetric under the half-turn, so neither player is nearer to it than the
   * other. The shell has no idea this match has a clock — `roundSeconds` is a catalogue label
   * — so the game shows its own, once.
   */
  #drawClock(renderer: Renderer): void {
    const half = 430 * remainingOf(this.#state);
    renderer.rect(30, CENTRE_Y - half, 12, half * 2, COLOUR_CHALK);
    renderer.rect(BOARD_WIDTH - 42, CENTRE_Y - half, 12, half * 2, COLOUR_CHALK);
  }

  /**
   * A lane, and the two windows drawn at the size they are worth.
   *
   * This is the game's answer to having no audio. The outer band is `GOOD_SECONDS` of board
   * either side of the beat and the inner one is `PERFECT_SECONDS`, so a player is shown the
   * tolerance rather than told it — and the same two bands appear on both sides of the device
   * because both seats are asked for the same thing.
   */
  #drawLane(renderer: Renderer, seat: SeatId): void {
    const platform = platformYOf(seat);
    const sign = laneSignOf(seat);
    const top = Math.min(CENTRE_Y, platform + sign * GOOD_BAND);
    const bottom = Math.max(CENTRE_Y, platform + sign * GOOD_BAND);
    renderer.rect(LANE_LEFT, top, LANE_WIDTH, bottom - top, COLOUR_LANE);

    renderer.rect(LANE_LEFT, platform - GOOD_BAND, LANE_WIDTH, GOOD_BAND * 2, COLOUR_BAND_GOOD);
    renderer.rect(
      LANE_LEFT,
      platform - PERFECT_BAND,
      LANE_WIDTH,
      PERFECT_BAND * 2,
      COLOUR_BAND_PERFECT,
    );
    // The beat itself: one bright line, dead centre of both bands.
    renderer.line(LANE_LEFT, platform, LANE_LEFT + LANE_WIDTH, platform, 3, COLOUR_BEAT_LINE);
  }

  /**
   * The notes on one lane, drawn in that seat's own primitive.
   *
   * Both seats are drawn the identical stream — `arrivals` is one array — so what differs
   * between the two lanes is only what each player has already answered: a note still live is
   * filled, a note taken is an outline at full size, and a note let go is an outline shrunk to
   * a little over half. Three states, three silhouettes, no colour needed to tell them apart.
   */
  #drawNotes(renderer: Renderer, seat: SeatId, alpha: number): void {
    const judged = judgedBy(this.#state, seat);
    for (let note = firstDrawable(this.#state); note < NOTE_COUNT; note += 1) {
      const approach = this.#approachAt(note, alpha);
      if (approach > 1) break;
      if (approach < NOTE_EXIT) continue;
      const verdict = judged[note];
      if (verdict === undefined) continue;
      this.#drawNote(renderer, seat, this.#noteYOf(seat, approach), verdict);
    }
  }

  #drawNote(renderer: Renderer, seat: SeatId, y: number, judgement: string): void {
    const palette = SEAT_PALETTE[seat];
    const live = judgement === 'none';
    const scale = judgement === 'missed' ? 0.55 : 1;
    const main = NOTE_MAIN * scale;
    const arm = NOTE_ARM * scale;

    if (seat === 'p1') {
      if (live) {
        renderer.circle(LANE_CENTRE_X, y, main, palette.base);
        renderer.circle(LANE_CENTRE_X - LANE_ARM, y, arm, palette.deep);
        renderer.circle(LANE_CENTRE_X + LANE_ARM, y, arm, palette.deep);
        return;
      }
      renderer.strokeCircle(LANE_CENTRE_X, y, main, 4, palette.soft);
      renderer.strokeCircle(LANE_CENTRE_X - LANE_ARM, y, arm, 3, palette.soft);
      renderer.strokeCircle(LANE_CENTRE_X + LANE_ARM, y, arm, 3, palette.soft);
      return;
    }

    const mainHalf = main * SQUARE;
    const armHalf = arm * SQUARE;
    if (live) {
      renderer.rect(
        LANE_CENTRE_X - mainHalf,
        y - mainHalf,
        mainHalf * 2,
        mainHalf * 2,
        palette.base,
      );
      renderer.rect(
        LANE_CENTRE_X - LANE_ARM - armHalf,
        y - armHalf,
        armHalf * 2,
        armHalf * 2,
        palette.deep,
      );
      renderer.rect(
        LANE_CENTRE_X + LANE_ARM - armHalf,
        y - armHalf,
        armHalf * 2,
        armHalf * 2,
        palette.deep,
      );
      return;
    }
    renderer.strokeRect(
      LANE_CENTRE_X - mainHalf,
      y - mainHalf,
      mainHalf * 2,
      mainHalf * 2,
      4,
      palette.soft,
    );
    renderer.strokeRect(
      LANE_CENTRE_X - LANE_ARM - armHalf,
      y - armHalf,
      armHalf * 2,
      armHalf * 2,
      3,
      palette.soft,
    );
    renderer.strokeRect(
      LANE_CENTRE_X + LANE_ARM - armHalf,
      y - armHalf,
      armHalf * 2,
      armHalf * 2,
      3,
      palette.soft,
    );
  }

  /**
   * A seat's three receptors, in that seat's primitive, on screen from the first frame.
   *
   * They are the shape a note has to land on, drawn the same way the note is, so what a player
   * is being asked to do is a matching game rather than a rule to be told. Never conditional
   * on anything: `greyscale.test.ts` can only compare a frame where both seats drew something,
   * and a receptor that appeared only after a press would hand it nothing to compare.
   */
  #drawPlatform(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const y = platformYOf(seat);
    if (seat === 'p1') {
      renderer.strokeCircle(LANE_CENTRE_X, y, HUB_MAIN, 5, palette.base);
      renderer.circle(LANE_CENTRE_X, y, HUB_MAIN - 12, palette.deep);
      renderer.strokeCircle(LANE_CENTRE_X - LANE_ARM, y, HUB_ARM, 4, palette.base);
      renderer.strokeCircle(LANE_CENTRE_X + LANE_ARM, y, HUB_ARM, 4, palette.base);
      return;
    }
    const hub = HUB_MAIN * SQUARE;
    const arm = HUB_ARM * SQUARE;
    const core = (HUB_MAIN - 12) * SQUARE;
    renderer.strokeRect(LANE_CENTRE_X - hub, y - hub, hub * 2, hub * 2, 5, palette.base);
    renderer.rect(LANE_CENTRE_X - core, y - core, core * 2, core * 2, palette.deep);
    renderer.strokeRect(LANE_CENTRE_X - LANE_ARM - arm, y - arm, arm * 2, arm * 2, 4, palette.base);
    renderer.strokeRect(LANE_CENTRE_X + LANE_ARM - arm, y - arm, arm * 2, arm * 2, 4, palette.base);
  }

  /**
   * What the last thing this seat did was worth, and where its press actually landed.
   *
   * Four judgements, four silhouettes, and the count is the points: three pips for a perfect,
   * one for a good, one hollow ring for a note let go, two concentric rings for a press that
   * answered nothing. Nothing here is told apart by colour, and there is no text on the board
   * at all — which is what makes the game playable in greyscale and in any language.
   *
   * The pair of markers on the lane is the other half of it. A scoring press drops them at
   * `lastOffset x APPROACH_SPEED` from the beat line — the exact place on the lane the note
   * was standing when the press landed — so "you were early" is shown as a position rather
   * than asserted as a word.
   */
  #drawJudgement(renderer: Renderer, seat: SeatId): void {
    const side = sideOf(this.#state, seat);
    if (side.flash <= 0) return;
    const verdict: Verdict = side.verdict;
    if (verdict === 'none') return;

    const palette = SEAT_PALETTE[seat];
    const sign = laneSignOf(seat);
    const y = platformYOf(seat) + sign * GUTTER;
    const round = seat === 'p1';

    if (verdict === 'perfect' || verdict === 'good') {
      const pips = verdict === 'perfect' ? 3 : 1;
      const first = LANE_CENTRE_X - ((pips - 1) * PIP_GAP) / 2;
      for (let i = 0; i < pips; i += 1) {
        const x = first + i * PIP_GAP;
        if (round) renderer.circle(x, y, PIP, palette.base);
        else {
          const h = PIP * SQUARE;
          renderer.rect(x - h, y - h, h * 2, h * 2, palette.base);
        }
      }
      this.#drawOffsetMarks(renderer, seat, side.lastOffset);
      return;
    }

    // A note let go: one hollow ring where a pip would have been.
    if (verdict === 'missed') {
      if (round) renderer.strokeCircle(LANE_CENTRE_X, y, 15, 5, palette.deep);
      else {
        const h = 15 * SQUARE;
        renderer.strokeRect(LANE_CENTRE_X - h, y - h, h * 2, h * 2, 5, palette.deep);
      }
      return;
    }

    // A press that answered nothing: two rings, one inside the other, and no pip at all.
    if (round) {
      renderer.strokeCircle(LANE_CENTRE_X, y, 17, 4, palette.deep);
      renderer.strokeCircle(LANE_CENTRE_X, y, 9, 4, palette.deep);
      return;
    }
    const outer = 17 * SQUARE;
    const inner = 9 * SQUARE;
    renderer.strokeRect(LANE_CENTRE_X - outer, y - outer, outer * 2, outer * 2, 4, palette.deep);
    renderer.strokeRect(LANE_CENTRE_X - inner, y - inner, inner * 2, inner * 2, 4, palette.deep);
  }

  /**
   * Two small marks on the lane at the moment the press landed, one each side of the receptor.
   *
   * `lastOffset` is at most {@link GOOD_SECONDS}, so these never leave the good band and never
   * leave the board. Symmetric about the middle of the lane so the pair reads as a single
   * height rather than as an object with a side.
   */
  #drawOffsetMarks(renderer: Renderer, seat: SeatId, offsetSeconds: number): void {
    const y = platformYOf(seat) + laneSignOf(seat) * offsetSeconds * APPROACH_SPEED;
    const palette = SEAT_PALETTE[seat];
    const left = LANE_CENTRE_X - 74;
    const right = LANE_CENTRE_X + 74;
    if (seat === 'p1') {
      renderer.circle(left, y, 7, palette.base);
      renderer.circle(right, y, 7, palette.base);
      return;
    }
    const h = 7 * SQUARE;
    renderer.rect(left - h, y - h, h * 2, h * 2, palette.base);
    renderer.rect(right - h, y - h, h * 2, h * 2, palette.base);
  }
}

/** Exported for the render tests, which assert a flash outlives exactly one step and no more. */
export const FLASH_STEPS = Math.ceil(FLASH_SECONDS * 60);
