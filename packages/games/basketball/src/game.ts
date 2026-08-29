import { Rng, SEAT_PALETTE, SeatFlip, seatView } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  ARC_RADIUS,
  BALL_RADIUS,
  CENTRE_X,
  CENTRE_Y,
  COURT_HEIGHT,
  COURT_MARGIN,
  COURT_WIDTH,
  HOOP_X,
  HOOP_Y,
  MAX_RANGE,
  MOUTH_RADIUS,
  POSSESSIONS,
  RIM_RADIUS,
  SHOTS_PER_POSSESSION,
  SWISH_RADIUS,
  createBotRngs,
  createBotState,
  createCourt,
  driveBot,
  flightProgress,
  halfSign,
  landingOf,
  press,
  resetBotState,
  resetCourt,
  scored,
  shotDirection,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Court, Point } from './rules.js';

/**
 * Basketball — one hoop, two halves, and whoever the ball rolled to.
 *
 * Nothing here is dragged and nothing is pointed at: a shot is two presses, so a key and a
 * thumb are the same instrument and neither can aim finer than the other. What the drawing
 * has to do is turn two abstract needles into one picture — the first press keeps a *line
 * across the floor* and the second stops a *marker running out along it* — so both dials
 * are drawn where the ball will actually come down rather than as bars whose numbers a
 * player would have to translate. The take-back arc and the two rings inside the hoop are
 * drawn for the same reason: every rule that decides the match is a mark on the floor.
 */

const COLOUR_APRON = '#171310';
const COLOUR_FLOOR = '#3b2a1c';
const COLOUR_HALF = '#42301f';
const COLOUR_LINE = 'rgba(246, 233, 214, 0.5)';
const COLOUR_FAINT = 'rgba(246, 233, 214, 0.15)';
const COLOUR_RIM = '#f2793d';
const COLOUR_NET = 'rgba(246, 233, 214, 0.7)';
const COLOUR_BALL = '#e07a33';
const COLOUR_SEAM = '#2a1608';
const COLOUR_SHADOW = 'rgba(8, 5, 2, 0.45)';
const COLOUR_MADE = '#5fd39a';
const COLOUR_MISS = '#e2564f';

/** How far a ball at the top of its arc is drawn from its own shadow. */
const LIFT = 30;

/** Possession pips sit on each seat's own baseline, outside every line on the floor. */
const PIP_INSET = 22;
const PIP_SPACING = 30;
const PIP_RADIUS = 8;

/** The shot clock sits just inside the baseline, on the shooter's side only. */
const CLOCK_INSET = 58;
const CLOCK_SPACING = 34;
const CLOCK_RADIUS = 9;

const mark: Point = { x: 0, y: 0 };
const aimDirection: Point = { x: 0, y: 0 };

export class BasketballGame implements Game {
  readonly #court: Court = createCourt();
  readonly #flip = new SeatFlip();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  #botRng: { p1: Rng; p2: Rng } = { p1: new Rng(1), p2: new Rng(2) };
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get court(): Court {
    return this.#court;
  }

