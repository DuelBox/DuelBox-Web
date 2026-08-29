import { Rng, SEAT_PALETTE, SeatFlip, seatRotated, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  AIM_LIMIT,
  BOT_PROFILES,
  BOW_X,
  BOW_Y,
  GROUND_Y,
  MAX_FLIGHT_SECONDS,
  RACK_SIZE,
  ROUND_CAP,
  ROW_Y,
  TARGET_GOAL,
  TARGET_RADIUS,
  apexHeight,
  arrowXAt,
  arrowYAt,
  bestArrow,
  clamp,
  createAim,
  createBotPlan,
  createRack,
  createSeatState,
  createShotResult,
  gaussian,
  launchSpeed,
  planShot,
  recordArrow,
  recordHit,
  resetSeatState,
  resetShotResult,
  resolveShot,
  rollRack,
  shooterFor,
  targetXAt,
  topArrows,
  winnerOf,
} from './rules.js';
import type { Aim, BotDifficulty, BotPlan, SeatState, ShotResult, Target } from './rules.js';

/**
 * The aiming pad, in logical units.
 *
 * Exported because aiming is not a rendering question — the tests drive the same mapping
 * the game does, and a test that invented its own would be testing itself.
 *
 * It sits entirely below the shooting line, so it never covers a target and an arrow never
 * crosses it. Its two axes are the two numbers a shot is made of: across is where the bow
 * points, down is how far it is drawn.
 */
export const PAD_X = 40;
export const PAD_Y = 735;
export const PAD_W = 620;
export const PAD_H = 240;
export const PAD_CX = PAD_X + PAD_W / 2;
export const PAD_HALF_W = PAD_W / 2;

/**
 * Radians a second the keys swing the bow, and draws a second they pull it.
 *
 * Crossing the whole 1.7 rad of aim takes 1.36 s and going from slack to full draw 1.18 s,
 * against a 3.5 s shot clock — so a keyboard can reach every shot a thumb can, twice over,
 * which is the parity `docs/input-parity.md` asks for. Neither is the archery number: that
 * game's sight crosses a target face, this one's swings a bow through a wider arc.
 */
export const AIM_KEY_RATE = 1.25;
export const DRAW_KEY_RATE = 0.85;

/** Every delay is converted to whole steps before it is counted, so a replay is exact. */
const SETTLE_SECONDS = 0.2;
const BOT_THINK_SECONDS = 0.2;

/**
 * How long a seat has to loose, once the board has turned to face it.
 *
 * Every game has to guarantee its own termination and this is half of ours — the round cap
 * is the other half. With a clock on each shot a match is over in a bounded number of steps
 * whatever anybody does or fails to do, including nothing at all.
 */
const SHOT_CLOCK_SECONDS = 3.5;

/**
 * Spread on a bot's dwell, and the most it may ever take.
 *
 * The maximum matters: think plus dwell can reach 2.7 s against a 3.5 s clock, so a bot is
 * never cut off by the clock and never has to be handled as a special case. Both are
 * quantised to thirtieths of a second along with the dwell itself — see `#botDwellSeconds`.
 */
const BOT_DWELL_SPREAD = 0.12;
const BOT_DWELL_MAX = 2.4;
/**
 * And the least, which is not decoration.
 *
 * `#stepsFor` floors at one step, because nothing else in the game may take zero — so a
 * dwell that rounded down to nothing became *one step*, which is a sixtieth of a second on
 * one device and a hundred-and-twentieth on another. That is a different instant, twenty
 * drifting targets are in different places at it, and a marginal arrow flips: 3 of 240
 * bot matches finished on a different card at 60, 90 and 120 Hz, all of them by exactly
 * one target. A thirtieth divides all three rates and is the smallest thing that does.
 */
const BOT_DWELL_MIN = 1 / 30;

/** How much of the arc is shown ahead of the bow while aiming, in seconds of flight. */
const PREVIEW_SECONDS = 0.16;
const PREVIEW_DOTS = 5;

