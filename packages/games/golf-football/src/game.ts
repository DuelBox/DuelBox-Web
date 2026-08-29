import { Rng, SEAT_PALETTE, SeatFlip, seatRotated } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  AIM_DEADLINE,
  APRON_RADIUS,
  BALL_RADIUS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CENTRE_X,
  CENTRE_Y,
  CUP_RADIUS,
  GATE_HALF,
  KICKS_EACH,
  MID_GOAL,
  PITCH_BOTTOM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  POSTS,
  POST_RADIUS,
  RANGE_GOAL,
  TAP_GOAL,
  WIND_DEADLINE,
  BOT_PROFILES,
  ballOf,
  createBotRngs,
  createBotState,
  createMatch,
  driveBot,
  kicksLeftOf,
  pressAim,
  reachOf,
  release,
  resetBotState,
  resetMatch,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Match } from './rules.js';

/**
 * Golf Football — the pitch, the two dials, and nothing else.
 *
 * Nothing here is dragged and nothing is pointed at: the whole game is `actionPressed`,
 * `actionHeld` and `actionReleased`, so a key and a thumb are the same instrument and the
 * precision envelope has nothing to level. What the drawing has to do is turn two abstract
 * dials into one picture — the needle is the line the ball will take, and the marker running
 * out along it while the gauge fills is where the ball will stop. Neither is a bar whose
 * number a player would have to translate into a position on the pitch.
 *
 * The simulation is entirely in `rules.ts`, including the turn state machine, so that
 * shared-screen and single-seat play step the identical match by construction rather than by
 * inspection. This file feeds it two booleans and draws what comes out.
 */

const COLOUR_SURROUND = '#0a1410';
const COLOUR_TURF = '#1e6b3f';
const COLOUR_MOWN = 'rgba(255, 255, 255, 0.055)';
const COLOUR_LINE = 'rgba(236, 248, 238, 0.5)';
const COLOUR_FAINT = 'rgba(236, 248, 238, 0.22)';
const COLOUR_CUP = '#0a1a11';
const COLOUR_CUP_RIM = 'rgba(236, 248, 238, 0.75)';
const COLOUR_POST = '#efe6cf';
const COLOUR_BOARD = '#132019';
const COLOUR_TEXT = '#eef6ef';
const COLOUR_MUTED = 'rgba(238, 246, 239, 0.62)';
const COLOUR_GUIDE = 'rgba(244, 240, 226, 0.55)';
const COLOUR_HALO = 'rgba(250, 250, 235, 0.85)';

/** How far the needle is drawn while it is still sweeping. An intention, not a distance. */
const NEEDLE_LENGTH = 190;
/** Spacing of the dashes along the aim line, and how long each dash is. */
const DASH_GAP = 26;
const DASH_LENGTH = 13;
/** Mown stripes, drawn symmetrically about the centre so both seats read the same turf. */
const STRIPE_GAP = 74;

const CARD_Y = 52;
const CARD_SUB_Y = 92;
const BOARD_TOP = PITCH_BOTTOM + 14;

export class GolfFootballGame implements Game {
  readonly #match: Match = createMatch();
  readonly #flip = new SeatFlip();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  #botRng: { p1: Rng; p2: Rng } = { p1: new Rng(1), p2: new Rng(2) };
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;
  /** What just happened, for the card. Never a turn banner — the shell owns that. */
  #event = '';

  get match(): Match {
    return this.#match;
  }

  get event(): string {
    return this.#event;
  }

  /**
   * Whose turn it is.
   *
   * The shell decides a game is turn-based by the presence of this method, and only then
   * does it hand the whole board to the active seat and map both keyboard halves onto them.
   */
  getActiveSeat(): SeatId {
    return this.#match.seat;
  }

