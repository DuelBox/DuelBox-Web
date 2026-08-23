import { Rng, SEAT_PALETTE, SeatFlip, seatView, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  ARROWS_PER_ROUND,
  ARROWS_PER_SEAT,
  BOT_PROFILES,
  DRAW_SECONDS,
  ROUNDS,
  SHOTS_PER_MATCH,
  SWAY_MAX,
  arrowFor,
  arrowInRoundFor,
  botAim,
  botDwellSeconds,
  createSeatState,
  createShot,
  createSway,
  createWind,
  drawProgress,
  recordArrow,
  resetSeatState,
  resolveShot,
  rollSway,
  rollWind,
  roundFor,
  scatter,
  scoreAt,
  shooterFor,
  swayAmplitude,
  swayAt,
  windStrength,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, SeatState, Wind } from './rules.js';

/**
 * The field, in logical units. Exported because aiming is not a rendering question — the
 * tests drive the same mapping the game does, and a test that invented its own would be
 * testing itself.
 */
export const TARGET_CX = 350;
export const TARGET_CY = 240;
export const TARGET_RADIUS = 165;

/** The aiming pad: the near half of the field, where a thumb can reach. */
export const PAD_X = 40;
export const PAD_Y = 505;
export const PAD_W = 620;
export const PAD_H = 395;
export const PAD_CX = PAD_X + PAD_W / 2;
export const PAD_CY = PAD_Y + PAD_H / 2;
export const PAD_HALF_W = PAD_W / 2;
export const PAD_HALF_H = PAD_H / 2;

/**
 * How far off the centre of the target the sight can be pushed, in target radii.
 *
 * More than one, deliberately: a full cross-wind carries an arrow almost half a radius,
 * so an archer who cannot point past the edge of the boss cannot fight the weather.
 */
export const AIM_REACH = 1.3;

/** Radii per second the keys move the sight. Crossing the whole target takes about two. */
const AIM_KEY_SPEED = 1.25;

const HORIZON_Y = 400;
const WIND_Y = 452;
const WIND_LABEL_Y = 489;
const BOW_X = 350;
const BOW_Y = 950;
const BOW_RADIUS = 42;
const CLOCK_X = 12;
const GAUGE_W = 16;
const METER_X = 700 - 12 - GAUGE_W;

/** Converted to whole simulation steps before being counted, so a replay is exact. */
const FLIGHT_SECONDS = 0.5;
const SETTLE_SECONDS = 0.35;
const BOT_THINK_SECONDS = 0.32;
/**
 * How long a seat has to loose, once the board has turned to face it.
 *
 * Every game has to guarantee its own termination and this is ours: with a clock on each
 * shot, a match is over in a bounded number of steps whatever anybody does or fails to
 * do, including nothing at all. It doubles as the rule that stops one player holding a
 * drawn bow for ever while the other waits — the clock runs while the bow is drawn, and
 * an arrow still on the string when it expires is loosed as it stands.
 */
const SHOT_CLOCK_SECONDS = 5;

/** Misses are drawn just off the boss rather than where they truly landed. */
const MISS_DISPLAY_RADIUS = 1.16;

const COLOUR_SKY = '#cfe6f5';
const COLOUR_GRASS = '#4e8a53';
const COLOUR_GRASS_DEEP = '#3d6f44';
const COLOUR_HEDGE = '#2f5636';
const COLOUR_STAND = '#7c5a3a';
const COLOUR_WHITE = '#f4f4ee';
const COLOUR_BLACK = '#22262c';
const COLOUR_BLUE = '#3f8fd0';
const COLOUR_RED = '#e2574c';
const COLOUR_GOLD = '#f5cf3c';
const COLOUR_RING_LINE = 'rgba(18, 22, 28, 0.32)';
const COLOUR_INK = '#14181f';
const COLOUR_MUTED = '#33414d';
const COLOUR_PAD_FILL = 'rgba(20, 46, 26, 0.14)';
const COLOUR_PAD_LINE = '#2f5636';
const COLOUR_GAUGE_BACK = 'rgba(18, 30, 20, 0.30)';
const COLOUR_CLOCK = '#e2574c';
const COLOUR_DRAWN = '#f5cf3c';
const COLOUR_SHAFT = '#efe6d2';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;