  init(context: GameContext): void {
    // A generator per seat, both drawn from the match's own before anything else touches
    // it. One shared stream would couple a seat's shots to how its opponent was shooting,
    // because a possession here is one shot or three depending on the rebound.
    this.#botRng = createBotRngs(context.rng);
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetCourt(this.#court);
    this.#flip.snap(this.#shouldRotate());
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    // Stepped before the early return, so the court finishes turning to face the winner
    // rather than freezing half way round.
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#winner !== null) return;

    this.#take(input, fixedDeltaSeconds);
    step(this.#court, fixedDeltaSeconds);
    this.#winner = winnerOf(this.#court);
  }

  #take(input: InputState, fixedDeltaSeconds: number): void {
    const shooter = this.#court.shooter;
    const difficulty = shooter === 'p1' ? this.#botP1 : this.#botP2;

    if (difficulty !== null) {
      const state = shooter === 'p1' ? this.#botP1State : this.#botP2State;
      driveBot(this.#court, shooter, difficulty, state, this.#botRng[shooter], fixedDeltaSeconds);
      return;
    }

    // Nothing is accepted while the court is part-way round: the needle a player is reading
    // is moving under them, so a tap would name a moment they did not mean. The rules'
    // ready freeze is what makes this cost nothing — the needles are parked for longer than
    // the turn takes, for a bot as much as for a person.
    if (!this.#flip.acceptsInput) return;
    if (!input.seat(shooter).actionPressed) return;
    press(this.#court, shooter);
  }

  #shouldRotate(): boolean {
    // `seatView` is the one definition of when a seat reads the court upside down.
    return seatView(this.#court.shooter, this.#presentation, this.#localSeat).rotated;
  }

  getActiveSeat(): SeatId {
    return this.#court.shooter;
  }

  getScore(): MatchScore {
    return { p1: this.#court.p1Points, p2: this.#court.p2Points, winner: this.#winner };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetCourt(this.#court);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_APRON);
    renderer.pushRotation(this.#flip.angle);
    this.#drawFloor(renderer);
    this.#drawHoop(renderer);
    this.#drawAim(renderer);
    this.#drawBall(renderer);
    this.#drawShotClock(renderer);
    this.#drawPossessions(renderer, 'p1');
    this.#drawPossessions(renderer, 'p2');
    renderer.popSeatRotation();
  }

  /**
   * The floor: a fence, two halves, and the take-back arc.
   *
   * Each half is washed in its owner's tint so the answer to "whose ball is it" is the
   * colour of the ground it stopped on — and the pips on the two baselines carry the same
   * seat shape, so the halves are told apart by more than their colour (rule 7).
   */
  #drawFloor(renderer: Renderer): void {
    const left = COURT_MARGIN;
    const top = COURT_MARGIN;
    const width = COURT_WIDTH - COURT_MARGIN * 2;
    const height = COURT_HEIGHT - COURT_MARGIN * 2;
    renderer.rect(left, top, width, height, COLOUR_FLOOR);
    renderer.rect(left, CENTRE_Y, width, height / 2, COLOUR_HALF);
    renderer.strokeRect(left, top, width, height, 4, COLOUR_LINE);
    renderer.line(left, CENTRE_Y, left + width, CENTRE_Y, 3, COLOUR_LINE);
    renderer.strokeCircle(HOOP_X, HOOP_Y, ARC_RADIUS, 3, COLOUR_FAINT);
    for (const seat of ['p1', 'p2'] as const) {
      const y = CENTRE_Y + halfSign(seat) * ARC_RADIUS;
      renderer.line(HOOP_X - 70, y, HOOP_X + 70, y, 3, SEAT_PALETTE[seat].soft);
    }
  }

  /** The ring, its mouth, and the clean-drop circle inside that — the whole scoring rule. */
  #drawHoop(renderer: Renderer): void {
    renderer.circle(HOOP_X, HOOP_Y, RIM_RADIUS + 10, COLOUR_SHADOW);
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      renderer.line(
        HOOP_X + cos * SWISH_RADIUS,
        HOOP_Y + sin * SWISH_RADIUS,
        HOOP_X + cos * RIM_RADIUS,
        HOOP_Y + sin * RIM_RADIUS,
        2,
        COLOUR_NET,
      );
    }
    renderer.strokeCircle(HOOP_X, HOOP_Y, RIM_RADIUS, 6, COLOUR_RIM);
    renderer.strokeCircle(HOOP_X, HOOP_Y, MOUTH_RADIUS, 2, COLOUR_NET);
    renderer.strokeCircle(HOOP_X, HOOP_Y, SWISH_RADIUS, 3, COLOUR_NET);
  }

  /**
   * The two dials, drawn as the shot they describe.
   *
   * The line is the first press and the marker running out along it is the second, so the
   * range needle is literally the landing point sliding up the floor. Only the live dial
   * moves; the other is held where it was stopped.
   */
  #drawAim(renderer: Renderer): void {
    const court = this.#court;
    const phase = court.phase;
    if (phase !== 'ready' && phase !== 'aiming' && phase !== 'charging') return;
    const seat = court.shooter;
    const palette = SEAT_PALETTE[seat];
    const aim = phase === 'charging' ? court.lockedAim : court.aim;
    shotDirection(aimDirection, court.ball.x, court.ball.y, aim);
    renderer.line(
      court.ball.x,
      court.ball.y,
      court.ball.x + aimDirection.x * MAX_RANGE,
      court.ball.y + aimDirection.y * MAX_RANGE,
      2,
      phase === 'ready' ? COLOUR_FAINT : palette.soft,
    );
    if (phase !== 'charging') return;
    landingOf(mark, court.ball.x, court.ball.y, aim, court.power);
    renderer.strokeCircle(mark.x, mark.y, BALL_RADIUS + 5, 3, palette.base);
    this.#seatMark(renderer, seat, mark.x, mark.y, 5, palette.base);
  }

  /** The ball in flight, and the mark it leaves when it comes down. */
  #drawBall(renderer: Renderer): void {
    const court = this.#court;
    const ball = court.ball;
    if (court.phase === 'settling') {
      // Ring, double ring, cross: the outcomes are told apart by shape, so the colour is
      // confirming what the shape already said rather than carrying it.
      if (scored(court.lastOutcome)) {
        renderer.strokeCircle(ball.x, ball.y, RIM_RADIUS + 14, 4, COLOUR_MADE);
        if (court.lastOutcome === 'swish') {
          renderer.strokeCircle(ball.x, ball.y, RIM_RADIUS + 26, 4, COLOUR_MADE);
        }
        return;
      }
      renderer.line(ball.x - 15, ball.y - 15, ball.x + 15, ball.y + 15, 4, COLOUR_MISS);
      renderer.line(ball.x + 15, ball.y - 15, ball.x - 15, ball.y + 15, 4, COLOUR_MISS);
    }

    const progress = flightProgress(court);
    const lift = 4 * progress * (1 - progress);
    if (court.phase === 'flying') {
      renderer.circle(ball.x, ball.y, BALL_RADIUS * 0.7, COLOUR_SHADOW);
    }
    // Drawn back toward the shooter as it rises: from where they sit, a ball in the air is
    // nearer than its own shadow, which is the whole of the height cue on a flat floor.
    const y = ball.y + halfSign(court.shooter) * lift * LIFT;
    const radius = BALL_RADIUS * (1 + lift * 0.35);
    renderer.circle(ball.x, y, radius, COLOUR_BALL);
    renderer.line(ball.x - radius, y, ball.x + radius, y, 2, COLOUR_SEAM);
    renderer.line(ball.x, y - radius, ball.x, y + radius, 2, COLOUR_SEAM);
  }

  /**
   * The shot clock: how many shots are left in this possession, on the shooter's baseline.
   *
   * Drawn only on the side of the seat holding the ball, because that is the one place it
   * means anything — and in the shooter's own seat shape, so a greyscale screen still says
   * whose it is.
   */
  #drawShotClock(renderer: Renderer): void {
    const court = this.#court;
    const seat = court.shooter;
    const palette = SEAT_PALETTE[seat];
    const y = CENTRE_Y + halfSign(seat) * (COURT_HEIGHT / 2 - CLOCK_INSET);
    for (let i = 0; i < SHOTS_PER_POSSESSION; i += 1) {
      const x = CENTRE_X + (i - (SHOTS_PER_POSSESSION - 1) / 2) * CLOCK_SPACING;
      if (i < SHOTS_PER_POSSESSION - court.shotsThisPossession) {
        this.#seatMark(renderer, seat, x, y, CLOCK_RADIUS, palette.base);
      } else {
        this.#seatOutline(renderer, seat, x, y, CLOCK_RADIUS, COLOUR_FAINT);
      }
    }
  }

  /**
   * Possessions used, on that seat's own baseline. Seven each, and they never differ by
   * more than one, so the row doubles as how far through the match the pair are.
   */
  #drawPossessions(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const total = POSSESSIONS / 2;
    const used = Math.floor((this.#court.possession - (seat === 'p1' ? 1 : 2)) / 2) + 1;
    const y = CENTRE_Y + halfSign(seat) * (COURT_HEIGHT / 2 - PIP_INSET);
    for (let i = 0; i < total; i += 1) {
      const x = CENTRE_X + (i - (total - 1) / 2) * PIP_SPACING;
      if (i < used) this.#seatMark(renderer, seat, x, y, PIP_RADIUS, palette.base);
      else this.#seatOutline(renderer, seat, x, y, PIP_RADIUS, COLOUR_FAINT);
    }
  }

  /** p1 is round and p2 is square, everywhere on the floor. Rule 7, in one place. */
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
    if (seat === 'p1') renderer.strokeCircle(x, y, size, 2, colour);
    else renderer.strokeRect(x - size, y - size, size * 2, size * 2, 2, colour);
  }
}