/** How far behind the head the arrow's shaft is drawn, in seconds of flight. */
const TRAIL_SECONDS = 0.05;

const COLOUR_SKY = '#d3e4f4';
const COLOUR_HAZE = '#c2d8ee';
const COLOUR_GRASS = '#4f8b54';
const COLOUR_GRASS_DEEP = '#3c6d43';
const COLOUR_HEDGE = '#2f5636';
const COLOUR_WOOD = '#7c5a3a';
const COLOUR_WHITE = '#f4f4ee';
const COLOUR_RED = '#e2574c';
const COLOUR_GOLD = '#f5cf3c';
const COLOUR_RIM = 'rgba(18, 22, 28, 0.55)';
const COLOUR_INK = '#14181f';
const COLOUR_MUTED = '#33414d';
const COLOUR_FAINT = 'rgba(20, 30, 40, 0.28)';
const COLOUR_PAD_FILL = 'rgba(20, 46, 26, 0.16)';
const COLOUR_PAD_LINE = '#2f5636';
const COLOUR_GAUGE_BACK = 'rgba(18, 30, 20, 0.30)';
const COLOUR_CLOCK = '#e2574c';
const COLOUR_DRAWN = '#f5cf3c';
const COLOUR_SHAFT = '#efe6d2';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;

/** Anything that is not a number becomes zero, so a bad value can never reach the maths. */
function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export class ArcheryMasterGame implements Game {
  readonly #logical: LogicalSize = manifest.logical;
  readonly #p1: SeatState = createSeatState();
  readonly #p2: SeatState = createSeatState();
  /**
   * One rack per round, rolled up front and shared by both seats.
   *
   * This is the fairness decision the whole game turns on. A rack rolled per *shot* would
   * hand one archer a row of targets standing in a line and the other a scattered one, and
   * the race would be decided by the draw rather than by either of them. Both seats shoot
   * round seven into exactly the same twenty targets, drifting from exactly the same phase,
   * because a turn's clock starts at zero for each of them.
   *
   * Rolled in `init` before the stream is touched by anything else, so the gallery of a
   * match is a function of the seed alone and of nothing that happens inside the match.
   */
  readonly #racks: readonly (readonly Target[])[] = Array.from({ length: ROUND_CAP }, createRack);
  readonly #shot: ShotResult = createShotResult();
  readonly #aim: Aim = createAim();
  /** The aim as it was at the release, so nothing can change it while the arrow flies. */
  readonly #released: Aim = createAim();
  readonly #plan: BotPlan = createBotPlan();
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();
  /** Which targets this arrow has already burst. Pooled; nothing is allocated in a match. */
  readonly #popped = new Uint8Array(RACK_SIZE);

  #rng = new Rng(1);
  #roundIndex = 0;
  #shotInRound = 0;
  #active: SeatId = 'p1';
  /** Who leads round one. The shell's, never assumed — see `GameContext.openingSeat`. */
  #opener: SeatId = 'p1';
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #stepsPerSecond = 0;
  /** Accepted steps since the board finished turning to face this seat. */
  #turnSteps = 0;
  #drawSteps = 0;
  #flightSteps = 0;
  #flightTotal = 1;
  #settleSteps = 0;
  /** -1 until the step rate is known, which is the first update of the turn. */
  #clockSteps = -1;
  #clockTotal = 1;
  #releaseSeconds = 0;
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
    this.#opener = context.openingSeat;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    resetSeatState(this.#p1);
    resetSeatState(this.#p2);
    for (const rack of this.#racks) rollRack(rack, this.#rng);
    this.#roundIndex = 0;
    this.#shotInRound = 0;
    this.#active = shooterFor(0, 0, this.#opener);
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
      this.#turnSteps += 1;
      this.#settleSteps -= 1;
      if (this.#settleSteps === 0) this.#advanceTurn();
      return;
    }

    // An arrow in the air: nothing is accepted until it lands, so a fast tapper cannot put
    // three arrows through the rack before the first one is scored.
    if (this.#flightSteps > 0) {
      this.#turnSteps += 1;
      this.#flightSteps -= 1;
      this.#burstReached(this.#flightSecondsElapsed());
      if (this.#flightSteps === 0) this.#land();
      return;
    }

    if (this.#clockSteps < 0) {
      this.#clockTotal = this.#stepsFor(SHOT_CLOCK_SECONDS);
      this.#clockSteps = this.#clockTotal;
    }

    // The board is turning: a tap on it now would land somewhere nobody aimed. The bot
    // waits through it too — it may not act on a step a person is not allowed to act on
    // (CLAUDE.md rule 6) — and the rack is held still for both of them alike, so the flip
    // changes how long a match takes on the wall clock and nothing about what happens in it.
    if (!this.#flip.acceptsInput) return;
    this.#turnSteps += 1;
    this.#clockSteps -= 1;

    const difficulty = this.#active === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      this.#botStep(difficulty);
      return;
    }

    const seatInput = input.seat(this.#active);

    // Where the finger is *is* where the bow is set: the pad is read absolutely, because a
    // finger held still has no drag to read and a relative scheme would go dead. Anywhere
    // off the pad clamps to its edge rather than being ignored, so no part of the board is
    // dead to a thumb.
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      this.#aim.angle = clamp((this.#pointerWorld.x - PAD_CX) / PAD_HALF_W, -1, 1) * AIM_LIMIT;
      this.#aim.power = clamp((this.#pointerWorld.y - PAD_Y) / PAD_H, 0, 1);
    }

    // Keys move the bow at a rate rather than jumping it, so a keyboard and a thumb are
    // comparable instruments rather than one of them being strictly finer. Down is a
    // deeper draw, which is the direction the pad already reads.
    const move = seatInput.move;
    if (move.x !== 0) {
      this.#aim.angle = clamp(
        this.#aim.angle + move.x * AIM_KEY_RATE * fixedDeltaSeconds,
        -AIM_LIMIT,
        AIM_LIMIT,
      );
    }
    if (move.y !== 0) {
      this.#aim.power = clamp(this.#aim.power + move.y * DRAW_KEY_RATE * fixedDeltaSeconds, 0, 1);
    }

    // Hold to draw, let go to loose — the same gesture on both instruments, because a
    // finger on the glass and a held key are the one intent the engine reports as
    // `actionHeld`. A press that has not held for a step is a fumbled nock and does
    // nothing, so a stray touch never costs an arrow.
    if (seatInput.actionHeld) this.#drawSteps += 1;
    if (seatInput.actionReleased && this.#drawSteps > 0) {
      this.#loose();
      return;
    }
    if (this.#clockSteps <= 0) this.#loose();
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_SKY);
    renderer.pushRotation(this.#flip.angle);
    this.#drawField(renderer);
    this.#drawRack(renderer);
    this.#drawReachLine(renderer);
    this.#drawPreview(renderer);
    this.#drawArrow(renderer);
    this.#drawBow(renderer);
    this.#drawCards(renderer);
    this.#drawPad(renderer);
    this.#drawGauges(renderer);
    renderer.popSeatRotation();
  }

  /**
   * A pause drops every key and pointer without an accompanying release, so a bow that was
   * drawn when the menu opened would otherwise come back still drawn and loose a shot the
   * player never took. The nock is simply let down.
   */
  onPause(): void {
    this.#drawSteps = 0;
  }

  onResume(): void {}

  getScore(): MatchScore {
    return { p1: this.#p1.targets, p2: this.#p2.targets, winner: this.#matchWinner };
  }

  destroy(): void {
    resetSeatState(this.#p1);
    resetSeatState(this.#p2);
    resetShotResult(this.#shot);
    this.#popped.fill(0);
    this.#drawSteps = 0;
    this.#flightSteps = 0;
    this.#settleSteps = 0;
  }

  // -------------------------------------------------------------------------
  // Read-only views, for the tests and the balance harness
  // -------------------------------------------------------------------------

  get activeSeat(): SeatId {
    return this.#active;
  }

  get roundIndex(): number {
    return this.#roundIndex;
  }

  get shotInRound(): number {
    return this.#shotInRound;
  }

  get aimAngle(): number {
    return this.#aim.angle;
  }

  get aimPower(): number {
    return this.#aim.power;
  }

  get arrowInFlight(): boolean {
    return this.#flightSteps > 0;
  }

  get lastShotCount(): number {
    return this.#shot.count;
  }

  get lastShotSeconds(): number {
    return this.#shot.seconds;
  }

  get burstCount(): number {
    let total = 0;
    for (let i = 0; i < RACK_SIZE; i += 1) total += this.#popped[i] === 1 ? 1 : 0;
    return total;
  }

  get turnSeconds(): number {
    return this.#turnSecondsNow();
  }

  get shotClockSeconds(): number {
    if (this.#clockSteps < 0 || this.#stepsPerSecond === 0) return SHOT_CLOCK_SECONDS;
    return Math.max(0, this.#clockSteps) / this.#stepsPerSecond;
  }

  rackFor(roundIndex: number): readonly Target[] {
    return this.#racks[clamp(roundIndex, 0, ROUND_CAP - 1)] ?? this.#racks[0] ?? [];
  }

  targetsFor(seat: SeatId): number {
    return this.#stateOf(seat).targets;
  }

  arrowsFor(seat: SeatId): number {
    return this.#stateOf(seat).arrows;
  }

  bestFor(seat: SeatId): number {
    return bestArrow(this.#stateOf(seat));
  }

  topArrowsFor(seat: SeatId): number {
    return topArrows(this.#stateOf(seat));
  }

  blanksFor(seat: SeatId): number {
    return this.#stateOf(seat).blanks;
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  #stateOf(seat: SeatId): SeatState {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  #currentRack(): readonly Target[] {
    return this.#racks[Math.min(this.#roundIndex, ROUND_CAP - 1)] ?? this.#racks[0] ?? [];
  }

  #turnSecondsNow(): number {
    if (this.#stepsPerSecond === 0) return 0;
    return this.#turnSteps / this.#stepsPerSecond;
  }

  #flightSecondsElapsed(): number {
    if (this.#stepsPerSecond === 0) return 0;
    return (this.#flightTotal - this.#flightSteps) / this.#stepsPerSecond;
  }

  #stepsFor(seconds: number): number {
    const rate = this.#stepsPerSecond === 0 ? 60 : this.#stepsPerSecond;
    const steps = Math.round(seconds * rate);
    return steps < 1 ? 1 : steps;
  }

  /** Fresh bow, fresh clock, and a rack nobody has shot at yet. */
  #beginTurn(): void {
    this.#aim.angle = 0;
    this.#aim.power = 0;
    this.#drawSteps = 0;
    this.#turnSteps = 0;
    this.#clockSteps = -1;
    this.#botPlanned = false;
    this.#botThinkSteps = 0;
    this.#botReleaseSteps = 0;
    this.#popped.fill(0);
  }

  /**
   * How long this tier settles before loosing, rounded to a thirtieth of a second.
   *
   * The rounding is what makes a whole bot match bit-identical at 60, 90 and 120 Hz: the
   * instant an arrow leaves the string decides where twenty drifting targets are, so a
   * release quantised to the step of whichever rate the device happens to run at would
   * resolve a marginally different shot on each of them. A thirtieth divides all three.
   */
  #botDwellSeconds(profile: { readonly dwell: number }): number {
    const raw = profile.dwell + gaussian(this.#rng) * BOT_DWELL_SPREAD;
    const bounded = clamp(raw, BOT_DWELL_MIN, BOT_DWELL_MAX);
    return Math.round(bounded * 30) / 30;
  }

  /**
   * One step of a bot's turn.
   *
   * It plans once — which target, which arc, and how badly its hand will stray — and then
   * settles on the clock everybody else is on. Everything it reads is on the screen: the
   * twenty targets, their drift, and its own bow.
   */
  #botStep(difficulty: BotDifficulty): void {
    const profile = BOT_PROFILES[difficulty];
    if (!this.#botPlanned) {
      this.#botThinkSteps = this.#stepsFor(BOT_THINK_SECONDS);
      this.#botReleaseSteps = this.#botThinkSteps + this.#stepsFor(this.#botDwellSeconds(profile));
      const rate = this.#stepsPerSecond === 0 ? 60 : this.#stepsPerSecond;
      // It plans for the instant it means to loose, not for the instant it is thinking,
      // which is what a person does when they say "I will shoot when it gets there".
      planShot(this.#plan, this.#currentRack(), profile, this.#botReleaseSteps / rate, this.#rng);
      this.#aim.angle = this.#plan.chosen.angle;
      this.#aim.power = this.#plan.chosen.power;
      this.#botPlanned = true;
    }
    if (this.#turnSteps >= this.#botReleaseSteps || this.#clockSteps <= 0) this.#loose();
  }

  /** Let the string go. The aim is whatever is stored, from either instrument or the bot. */
  #loose(): void {
    // `finite` before `clamp`, because a comparison against NaN is false in both
    // directions and a clamp would hand it straight back: one bad number would then put
    // the arrow at NaN and every hit test after it would silently answer no.
    this.#released.angle = clamp(finite(this.#aim.angle), -AIM_LIMIT, AIM_LIMIT);
    this.#released.power = clamp(finite(this.#aim.power), 0, 1);
    this.#releaseSeconds = this.#turnSecondsNow();
    resolveShot(this.#shot, this.#currentRack(), this.#released, this.#releaseSeconds);
    this.#popped.fill(0);
    this.#drawSteps = 0;
    this.#flightTotal = this.#stepsFor(this.#shot.seconds);
    this.#flightSteps = this.#flightTotal;
  }

  /**
   * Burst every target the arrow has reached by now.
   *
   * The shot was decided in one closed form at the release; this only reveals it in the
   * order the arrow gets there, so a player watches the arrow take three targets rather
   * than reading a number afterwards.
   */
  #burstReached(elapsed: number): void {
    const hits = this.#shot.hitAt;
    for (let index = 0; index < RACK_SIZE; index += 1) {
      if (this.#popped[index] === 1) continue;
      const at = hits[index] ?? -1;
      if (at < 0 || at > elapsed) continue;
      this.#popped[index] = 1;
      recordHit(this.#stateOf(this.#active));
    }
  }

  #land(): void {
    // Whatever the last step's rounding left, so the card always matches the arrow: the
    // flight is counted in whole steps and its true duration is not a whole number of them.
    this.#burstReached(MAX_FLIGHT_SECONDS);
    recordArrow(this.#stateOf(this.#active), this.#shot.count);
    this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
  }

  /**
   * Pass the shot on, and settle the match at a round boundary if it is over.
   *
   * A race may never be decided in the middle of a round. Both seats shoot every round, so
   * a seat that crosses seventy is answered before anything is awarded — which is the whole
   * reason shooting first is not an advantage here.
   */
  #advanceTurn(): void {
    if (this.#shotInRound === 0) {
      this.#shotInRound = 1;
      this.#active = shooterFor(this.#roundIndex, 1, this.#opener);
      this.#beginTurn();
      return;
    }
    const nextRound = this.#roundIndex + 1;
    const winner = winnerOf(this.#p1, this.#p2, true, nextRound >= ROUND_CAP);
    if (winner !== null) {
      this.#matchWinner = winner;
      return;
    }
    this.#roundIndex = nextRound;
    this.#shotInRound = 0;
    this.#active = shooterFor(nextRound, 0, this.#opener);
    this.#beginTurn();
  }

  /** The orientation the field should be in, which the flip tweens towards. */
  #shouldRotate(): boolean {
    return seatRotated(this.#active, this.#presentation, this.#localSeat);
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
   * The same pair everywhere a seat owns something — the hand on the pad, the arrow on the
   * string, the arrow in the air, the two cards — because rule 7 does not stop while a
   * thing is moving, and the arrow is exactly what a player is watching.
   */
  #seatMark(renderer: Renderer, seat: SeatId, x: number, y: number, radius: number): void {
    const colour = this.#seatColour(seat);
    if (seat === 'p1') renderer.circle(x, y, radius, colour);
    else renderer.rect(x - radius, y - radius, radius * 2, radius * 2, colour);
  }

  #drawField(renderer: Renderer): void {
    renderer.rect(0, 0, 700, 120, COLOUR_HAZE);
    renderer.rect(0, GROUND_Y, 700, 1000 - GROUND_Y, COLOUR_GRASS);
    renderer.rect(0, GROUND_Y - 10, 700, 10, COLOUR_HEDGE);
    renderer.rect(0, PAD_Y - 20, 700, 1000 - PAD_Y + 20, COLOUR_GRASS_DEEP);
    // A post under every row, so the rows read as four racks standing in a field rather
    // than as targets floating in the air.
    for (const y of ROW_Y) {
      renderer.line(30, y + TARGET_RADIUS + 6, 670, y + TARGET_RADIUS + 6, 2, COLOUR_FAINT);
    }
  }

  /**
   * The twenty targets, and the holes where an arrow has been through.
   *
   * A standing target is a disc with a rim and a cross through the middle; a burst one is
   * an open ring with the cross gone. The two read apart with no colour at all, which is
   * what a player is counting.
   */
  #drawRack(renderer: Renderer): void {
    const rack = this.#currentRack();
    const seconds = this.#turnSecondsNow();
    for (let index = 0; index < rack.length; index += 1) {
      const target = rack[index];
      if (target === undefined) continue;
      const x = targetXAt(target, seconds);
      const y = target.y;
      if (this.#popped[index] === 1) {
        renderer.strokeCircle(x, y, TARGET_RADIUS, 3, COLOUR_FAINT);
        renderer.line(x - 9, y - 9, x + 9, y + 9, 3, COLOUR_FAINT);
        continue;
      }
      renderer.circle(x, y, TARGET_RADIUS, COLOUR_WHITE);
      renderer.circle(x, y, TARGET_RADIUS * 0.62, COLOUR_RED);
      renderer.circle(x, y, TARGET_RADIUS * 0.26, COLOUR_GOLD);
      renderer.strokeCircle(x, y, TARGET_RADIUS, 2.5, COLOUR_RIM);
      renderer.line(x - 7, y, x + 7, y, 2, COLOUR_INK);
      renderer.line(x, y - 7, x, y + 7, 2, COLOUR_INK);
    }
  }

  /**
   * How high this draw tops out, drawn straight across the gallery.
   *
   * The one readout that makes the draw legible, and it is honest: it is a function of the
   * player's own bow and of nothing on the field, so it says how far the arrow can reach
   * and never where it will land. Reading the drift and picking the line is left alone.
   */
  #drawReachLine(renderer: Renderer): void {
    if (this.#matchWinner !== null || this.#flightSteps > 0) return;
    const y = BOW_Y - apexHeight(this.#aim);
    if (y < 0 || y > GROUND_Y) return;
    const colour = this.#seatColour(this.#active);
    for (let x = 20; x < 680; x += 28) {
      renderer.line(x, y, x + 14, y, 2, colour);
    }
    renderer.text('REACH', 690, y, 16, colour, 'right');
  }

  /** The first sixth of a second of the arc, so the bow points at something readable. */
  #drawPreview(renderer: Renderer): void {
    if (this.#matchWinner !== null || this.#flightSteps > 0) return;
    const colour = this.#seatColour(this.#active);
    for (let i = 1; i <= PREVIEW_DOTS; i += 1) {
      const seconds = (PREVIEW_SECONDS * i) / PREVIEW_DOTS;
      const x = arrowXAt(this.#aim, seconds);
      const y = arrowYAt(this.#aim, seconds);
      if (y < 0 || y > GROUND_Y || x < 0 || x > 700) return;
      renderer.circle(x, y, 4, colour);
    }
  }

  /** The arrow in the air, on exactly the arc it was resolved along. */
  #drawArrow(renderer: Renderer): void {
    if (this.#flightSteps <= 0) return;
    const seconds = this.#flightSecondsElapsed();
    const back = Math.max(0, seconds - TRAIL_SECONDS);
    const headX = arrowXAt(this.#released, seconds);
    const headY = arrowYAt(this.#released, seconds);
    renderer.line(
      arrowXAt(this.#released, back),
      arrowYAt(this.#released, back),
      headX,
      headY,
      3,
      COLOUR_SHAFT,
    );
    this.#seatMark(renderer, this.#active, headX, headY, 5);
  }

  /** The bow, with the string pulled back as far as the draw has taken it. */
  #drawBow(renderer: Renderer): void {
    const drawn = this.#matchWinner === null && this.#flightSteps === 0 ? this.#aim.power : 0;
    const radius = 46;
    const segments = 7;
    let previousX = BOW_X - radius * 0.62;
    let previousY = BOW_Y + 26;
    for (let i = 1; i <= segments; i += 1) {
      const angle = Math.PI + (i / segments) * Math.PI;
      const x = BOW_X + Math.cos(angle) * radius * 0.62;
      const y = BOW_Y + 26 + Math.sin(angle) * radius;
      renderer.line(previousX, previousY, x, y, 6, COLOUR_WOOD);
      previousX = x;
      previousY = y;
    }
    const nockY = BOW_Y + 26 + drawn * 30;
    renderer.line(BOW_X - radius * 0.62, BOW_Y + 26 - radius, BOW_X, nockY, 2, COLOUR_SHAFT);
    renderer.line(BOW_X - radius * 0.62, BOW_Y + 26 + radius, BOW_X, nockY, 2, COLOUR_SHAFT);
    if (this.#flightSteps === 0 && this.#matchWinner === null) {
      const tipX = BOW_X + Math.sin(this.#aim.angle) * 54;
      const tipY = nockY - Math.cos(this.#aim.angle) * 54;
      renderer.line(BOW_X, nockY, tipX, tipY, 4, COLOUR_SHAFT);
      this.#seatMark(renderer, this.#active, tipX, tipY, 5);
    }
  }

  /** A card a side: the seat's mark, its count out of seventy, and its best arrow. */
  #drawCards(renderer: Renderer): void {
    renderer.text(`RACE TO ${String(TARGET_GOAL)}`, 350, 26, 20, COLOUR_MUTED, 'centre');
    this.#drawCard(renderer, 'p1', 18, 'left');
    this.#drawCard(renderer, 'p2', 682, 'right');
  }

  #drawCard(renderer: Renderer, seat: SeatId, x: number, align: 'left' | 'right'): void {
    const state = this.#stateOf(seat);
    const colour = this.#seatColour(seat);
    const markX = align === 'left' ? x + 11 : x - 11;
    if (seat === 'p1') renderer.circle(markX, 60, 11, colour);
    else renderer.rect(markX - 10, 50, 20, 20, colour);
    renderer.text(`${String(state.targets)}/${String(TARGET_GOAL)}`, x, 96, 26, COLOUR_INK, align);
    // A bar as well as a number, so the race is readable at a glance from across a table.
    const barX = align === 'left' ? x : x - 96;
    const filled = Math.min(1, state.targets / TARGET_GOAL) * 96;
    renderer.rect(barX, 112, 96, 9, COLOUR_GAUGE_BACK);
    renderer.rect(align === 'left' ? barX : barX + 96 - filled, 112, filled, 9, colour);
    renderer.text(`BEST x${String(bestArrow(state))}`, x, 138, 16, COLOUR_MUTED, align);
    renderer.text(`ARROWS ${String(state.arrows)}`, x, 158, 16, COLOUR_MUTED, align);
  }

  /**
   * The pad, and the hand on it.
   *
   * The mark carries the active seat's shape as well as its colour, so which archer is
   * shooting is legible without relying on the colour alone — and so is the axis it sits
   * on: across is where the bow points, down is how far it is drawn, both written on it.
   */
  #drawPad(renderer: Renderer): void {
    renderer.rect(PAD_X, PAD_Y, PAD_W, PAD_H, COLOUR_PAD_FILL);
    renderer.strokeRect(PAD_X, PAD_Y, PAD_W, PAD_H, 3, COLOUR_PAD_LINE);
    renderer.line(PAD_CX, PAD_Y + 8, PAD_CX, PAD_Y + PAD_H - 8, 1, COLOUR_PAD_LINE);
    renderer.text('AIM', PAD_CX, PAD_Y + 16, 15, COLOUR_PAD_LINE, 'centre');
    renderer.text('DRAW', PAD_X + 34, PAD_Y + PAD_H - 14, 15, COLOUR_PAD_LINE, 'centre');
    if (this.#matchWinner !== null) return;

    const colour = this.#seatColour(this.#active);
    const handX = PAD_CX + (this.#aim.angle / AIM_LIMIT) * PAD_HALF_W;
    const handY = PAD_Y + this.#aim.power * PAD_H;
    if (this.#active === 'p1') {
      renderer.circle(handX, handY, 15, colour);
      renderer.strokeCircle(handX, handY, 15, 3, COLOUR_INK);
    } else {
      renderer.rect(handX - 14, handY - 14, 28, 28, colour);
      renderer.strokeRect(handX - 14, handY - 14, 28, 28, 3, COLOUR_INK);
    }
  }

  /** Two gauges: how long is left to loose, and how fast this arrow will leave. */
  #drawGauges(renderer: Renderer): void {
    const gaugeW = 16;
    const clockX = 12;
    const drawX = 700 - 12 - gaugeW;
    renderer.rect(clockX, PAD_Y, gaugeW, PAD_H, COLOUR_GAUGE_BACK);
    renderer.rect(drawX, PAD_Y, gaugeW, PAD_H, COLOUR_GAUGE_BACK);
    if (this.#matchWinner !== null) return;

    // Read the same way `shotClockSeconds` reads it: a turn that has begun but has not had
    // an update yet sits at -1, and taken as a count that would draw an empty clock for the
    // frame or two before the board finishes turning.
    const left =
      this.#clockSteps < 0 || this.#clockTotal <= 0
        ? 1
        : clamp(this.#clockSteps / this.#clockTotal, 0, 1);
    const clockH = PAD_H * left;
    renderer.rect(clockX, PAD_Y + PAD_H - clockH, gaugeW, clockH, COLOUR_CLOCK);

    const drawH = PAD_H * clamp(this.#aim.power, 0, 1);
    renderer.rect(drawX, PAD_Y + PAD_H - drawH, gaugeW, drawH, COLOUR_DRAWN);
    renderer.text(
      `${String(Math.round(launchSpeed(this.#aim.power)))}`,
      drawX + gaugeW / 2,
      PAD_Y - 12,
      15,
      COLOUR_MUTED,
      'centre',
    );
  }
}

export default {
  manifest,
  create: (): Game => new ArcheryMasterGame(),
};