  init(context: GameContext): void {
    // A generator per seat, both drawn from the match's own before anything else touches it.
    this.#botRng = createBotRngs(context.rng);
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    this.#event = '';
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    // The SDK alternates who opens across the rounds of a best-of so first-mover advantage
    // washes out. A `turn-*` game reads it rather than assuming `p1` (issue #2466).
    resetMatch(this.#match, context.openingSeat);
    this.#flip.snap(this.#shouldRotate());
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    // Stepped before the early return, so the pitch finishes turning to face the winner
    // rather than freezing half way round.
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#winner !== null) return;

    this.#take(input, fixedDeltaSeconds);
    const result = step(this.#match, fixedDeltaSeconds);
    if (result.settled) {
      this.#event = result.goal === null ? '' : (GOAL_WORDS[result.goalValue] ?? '');
    }
    this.#winner = winnerOf(this.#match);
  }

  #take(input: InputState, fixedDeltaSeconds: number): void {
    const seat = this.#match.seat;
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;

    if (difficulty !== null) {
      const state = seat === 'p1' ? this.#botP1State : this.#botP2State;
      const profile = BOT_PROFILES[difficulty];
      driveBot(this.#match, seat, profile, state, this.#botRng[seat], fixedDeltaSeconds);
      return;
    }

    // Nothing is accepted while the pitch is part-way round: the needle a player is reading
    // is moving under them, so a press would name a moment they did not mean. The rules'
    // ready freeze is what makes this cost nothing — the dials are parked for longer than
    // the turn takes, for a bot as much as for a person.
    if (!this.#flip.acceptsInput) return;
    const view = input.seat(seat);
    // Two `if`s and not an `else if`. Most taps arrive with the press and the release on the
    // same step, and a release read as the else-branch of a press means only a deliberate
    // hold ever kicks. Here a same-step tap is the feeblest legal kick, which is right.
    if (view.actionPressed) pressAim(this.#match, seat);
    if (view.actionReleased) release(this.#match, seat);
  }

  #shouldRotate(): boolean {
    // `seatView` is the one definition of when a seat reads the board upside down.
    return seatRotated(this.#match.seat, this.#presentation, this.#localSeat);
  }

  getScore(): MatchScore {
    return { p1: this.#match.points.p1, p2: this.#match.points.p2, winner: this.#winner };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetMatch(this.#match, 'p1');
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
    this.#event = '';
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks against
  // the class as well as against `Game`. This game does not interpolate between fixed steps,
  // so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_SURROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawPitch(renderer);
    this.#drawGoal(renderer);
    this.#drawAim(renderer);
    this.#drawBalls(renderer);
    this.#drawCard(renderer);
    this.#drawScoreboard(renderer);
    renderer.popSeatRotation();
  }

  /**
   * The turf, mown in stripes drawn symmetrically about the centre.
   *
   * Symmetric on purpose: the pitch turns half a turn between the seats, and a stripe pattern
   * that was not invariant under that turn would give the two players different-looking
   * ground for the identical position.
   */
  #drawPitch(renderer: Renderer): void {
    renderer.rect(
      PITCH_LEFT,
      PITCH_TOP,
      PITCH_RIGHT - PITCH_LEFT,
      PITCH_BOTTOM - PITCH_TOP,
      COLOUR_TURF,
    );
    for (let offset = STRIPE_GAP; offset < CENTRE_Y - PITCH_TOP; offset += STRIPE_GAP) {
      renderer.line(PITCH_LEFT, CENTRE_Y - offset, PITCH_RIGHT, CENTRE_Y - offset, 6, COLOUR_MOWN);
      renderer.line(PITCH_LEFT, CENTRE_Y + offset, PITCH_RIGHT, CENTRE_Y + offset, 6, COLOUR_MOWN);
    }
    renderer.strokeRect(
      PITCH_LEFT,
      PITCH_TOP,
      PITCH_RIGHT - PITCH_LEFT,
      PITCH_BOTTOM - PITCH_TOP,
      4,
      COLOUR_FAINT,
    );
    // The apron: inside this ring a goal is a tap-in worth one, outside it worth two. Drawn
    // at its real radius so what the scoring asks for is on the pitch rather than explained.
    renderer.strokeCircle(CENTRE_X, CENTRE_Y, APRON_RADIUS, 3, COLOUR_FAINT);
  }

  /** The cup and its two posts. */
  #drawGoal(renderer: Renderer): void {
    renderer.strokeRect(
      CENTRE_X - GATE_HALF - 40,
      CENTRE_Y - 62,
      GATE_HALF * 2 + 80,
      124,
      3,
      COLOUR_LINE,
    );
    renderer.circle(CENTRE_X, CENTRE_Y, CUP_RADIUS, COLOUR_CUP);
    renderer.strokeCircle(CENTRE_X, CENTRE_Y, CUP_RADIUS, 4, COLOUR_CUP_RIM);
    for (const post of POSTS) {
      renderer.circle(post.x, post.y, POST_RADIUS, COLOUR_POST);
      renderer.strokeCircle(post.x, post.y, POST_RADIUS, 3, COLOUR_CUP);
    }
  }

  /**
   * The two dials, drawn as the kick they describe.
   *
   * While the needle sweeps, the line is the line the ball will take. Once the line is kept
   * and the gauge is filling, a marker runs out along it to exactly where the ball would
   * stop — so the second dial is the stopping point sliding up the pitch rather than a bar
   * whose number has to be translated into a distance.
   *
   * Drawn in ink rather than in a seat colour: the shell owns the turn indicator, and a
   * seat-coloured mark that is only ever on screen for half the frames is a rule 7 signal
   * that flickers.
   */
  #drawAim(renderer: Renderer): void {
    const phase = this.#match.phase;
    if (phase !== 'aiming' && phase !== 'winding') return;
    const ball = ballOf(this.#match, this.#match.seat);
    const angle =
      this.#match.aimBase + (phase === 'aiming' ? this.#match.aim : this.#match.lockedAim);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const wanted = phase === 'aiming' ? NEEDLE_LENGTH : reachOf(this.#match.power);
    const reach = lengthInside(ball.x, ball.y, dx, dy, wanted);

    // The line the needle sweeps around. Without it the gauge has no visible zero, and a
    // player would be reading an offset off a reference they had to imagine.
    const toCup = Math.atan2(CENTRE_Y - ball.y, CENTRE_X - ball.x);
    renderer.line(
      ball.x + Math.cos(toCup) * (BALL_RADIUS + 6),
      ball.y + Math.sin(toCup) * (BALL_RADIUS + 6),
      CENTRE_X,
      CENTRE_Y,
      2,
      COLOUR_FAINT,
    );

    for (let at = BALL_RADIUS + 8; at < reach; at += DASH_GAP) {
      const to = Math.min(at + DASH_LENGTH, reach);
      renderer.line(
        ball.x + dx * at,
        ball.y + dy * at,
        ball.x + dx * to,
        ball.y + dy * to,
        4,
        COLOUR_GUIDE,
      );
    }
    if (phase !== 'winding') return;
    // Where the ball would come to rest, at the weight the gauge has reached.
    renderer.strokeCircle(
      ball.x + dx * reach,
      ball.y + dy * reach,
      BALL_RADIUS + 5,
      3,
      COLOUR_GUIDE,
    );
  }

  /**
   * Rule 7 for the balls: seat one is a disc with a ring inside it, seat two a disc with a
   * cross across it, so the two are told apart with every colour removed. The ball to be
   * kicked wears a halo — drawn in ink, because it is a fact about the turn and not about
   * who owns the ball.
   */
  #drawBalls(renderer: Renderer): void {
    for (const seat of SEATS) {
      const ball = ballOf(this.#match, seat);
      const palette = SEAT_PALETTE[seat];
      if (seat === this.#match.seat && this.#match.phase !== 'over') {
        renderer.strokeCircle(ball.x, ball.y, BALL_RADIUS + 7, 3, COLOUR_HALO);
      }
      renderer.circle(ball.x, ball.y, BALL_RADIUS, palette.base);
      seatMark(renderer, seat, ball.x, ball.y, BALL_RADIUS * 0.55, palette.deep);
    }
  }

  /**
   * How long is left of the turn, as a bar on the kicker's own edge.
   *
   * Both deadlines are backstops rather than a shot clock — they exist so a match moves with
   * nobody touching the device, which `input-fuzz.test.ts` requires — but a deadline that
   * fired invisibly would take a person's kick away without warning. So it is drawn: full
   * while the dials are frozen, then running down through the sweep and again through the
   * fill. Nothing reads it back; it is presentation over simulation state.
   */
  #drawTurnClock(renderer: Renderer): void {
    const phase = this.#match.phase;
    let left: number;
    if (phase === 'ready') left = 1;
    else if (phase === 'aiming') left = 1 - this.#match.clock / AIM_DEADLINE;
    else if (phase === 'winding') left = 1 - this.#match.clock / WIND_DEADLINE;
    else return;
    const width = Math.max(0, Math.min(1, left)) * (BOARD_WIDTH - 32);
    renderer.rect(16, BOARD_TOP + 8, BOARD_WIDTH - 32, 5, COLOUR_FAINT);
    renderer.rect(16, BOARD_TOP + 8, width, 5, COLOUR_TEXT);
  }

  /** The card: which kick this is, and what the last one did. */
  #drawCard(renderer: Renderer): void {
    const kick = Math.min(this.#match.kicks + 1, KICKS_EACH * 2);
    const card = `KICK ${String(kick)} OF ${String(KICKS_EACH * 2)}`;
    renderer.text(card, CENTRE_X, CARD_Y, 30, COLOUR_TEXT, 'centre');
    if (this.#event !== '') {
      renderer.text(this.#event, CENTRE_X, CARD_SUB_Y, 24, COLOUR_MUTED, 'centre');
    }
  }

  /**
   * Points, long goals and kicks left, one row a seat.
   *
   * Goals from range are on the board because they are the first tiebreak: a player level on
   * points can see which way it will go. Each row carries its seat's own shape, the same one
   * its ball carries, so the row and the ball are the same player without reading a colour.
   */
  #drawScoreboard(renderer: Renderer): void {
    renderer.rect(0, BOARD_TOP, BOARD_WIDTH, BOARD_HEIGHT - BOARD_TOP, COLOUR_BOARD);
    this.#drawTurnClock(renderer);
    for (const seat of SEATS) {
      const palette = SEAT_PALETTE[seat];
      const y = BOARD_TOP + (seat === 'p1' ? 36 : 84);
      renderer.circle(40, y, 15, palette.base);
      seatMark(renderer, seat, 40, y, 8, palette.deep);
      const points = seat === 'p1' ? this.#match.points.p1 : this.#match.points.p2;
      const range = seat === 'p1' ? this.#match.rangeGoals.p1 : this.#match.rangeGoals.p2;
      renderer.text(`${String(points)} pts`, 72, y, 27, COLOUR_TEXT);
      renderer.text(`${String(range)} from range`, 200, y, 23, COLOUR_MUTED);
      const left = kicksLeftOf(this.#match, seat);
      renderer.text(`${String(left)} kicks left`, BOARD_WIDTH - 20, y, 23, COLOUR_MUTED, 'right');
    }
  }
}

const SEATS: readonly SeatId[] = Object.freeze(['p1', 'p2']);

/**
 * What the card says about a goal, by what it was worth.
 *
 * Indexed by the point value so the words and the score cannot drift apart, which is what
 * happens the moment a second `if` decides the same thing twice.
 */
const GOAL_WORDS: Readonly<Record<number, string>> = Object.freeze({
  [RANGE_GOAL]: 'FROM RANGE  +3',
  [MID_GOAL]: 'IN THE CUP  +2',
  [TAP_GOAL]: 'TAPPED IN  +1',
});

/** Seat one is a ring inside its disc and seat two a cross. Rule 7, in one place. */
function seatMark(
  renderer: Renderer,
  seat: SeatId,
  x: number,
  y: number,
  size: number,
  colour: string,
): void {
  if (seat === 'p1') {
    renderer.strokeCircle(x, y, size, 3, colour);
    return;
  }
  renderer.line(x - size, y - size, x + size, y + size, 3, colour);
  renderer.line(x + size, y - size, x - size, y + size, 3, colour);
}

/** How far a ray from a point may run before it leaves the pitch. Nothing is drawn off it. */
function lengthInside(x: number, y: number, dx: number, dy: number, wanted: number): number {
  let reach = wanted;
  if (dx > 0) reach = Math.min(reach, (PITCH_RIGHT - BALL_RADIUS - x) / dx);
  if (dx < 0) reach = Math.min(reach, (PITCH_LEFT + BALL_RADIUS - x) / dx);
  if (dy > 0) reach = Math.min(reach, (PITCH_BOTTOM - BALL_RADIUS - y) / dy);
  if (dy < 0) reach = Math.min(reach, (PITCH_TOP + BALL_RADIUS - y) / dy);
  return reach > 0 ? reach : 0;
}