/** An arrow standing in the boss, kept for the rest of the round. */
interface StuckArrow {
  x: number;
  y: number;
  seat: SeatId;
  ring: number;
}

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

/** Target units to logical units. */
function targetX(x: number): number {
  return TARGET_CX + x * TARGET_RADIUS;
}

function targetY(y: number): number {
  return TARGET_CY + y * TARGET_RADIUS;
}

export class ArcheryGame implements Game {
  readonly #logical: LogicalSize = manifest.logical;
  readonly #p1: SeatState = createSeatState();
  readonly #p2: SeatState = createSeatState();
  /**
   * One wind per arrow, rolled at the start of the match and shared by both seats.
   *
   * This is the fairness decision the whole game turns on. Wind rolled per *shot* would
   * hand one archer a gale and the other a still afternoon, and the match would be
   * decided by the weather rather than by either of them. Both seats shoot arrow four
   * into exactly the same breeze, so the flag is a test of judgement and not of luck.
   */
  readonly #winds: readonly Wind[] = Array.from({ length: ARROWS_PER_SEAT }, createWind);
  readonly #calm: Wind = createWind();
  readonly #sway = createSway();
  readonly #shot = createShot();
  readonly #aim = { x: 0, y: 0 };
  readonly #swayOut = { x: 0, y: 0 };
  /** Scratch for the sight the renderer draws, kept apart from the one a shot resolves with. */
  readonly #renderSway = { x: 0, y: 0 };
  readonly #botScatter = { x: 0, y: 0 };
  /** Where the bow was pointing at the release, for the arc the arrow flies through. */
  readonly #released = { x: 0, y: 0 };
  readonly #landed = { x: 0, y: 0 };
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();
  /** Both seats' arrows for the current round. Pooled: nothing is allocated in a match. */
  readonly #stuck: readonly StuckArrow[] = Array.from(
    { length: ARROWS_PER_ROUND * 2 },
    (): StuckArrow => ({ x: 0, y: 0, seat: 'p1', ring: 0 }),
  );

  #rng = new Rng(1);
  #stuckCount = 0;
  #shotIndex = 0;
  #active: SeatId = 'p1';
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #stepsPerSecond = 0;
  #drawSteps = 0;
  #flightSteps = 0;
  #flightTotal = 1;
  #settleSteps = 0;
  /** -1 until the step rate is known, which is the first update of the match. */
  #clockSteps = -1;
  #clockTotal = 1;
  #botPlanned = false;
  #botThinkSteps = 0;
  #botReleaseSteps = 0;

  /**
   * Whose turn it is.
   *
   * The shell decides a game is turn-based by the seat this reports, and only then does it
   * hand the whole pointer surface to that seat. Leave it out of a `turn-*` game and the
   * board keeps a real-time game's two zones, so the far half of it — which is the half a
   * seat reads after the board has turned — goes dead to a finger.
   *
   * It moves the *pointer* and nothing else. The two keyboard halves stay bound to their
   * own seats for the whole match, which is why the manifest names them one player at a
   * time rather than offering either half to whoever is shooting.
   */
  getActiveSeat(): SeatId {
    return this.#active;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    resetSeatState(this.#p1);
    resetSeatState(this.#p2);
    for (const wind of this.#winds) rollWind(wind, this.#rng);
    this.#stuckCount = 0;
    this.#shotIndex = 0;
    this.#active = shooterFor(0);
    this.#flightSteps = 0;
    this.#settleSteps = 0;
    this.#beginTurn();
    this.#flip.snap(this.#shouldRotate());
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#matchWinner !== null) return;

    if (this.#settleSteps > 0) {
      this.#settleSteps -= 1;
      if (this.#settleSteps === 0) this.#advanceTurn();
      return;
    }

    // An arrow in the air: nothing is accepted until it lands, so a fast tapper cannot
    // put three arrows in the boss before the first one is scored.
    if (this.#flightSteps > 0) {
      this.#flightSteps -= 1;
      if (this.#flightSteps === 0) this.#land();
      return;
    }

    if (this.#clockSteps < 0) {
      this.#clockTotal = this.#stepsFor(SHOT_CLOCK_SECONDS);
      this.#clockSteps = this.#clockTotal;
    }

    // The board is turning: a tap on it now would land somewhere nobody aimed. The bot
    // waits through it too — it may not act on a step a person is not allowed to act on
    // (CLAUDE.md rule 6), and the shot clock is stopped for both of them alike.
    if (!this.#flip.acceptsInput) return;
    this.#clockSteps -= 1;

    const difficulty = this.#active === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      this.#botStep(difficulty);
      return;
    }

    const seatInput = input.seat(this.#active);

    // Where the finger is *is* where the bow points: the pad is the target face, blown
    // up and laid in the near half of the field. Absolute rather than relative, because a
    // finger held still has no drag to read and a relative scheme would go dead.
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      this.#aim.x = clamp((this.#pointerWorld.x - PAD_CX) / PAD_HALF_W, -1, 1) * AIM_REACH;
      this.#aim.y = clamp((this.#pointerWorld.y - PAD_CY) / PAD_HALF_H, -1, 1) * AIM_REACH;
    }

    // Keys move the sight at a rate rather than jumping it, so a keyboard and a thumb are
    // comparable instruments rather than one of them being strictly finer.
    const move = seatInput.move;
    if (move.x !== 0 || move.y !== 0) {
      const speed = AIM_KEY_SPEED * fixedDeltaSeconds;
      this.#aim.x = clamp(this.#aim.x + move.x * speed, -AIM_REACH, AIM_REACH);
      this.#aim.y = clamp(this.#aim.y + move.y * speed, -AIM_REACH, AIM_REACH);
    }

    // Hold to draw, let go to loose — the same gesture on both instruments, because a
    // finger on the glass and a held key are the one intent the engine reports as
    // `actionHeld`. A press that has not drawn the bow at all is a fumbled nock and does
    // nothing, so a stray tap never costs an arrow.
    if (seatInput.actionHeld) this.#drawSteps += 1;
    if (seatInput.actionReleased && this.#drawSteps > 0) {
      this.#loose(0, 0);
      return;
    }
    if (this.#clockSteps <= 0) this.#loose(0, 0);
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_SKY);
    renderer.pushRotation(this.#flip.angle);
    this.#drawField(renderer);
    this.#drawTarget(renderer);
    this.#drawStuck(renderer);
    this.#drawWind(renderer);
    this.#drawStatus(renderer);
    this.#drawCards(renderer);
    this.#drawPad(renderer);
    this.#drawGauges(renderer);
    this.#drawArcher(renderer);
    this.#drawFlight(renderer);
    renderer.popSeatRotation();
  }

  /**
   * A pause drops every key and pointer without an accompanying release, so a bow that
   * was drawn when the menu opened would otherwise come back still drawn and loose a
   * shot the player never took. The nock is simply let down.
   */
  onPause(): void {
    this.#drawSteps = 0;
  }

  onResume(): void {}

  getScore(): MatchScore {
    return { p1: this.#p1.points, p2: this.#p2.points, winner: this.#matchWinner };
  }

  destroy(): void {
    resetSeatState(this.#p1);
    resetSeatState(this.#p2);
    this.#stuckCount = 0;
    this.#drawSteps = 0;
  }

  // -------------------------------------------------------------------------
  // Read-only views, for the tests and the balance harness
  // -------------------------------------------------------------------------

  get activeSeat(): SeatId {
    return this.#active;
  }

  get shotIndex(): number {
    return this.#shotIndex;
  }

  get roundIndex(): number {
    return roundFor(this.#displayShot());
  }

  get arrowInRound(): number {
    return arrowInRoundFor(this.#displayShot());
  }

  get stuckArrowCount(): number {
    return this.#stuckCount;
  }

  get arrowInFlight(): boolean {
    return this.#flightSteps > 0;
  }

  get aimX(): number {
    return this.#aim.x;
  }

  get aimY(): number {
    return this.#aim.y;
  }

  get drawSeconds(): number {
    return this.#drawSecondsHeld();
  }

  get shotClockSeconds(): number {
    if (this.#clockSteps < 0 || this.#stepsPerSecond === 0) return SHOT_CLOCK_SECONDS;
    return Math.max(0, this.#clockSteps) / this.#stepsPerSecond;
  }

  windFor(arrowIndex: number): Wind {
    return this.#winds[arrowIndex] ?? this.#calm;
  }

  pointsFor(seat: SeatId): number {
    return this.#stateOf(seat).points;
  }

  goldsFor(seat: SeatId): number {
    return this.#stateOf(seat).golds;
  }

  arrowsFor(seat: SeatId): number {
    return this.#stateOf(seat).arrows;
  }

  roundPointsFor(seat: SeatId, round: number): number {
    return this.#stateOf(seat).roundPoints[round] ?? 0;
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  #stateOf(seat: SeatId): SeatState {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  #displayShot(): number {
    return Math.min(this.#shotIndex, SHOTS_PER_MATCH - 1);
  }

  #currentWind(): Wind {
    return this.#winds[arrowFor(this.#displayShot())] ?? this.#calm;
  }

  #drawSecondsHeld(): number {
    if (this.#stepsPerSecond === 0) return 0;
    return this.#drawSteps / this.#stepsPerSecond;
  }

  #stepsFor(seconds: number): number {
    const rate = this.#stepsPerSecond === 0 ? 60 : this.#stepsPerSecond;
    const steps = Math.round(seconds * rate);
    return steps < 1 ? 1 : steps;
  }

  /** Fresh sight, fresh clock, and a wobble nobody has seen before. */
  #beginTurn(): void {
    this.#aim.x = 0;
    this.#aim.y = 0;
    this.#drawSteps = 0;
    this.#clockSteps = -1;
    this.#botPlanned = false;
    this.#botThinkSteps = 0;
    this.#botReleaseSteps = 0;
    rollSway(this.#sway, this.#rng);
  }

  /**
   * One step of a bot's turn.
   *
   * It plans once — where to point, how badly its hand will stray, how long it will
   * dither — and then draws the bow like a person, on the clock everybody else is on.
   * Everything it reads is on the screen: the flag, the rings, its own sight.
   */
  #botStep(difficulty: BotDifficulty): void {
    const profile = BOT_PROFILES[difficulty];
    if (!this.#botPlanned) {
      botAim(this.#aim, this.#currentWind(), profile);
      scatter(this.#botScatter, profile.spread, this.#rng);
      this.#botReleaseSteps = this.#stepsFor(DRAW_SECONDS + botDwellSeconds(profile, this.#rng));
      this.#botThinkSteps = this.#stepsFor(BOT_THINK_SECONDS);
      this.#botPlanned = true;
    }
    if (this.#botThinkSteps > 0) {
      this.#botThinkSteps -= 1;
      return;
    }
    this.#drawSteps += 1;
    if (this.#drawSteps >= this.#botReleaseSteps || this.#clockSteps <= 0) {
      this.#loose(this.#botScatter.x, this.#botScatter.y);
    }
  }

  /** Let the string go. `scatter` is a bot's hand; a person gets the shot they loosed. */
  #loose(scatterX: number, scatterY: number): void {
    const seconds = this.#drawSecondsHeld();
    const wind = this.#currentWind();
    swayAt(this.#swayOut, this.#sway, seconds);
    const shot = this.#shot;
    shot.aimX = this.#aim.x;
    shot.aimY = this.#aim.y;
    shot.swayX = this.#swayOut.x;
    shot.swayY = this.#swayOut.y;
    shot.windX = wind.x;
    shot.windY = wind.y;
    shot.drawSeconds = seconds;
    shot.scatterX = scatterX;
    shot.scatterY = scatterY;
    this.#released.x = shot.aimX + shot.swayX;
    this.#released.y = shot.aimY + shot.swayY;
    resolveShot(this.#landed, shot);
    this.#drawSteps = 0;
    this.#flightTotal = this.#stepsFor(FLIGHT_SECONDS);
    this.#flightSteps = this.#flightTotal;
  }

  #land(): void {
    const seat = this.#active;
    const landing = scoreAt(this.#landed.x, this.#landed.y);
    recordArrow(this.#stateOf(seat), roundFor(this.#displayShot()), landing);

    if (this.#stuckCount < this.#stuck.length) {
      const slot = this.#stuck[this.#stuckCount];
      if (slot !== undefined) {
        // A miss is shown just off the boss in the direction it went rather than where it
        // truly landed, which for a badly under-drawn arrow is off the field entirely.
        const distance = Math.hypot(this.#landed.x, this.#landed.y);
        const scale = distance > MISS_DISPLAY_RADIUS ? MISS_DISPLAY_RADIUS / distance : 1;
        slot.x = this.#landed.x * scale;
        slot.y = this.#landed.y * scale;
        slot.seat = seat;
        slot.ring = landing.ring;
        this.#stuckCount += 1;
      }
    }
    this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
  }

  #advanceTurn(): void {
    const previousRound = roundFor(this.#displayShot());
    this.#shotIndex += 1;
    if (this.#shotIndex >= SHOTS_PER_MATCH) {
      this.#matchWinner = winnerOf(this.#p1, this.#p2, true);
      return;
    }
    // The boss is cleared between ends, so each round is shot at a clean target and the
    // eight arrows in it are always the ones this round put there.
    if (roundFor(this.#shotIndex) !== previousRound) this.#stuckCount = 0;
    this.#active = shooterFor(this.#shotIndex);
    this.#beginTurn();
  }

  /** The orientation the field should be in, which the flip tweens towards. */
  #shouldRotate(): boolean {
    return seatView(this.#active, this.#presentation, this.#localSeat).rotated;
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  #seatColour(seat: SeatId): string {
    return seat === 'p1' ? COLOUR_P1 : COLOUR_P2;
  }

  /**
   * A seat's own mark: seat one is a disc, seat two a square.
   *
   * The same pair as the stuck arrows, the pad hand and the scorecards, because an arrow
   * on the string and an arrow in the air belong to a seat exactly as much as one standing
   * in the boss does, and rule 7 does not stop while it is moving.
   */
  #seatMark(renderer: Renderer, seat: SeatId, x: number, y: number, radius: number): void {
    const colour = this.#seatColour(seat);
    if (seat === 'p1') renderer.circle(x, y, radius, colour);
    else renderer.rect(x - radius, y - radius, radius * 2, radius * 2, colour);
  }

  #drawField(renderer: Renderer): void {
    renderer.rect(0, HORIZON_Y, 700, 1000 - HORIZON_Y, COLOUR_GRASS);
    renderer.rect(0, HORIZON_Y - 14, 700, 14, COLOUR_HEDGE);
    renderer.rect(0, 900, 700, 100, COLOUR_GRASS_DEEP);
    // The stand the boss leans on, so the target reads as standing on the field.
    renderer.line(TARGET_CX - 60, TARGET_CY + 120, TARGET_CX - 30, HORIZON_Y + 26, 9, COLOUR_STAND);
    renderer.line(TARGET_CX + 60, TARGET_CY + 120, TARGET_CX + 30, HORIZON_Y + 26, 9, COLOUR_STAND);
  }

  /**
   * The boss: five colour bands of two rings each, and a line at every ring boundary so
   * all ten can be counted rather than only the five colours — the target has to be
   * readable in greyscale like everything else.
   */
  #drawTarget(renderer: Renderer): void {
    renderer.circle(TARGET_CX, TARGET_CY, TARGET_RADIUS + 8, COLOUR_GRASS_DEEP);
    renderer.circle(TARGET_CX, TARGET_CY, TARGET_RADIUS, COLOUR_WHITE);
    renderer.circle(TARGET_CX, TARGET_CY, TARGET_RADIUS * 0.8, COLOUR_BLACK);
    renderer.circle(TARGET_CX, TARGET_CY, TARGET_RADIUS * 0.6, COLOUR_BLUE);
    renderer.circle(TARGET_CX, TARGET_CY, TARGET_RADIUS * 0.4, COLOUR_RED);
    renderer.circle(TARGET_CX, TARGET_CY, TARGET_RADIUS * 0.2, COLOUR_GOLD);
    for (let ring = 1; ring <= 10; ring += 1) {
      renderer.strokeCircle(
        TARGET_CX,
        TARGET_CY,
        TARGET_RADIUS * (ring / 10),
        1.5,
        COLOUR_RING_LINE,
      );
    }
    // The innermost ring, which is worth ten and breaks a tie, gets a cross as well as a
    // colour so it is findable without one.
    renderer.line(TARGET_CX - 9, TARGET_CY, TARGET_CX + 9, TARGET_CY, 2, COLOUR_INK);
    renderer.line(TARGET_CX, TARGET_CY - 9, TARGET_CX, TARGET_CY + 9, 2, COLOUR_INK);
  }

  /** Seat one's arrows are discs, seat two's are squares: never colour alone (rule 7). */
  #drawStuck(renderer: Renderer): void {
    for (let i = 0; i < this.#stuckCount; i += 1) {
      const arrow = this.#stuck[i];
      if (arrow === undefined) continue;
      const x = targetX(arrow.x);
      const y = targetY(arrow.y);
      const colour = this.#seatColour(arrow.seat);
      renderer.line(x, y, x + 13, y - 20, 3, COLOUR_SHAFT);
      if (arrow.seat === 'p1') {
        renderer.circle(x, y, 7, colour);
        renderer.strokeCircle(x, y, 7, 2, COLOUR_INK);
      } else {
        renderer.rect(x - 6.5, y - 6.5, 13, 13, colour);
        renderer.strokeRect(x - 6.5, y - 6.5, 13, 13, 2, COLOUR_INK);
      }
    }
  }

  /**
   * The flag. Direction is the pennant's own direction, strength is written on it, so
   * the wind is read rather than guessed — and read the same way by the bot.
   */
  #drawWind(renderer: Renderer): void {
    const wind = this.#currentWind();
    const length = 34 + Math.abs(wind.x) * 96;
    const dx = wind.x >= 0 ? 1 : -1;
    const tipX = TARGET_CX + dx * length;
    const tipY = WIND_Y + wind.y * 40;
    renderer.line(TARGET_CX, WIND_Y - 26, TARGET_CX, WIND_Y + 26, 4, COLOUR_MUTED);
    renderer.line(TARGET_CX, WIND_Y, tipX, tipY, 6, COLOUR_INK);
    renderer.line(tipX, tipY, tipX - dx * 20, tipY - 13, 5, COLOUR_INK);
    renderer.line(tipX, tipY, tipX - dx * 20, tipY + 13, 5, COLOUR_INK);
    renderer.text(
      `WIND ${String(windStrength(wind))}`,
      TARGET_CX,
      WIND_LABEL_Y,
      24,
      COLOUR_MUTED,
      'centre',
    );
  }

  /** Where the match has got to, above the boss where nothing else is drawn. */
  #drawStatus(renderer: Renderer): void {
    const round = String(this.roundIndex + 1);
    const arrow = String(this.arrowInRound + 1);
    const label =
      this.#matchWinner === null
        ? `ROUND ${round} OF ${String(ROUNDS)} — ARROW ${arrow} OF ${String(ARROWS_PER_ROUND)}`
        : 'ALL ARROWS SHOT';
    renderer.text(label, TARGET_CX, 34, 22, COLOUR_MUTED, 'centre');
  }

  /** A card a side: the seat's mark, its total, and what it shot each round. */
  #drawCards(renderer: Renderer): void {
    this.#drawCard(renderer, 'p1', 20, 'left');
    this.#drawCard(renderer, 'p2', 680, 'right');
  }

  #drawCard(renderer: Renderer, seat: SeatId, x: number, align: 'left' | 'right'): void {
    const state = this.#stateOf(seat);
    const colour = this.#seatColour(seat);
    const markX = align === 'left' ? x + 10 : x - 10;
    if (seat === 'p1') renderer.circle(markX, 96, 10, colour);
    else renderer.rect(markX - 9, 87, 18, 18, colour);
    renderer.text(String(state.points), x, 140, 40, COLOUR_INK, align);
    for (let round = 0; round < ROUNDS; round += 1) {
      const shot = state.roundPoints[round] ?? 0;
      const label = round <= this.roundIndex ? String(shot) : '—';
      renderer.text(`R${String(round + 1)} ${label}`, x, 180 + round * 30, 20, COLOUR_MUTED, align);
    }
    renderer.text(`X${String(state.golds)}`, x, 180 + ROUNDS * 30, 20, COLOUR_MUTED, align);
  }

  /**
   * The pad, the mark showing where the hand is, and the sight it puts on the target.
   *
   * The mark carries the active seat's shape as well as its colour, so which archer is
   * shooting is legible without relying on the colour alone.
   */
  #drawPad(renderer: Renderer): void {
    renderer.rect(PAD_X, PAD_Y, PAD_W, PAD_H, COLOUR_PAD_FILL);
    renderer.strokeRect(PAD_X, PAD_Y, PAD_W, PAD_H, 3, COLOUR_PAD_LINE);
    renderer.line(PAD_CX, PAD_Y + 10, PAD_CX, PAD_Y + PAD_H - 10, 1, COLOUR_PAD_LINE);
    renderer.line(PAD_X + 10, PAD_CY, PAD_X + PAD_W - 10, PAD_CY, 1, COLOUR_PAD_LINE);
    if (this.#matchWinner !== null) return;

    const colour = this.#seatColour(this.#active);
    const handX = PAD_CX + (this.#aim.x / AIM_REACH) * PAD_HALF_W;
    const handY = PAD_CY + (this.#aim.y / AIM_REACH) * PAD_HALF_H;
    if (this.#active === 'p1') {
      renderer.circle(handX, handY, 15, colour);
      renderer.strokeCircle(handX, handY, 15, 3, COLOUR_INK);
    } else {
      renderer.rect(handX - 14, handY - 14, 28, 28, colour);
      renderer.strokeRect(handX - 14, handY - 14, 28, 28, 3, COLOUR_INK);
    }

    // The sight shows where the bow is pointing, wobble included — never where the arrow
    // will land. Allowing for the wind is the whole game and is left to the archer.
    const held = this.#drawSecondsHeld();
    swayAt(this.#renderSway, this.#sway, held);
    const sightX = targetX(this.#aim.x + this.#renderSway.x);
    const sightY = targetY(this.#aim.y + this.#renderSway.y);
    renderer.strokeCircle(sightX, sightY, 20, 3, colour);
    renderer.line(sightX - 30, sightY, sightX + 30, sightY, 2, colour);
    renderer.line(sightX, sightY - 30, sightX, sightY + 30, 2, colour);
  }

  /** Two gauges: how far the bow is drawn, and how long is left to loose it. */
  #drawGauges(renderer: Renderer): void {
    renderer.rect(CLOCK_X, PAD_Y, GAUGE_W, PAD_H, COLOUR_GAUGE_BACK);
    renderer.rect(METER_X, PAD_Y, GAUGE_W, PAD_H, COLOUR_GAUGE_BACK);
    if (this.#matchWinner !== null) return;

    // Read the same way `shotClockSeconds` reads it. A turn that has begun but has not yet
    // had an update sits at -1, which taken as a count drew an *empty* clock for the frame
    // or two before the board finished turning — the gauge flashing empty and then full at
    // the exact moment a player looks up at it.
    const left =
      this.#clockSteps < 0 || this.#clockTotal <= 0
        ? 1
        : clamp(this.#clockSteps / this.#clockTotal, 0, 1);
    const clockH = PAD_H * left;
    renderer.rect(CLOCK_X, PAD_Y + PAD_H - clockH, GAUGE_W, clockH, COLOUR_CLOCK);

    const held = this.#drawSecondsHeld();
    const drawn = drawProgress(held);
    const drawH = PAD_H * drawn;
    renderer.rect(METER_X, PAD_Y + PAD_H - drawH, GAUGE_W, drawH, COLOUR_DRAWN);
    // Past full draw the same gauge shows the wobble growing, which is the thing the
    // player is deciding about.
    const wobble = (swayAmplitude(held) / SWAY_MAX) * PAD_H;
    if (wobble > 0) renderer.rect(METER_X, PAD_Y, GAUGE_W, Math.min(PAD_H, wobble), COLOUR_CLOCK);
  }

  /** The bow, drawn back as the string is pulled. */
  #drawArcher(renderer: Renderer): void {
    const drawn = this.#matchWinner === null ? drawProgress(this.#drawSecondsHeld()) : 0;
    const segments = 7;
    let previousX = BOW_X - BOW_RADIUS;
    let previousY = BOW_Y;
    for (let i = 1; i <= segments; i += 1) {
      const angle = Math.PI + (i / segments) * Math.PI;
      const x = BOW_X + Math.cos(angle) * BOW_RADIUS;
      const y = BOW_Y + Math.sin(angle) * BOW_RADIUS * 0.55;
      renderer.line(previousX, previousY, x, y, 6, COLOUR_STAND);
      previousX = x;
      previousY = y;
    }
    const nockY = BOW_Y + 12 + drawn * 22;
    renderer.line(BOW_X - BOW_RADIUS, BOW_Y, BOW_X, nockY, 2, COLOUR_SHAFT);
    renderer.line(BOW_X + BOW_RADIUS, BOW_Y, BOW_X, nockY, 2, COLOUR_SHAFT);
    if (this.#flightSteps === 0 && this.#matchWinner === null) {
      renderer.line(BOW_X, nockY, BOW_X, nockY - 54, 4, COLOUR_SHAFT);
      this.#seatMark(renderer, this.#active, BOW_X, nockY - 54, 5);
    }
  }

  /**
   * The arrow in the air.
   *
   * It leaves on the line the bow was pointing along and is bent off it by the wind as
   * it travels, so a player watching can see what the weather did to their shot rather
   * than merely reading the score afterwards.
   */
  #drawFlight(renderer: Renderer): void {
    if (this.#flightSteps <= 0) return;
    const t = clamp((this.#flightTotal - this.#flightSteps) / this.#flightTotal, 0, 1);
    const previous = clamp(t - 0.12, 0, 1);
    const headX = this.#flightX(t);
    const headY = this.#flightY(t);
    renderer.line(this.#flightX(previous), this.#flightY(previous), headX, headY, 4, COLOUR_SHAFT);
    this.#seatMark(renderer, this.#active, headX, headY, 5);
  }

  #flightX(t: number): number {
    const straight = targetX(this.#released.x);
    const drift = targetX(this.#landed.x) - straight;
    return BOW_X + (straight - BOW_X) * t + drift * t * t;
  }

  #flightY(t: number): number {
    const straight = targetY(this.#released.y);
    const drift = targetY(this.#landed.y) - straight;
    return BOW_Y + (straight - BOW_Y) * t + drift * t * t;
  }
}

export default {
  manifest,
  create: (): Game => new ArcheryGame(),
};
