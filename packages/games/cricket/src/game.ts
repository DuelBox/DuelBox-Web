import { seatPalette, toWorld, vec2 } from '@duelbox/engine';
import type { SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BALLS_PER_INNINGS,
  BOUNDARY_R,
  BOT_PROFILES,
  CONTACT_FLOOR,
  FIELDERS,
  GROUND_CX,
  GROUND_CY,
  HEIGHT_MAX,
  INNINGS_PER_MATCH,
  KEEPER,
  PACE_MAX,
  PACE_MIN,
  RELEASE_DISTANCE,
  RELEASE_Y,
  STUMP_HALF_WIDTH,
  SWING_LEAD,
  WIDE_HALF_WIDTH,
  aimForBatX,
  arrivalX,
  ballX,
  ballY,
  battingSeat,
  botBatX,
  botBowl,
  botTimingError,
  bowlingSeat,
  contactQuality,
  createDelivery,
  createInnings,
  createShot,
  flightSeconds,
  heightAt,
  inningsComplete,
  isDismissal,
  recordBall,
  resetInnings,
  resolveShot,
  rollSwing,
  runsFor,
  scoreMiss,
  scoreShot,
  shotLandingX,
  shotLandingY,
  winnerOf,
  type BallOutcome,
  type BotProfile,
  type Delivery,
  type InningsState,
  type Shot,
} from './rules.js';

/**
 * Cricket: the simulation and the picture.
 *
 * Every rule lives in `rules.ts`; this file owns the clock, the two seats' controls and
 * the ground. It is a real-time game rather than a turn-based one on purpose — the bowler
 * is running in while the striker is watching the ball, which is one moment, not two, and
 * a game that handed the device to one seat at a time could not express it. That is why
 * there is no `getActiveSeat` here: declaring it is what tells the shell to hand the whole
 * board and both keyboard halves to a single seat.
 */

/** Longest a bowler may dawdle before the ball is bowled for them, in seconds. */
const MAX_RUNUP = 3.5;
/** Seconds of held action for a full-pace delivery. */
const CHARGE_FULL = 1.0;
/** How long the result of a ball stays on screen before the next one. */
const SETTLE_SECONDS = 1.4;
/** How long the ball takes to reach where it was hit, for the eye rather than the rules. */
const SETTLE_TRAVEL = 0.75;
/** The gap between innings, where the scorecard is read. */
const BREAK_SECONDS = 2.2;

/** How fast the keyboard slides the bowler's line and walks their length. */
const LINE_SPEED = 210;
const LENGTH_SPEED = 0.8;
/** How fast the keyboard slides the bat. Deliberately brisk: the ball does not wait. */
const BAT_SPEED = 330;

/** How far across the ground the bat and the bowler's line may travel. */
const AIM_LIMIT = BOUNDARY_R - 40;

type Phase = 'runup' | 'flight' | 'settle' | 'break' | 'over';

export class CricketGame implements Game {
  #context: GameContext | null = null;

  // ---- match ----
  #innings = 0;
  readonly #cards: Readonly<Record<SeatId, InningsState>> = {
    p1: createInnings(),
    p2: createInnings(),
  };
  #phase: Phase = 'runup';
  #phaseSeconds = 0;
  #complete = false;

  // ---- the delivery being bowled ----
  readonly #delivery: Delivery = createDelivery();
  readonly #shot: Shot = createShot();
  #charge = 0;
  #flight = 0;
  #elapsed = 0;

  // ---- the shot being played ----
  #batX = GROUND_CX;
  /** Seconds into the flight at which the striker swung, or -1 if they have not. */
  #swungAt = -1;
  #lastQuality = 0;
  #lastOutcome: BallOutcome | null = null;

  // ---- where the ball is, for the renderer ----
  #ballX = GROUND_CX;
  #ballY = RELEASE_Y;
  #ballHeight = 0;
  #bounced = false;

  // ---- bot intentions, decided once per ball ----
  #botReleaseAt = 0;
  #botBatX = GROUND_CX;
  #botSwingAt = -1;
  #botHasSwung = false;

  /** Preallocated, because converting a pointer runs every step for both seats. */
  readonly #world: Vec2 = vec2();

  init(context: GameContext): void {
    this.#context = context;
    this.#innings = 0;
    resetInnings(this.#cards.p1);
    resetInnings(this.#cards.p2);
    this.#complete = false;
    this.#lastOutcome = null;
    this.#beginRunUp();
  }

  // -------------------------------------------------------------------------
  // Who is doing what
  // -------------------------------------------------------------------------

  /** The seat batting this innings. Reads the shell's opener rather than assuming `p1`. */
  #striker(): SeatId {
    return battingSeat(this.#innings, this.#context?.openingSeat ?? 'p1');
  }

  #bowler(): SeatId {
    return bowlingSeat(this.#innings, this.#context?.openingSeat ?? 'p1');
  }

  #profileFor(seat: SeatId): BotProfile | null {
    const difficulty = this.#context?.botDifficulty(seat) ?? null;
    return difficulty ? BOT_PROFILES[difficulty] : null;
  }

  /**
   * True when the world is drawn a half turn round.
   *
   * The ground is drawn canonically with the bowler at the top, which is the far seat's
   * end. When `p1` is bowling the whole world turns so that their end is nearest them —
   * one rotation for both seats, because the ground is one shared board, not two halves.
   */
  #rotated(): boolean {
    return this.#bowler() === 'p1';
  }

  /** A seat's pointer in world units, or null when that seat has no pointer down. */
  #pointerWorld(input: InputState, seat: SeatId): Vec2 | null {
    const pointer = input.seat(seat).pointer;
    if (!pointer) return null;
    return toWorld(this.#world, pointer.x, pointer.y, manifest.logical, this.#rotated());
  }

  // -------------------------------------------------------------------------
  // The simulation
  // -------------------------------------------------------------------------

  update(dt: number, input: InputState): void {
    if (this.#complete) return;
    this.#phaseSeconds += dt;

    switch (this.#phase) {
      case 'runup':
        this.#updateRunUp(dt, input);
        break;
      case 'flight':
        this.#updateFlight(dt, input);
        break;
      case 'settle':
        this.#updateSettle(dt);
        break;
      case 'break':
        if (this.#phaseSeconds >= BREAK_SECONDS) this.#nextInnings();
        break;
      default:
        break;
    }
  }

  #beginRunUp(): void {
    this.#phase = 'runup';
    this.#phaseSeconds = 0;
    this.#charge = 0;
    this.#swungAt = -1;
    this.#lastQuality = 0;
    this.#batX = GROUND_CX;
    this.#ballX = GROUND_CX;
    this.#ballY = RELEASE_Y;
    this.#ballHeight = 0;
    this.#bounced = false;
    this.#delivery.line = GROUND_CX;
    this.#delivery.length = 0.45;
    this.#delivery.swing = 0;

    const context = this.#context;
    if (!context) return;

    // Both bots decide everything they are going to do before the ball is live, from the
    // seeded stream and from nothing else. A bot that could keep deciding during the
    // flight would be reacting faster than a hand can, which rule 6 forbids.
    const bowlerProfile = this.#profileFor(this.#bowler());
    if (bowlerProfile) {
      botBowl(this.#delivery, bowlerProfile, context.rng);
      this.#botReleaseAt = 0.45 + context.rng.float() * 0.5;
    } else {
      this.#botReleaseAt = -1;
    }

    this.#botSwingAt = -1;
    this.#botHasSwung = false;
    this.#botBatX = GROUND_CX;
  }

  #updateRunUp(dt: number, input: InputState): void {
    const bowler = this.#bowler();
    const seat = input.seat(bowler);
    const isBot = this.#botReleaseAt >= 0;

    if (isBot) {
      // The bot has already chosen its ball; it only has to let go of it.
      this.#charge = Math.min(CHARGE_FULL, this.#charge + dt);
      if (this.#phaseSeconds >= this.#botReleaseAt) {
        this.#release(this.#delivery.pace);
        return;
      }
    } else {
      const pointer = this.#pointerWorld(input, bowler);
      if (pointer) {
        // Drag to the spot on the pitch the ball should land on: across for the line, and
        // up the pitch for the length. Closer to the striker is fuller and lower.
        this.#delivery.line = clamp(pointer.x, GROUND_CX - AIM_LIMIT, GROUND_CX + AIM_LIMIT);
        this.#delivery.length = clamp01((GROUND_CY - pointer.y) / RELEASE_DISTANCE);
      } else {
        this.#delivery.line = clamp(
          this.#delivery.line + seat.move.x * LINE_SPEED * dt,
          GROUND_CX - AIM_LIMIT,
          GROUND_CX + AIM_LIMIT,
        );
        this.#delivery.length = clamp01(this.#delivery.length + seat.move.y * LENGTH_SPEED * dt);
      }

      if (seat.actionHeld) this.#charge = Math.min(CHARGE_FULL, this.#charge + dt);
      // A cancelled gesture abandons the run-up rather than bowling a ball nobody meant to.
      if (seat.pointerCancelled) this.#charge = 0;
      if (seat.actionReleased && this.#charge > 0) {
        this.#release(PACE_MIN + (PACE_MAX - PACE_MIN) * (this.#charge / CHARGE_FULL));
        return;
      }
      if (this.#phaseSeconds >= MAX_RUNUP) {
        // Nobody may stall the match. An unbowled ball is bowled at whatever it had.
        this.#release(PACE_MIN + (PACE_MAX - PACE_MIN) * (this.#charge / CHARGE_FULL));
        return;
      }
    }

    this.#trackBat(dt, input);
  }

  #release(pace: number): void {
    const context = this.#context;
    this.#delivery.pace = clamp(pace, PACE_MIN, PACE_MAX);
    if (context) rollSwing(this.#delivery, context.rng);

    this.#flight = flightSeconds(this.#delivery);
    this.#elapsed = 0;
    this.#phase = 'flight';
    this.#phaseSeconds = 0;
    this.#swungAt = -1;
    this.#bounced = false;

    // The striker's bot commits to a moment and a place now, before the ball is live.
    const strikerProfile = this.#profileFor(this.#striker());
    if (strikerProfile && context) {
      this.#botBatX = botBatX(this.#delivery, strikerProfile, context.rng);
      const error = botTimingError(strikerProfile, context.rng);
      // It intends to meet the ball as it arrives; `error` is the hand it actually has.
      this.#botSwingAt = this.#flight - SWING_LEAD + error;
      this.#botHasSwung = false;
    } else {
      this.#botSwingAt = -1;
    }

    context?.audio?.emit('launch', this.#delivery.pace / PACE_MAX, this.#bowler());
  }

  #updateFlight(dt: number, input: InputState): void {
    this.#elapsed += dt;
    const progress = this.#flight > 0 ? this.#elapsed / this.#flight : 1;

    this.#ballX = ballX(this.#delivery, progress);
    this.#ballY = ballY(progress);
    this.#ballHeight = heightAt(this.#delivery, progress);

    if (!this.#bounced && progress >= 0.68) {
      this.#bounced = true;
      this.#context?.audio?.emit('bounce', 0.5, this.#bowler());
    }

    this.#trackBat(dt, input);

    if (progress >= 1) this.#resolveBall();
  }

  /**
   * Move the bat and take the swing.
   *
   * Runs during the run-up as well as the flight, so the striker can take guard before the
   * ball is live rather than starting every delivery from the middle.
   */
  #trackBat(dt: number, input: InputState): void {
    const striker = this.#striker();

    if (this.#botSwingAt >= 0) {
      this.#batX = this.#botBatX;
      if (!this.#botHasSwung && this.#phase === 'flight' && this.#elapsed >= this.#botSwingAt) {
        this.#botHasSwung = true;
        this.#swungAt = this.#elapsed;
      }
      return;
    }
    if (this.#profileFor(striker)) return; // a bot that has not been given a ball yet

    const seat = input.seat(striker);
    const pointer = this.#pointerWorld(input, striker);
    if (pointer) {
      this.#batX = clamp(pointer.x, GROUND_CX - AIM_LIMIT, GROUND_CX + AIM_LIMIT);
    } else {
      this.#batX = clamp(
        this.#batX + seat.move.x * BAT_SPEED * dt,
        GROUND_CX - AIM_LIMIT,
        GROUND_CX + AIM_LIMIT,
      );
    }

    // One swing a ball, and only once it is on its way. Pressing during the run-up is a
    // flinch, not a shot, and it must not silently consume the delivery.
    if (this.#phase === 'flight' && this.#swungAt < 0 && seat.actionPressed) {
      this.#swungAt = this.#elapsed;
    }
  }

  /** Work out what the ball was worth, put it on the card, and start the next one. */
  #resolveBall(): void {
    const striker = this.#striker();
    const card = this.#cards[striker];

    let outcome: BallOutcome;
    if (this.#swungAt >= 0) {
      // The striker committed at `#swungAt`; the bat is in the zone `SWING_LEAD` later.
      const timingError = this.#flight - (this.#swungAt + SWING_LEAD);
      const lateralError = this.#batX - arrivalX(this.#delivery);
      const quality = contactQuality(timingError, lateralError);
      this.#lastQuality = quality;
      if (quality > CONTACT_FLOOR) {
        resolveShot(this.#shot, quality, aimForBatX(this.#batX), this.#delivery);
        outcome = scoreShot(this.#shot);
      } else {
        outcome = scoreMiss(this.#delivery);
      }
    } else {
      this.#lastQuality = 0;
      outcome = scoreMiss(this.#delivery);
    }

    recordBall(card, outcome);
    this.#lastOutcome = outcome;
    this.#announce(outcome);

    this.#phase = 'settle';
    this.#phaseSeconds = 0;
  }

  #announce(outcome: BallOutcome): void {
    const audio = this.#context?.audio;
    if (!audio) return;
    if (isDismissal(outcome)) {
      audio.emit('fault', 1, this.#striker());
      return;
    }
    if (outcome === 'wide') {
      audio.emit('fault', 0.4, this.#bowler());
      return;
    }
    if (runsFor(outcome) >= 4) {
      audio.emit('score', 1, this.#striker());
      return;
    }
    if (this.#lastQuality > 0) audio.emit('hit', this.#lastQuality, this.#striker());
  }

  #updateSettle(dt: number): void {
    void dt;
    // Walk the ball out to wherever the shot sent it, purely so the eye can follow it.
    const travel = clamp01(this.#phaseSeconds / SETTLE_TRAVEL);
    const struck = this.#lastQuality > CONTACT_FLOOR;
    const targetX = struck ? shotLandingX(this.#shot) : KEEPER.x;
    const targetY = struck ? shotLandingY(this.#shot) : KEEPER.y;
    this.#ballX = GROUND_CX + (targetX - GROUND_CX) * travel;
    this.#ballY = GROUND_CY + (targetY - GROUND_CY) * travel;
    // An arc, so a six looks like a six and a cut along the ground does not.
    const apex = struck ? this.#shot.loft * 2.4 : 0.2;
    this.#ballHeight = apex * Math.sin(Math.PI * travel);

    if (this.#phaseSeconds < SETTLE_SECONDS) return;

    const card = this.#cards[this.#striker()];
    if (inningsComplete(card)) {
      if (this.#innings + 1 >= INNINGS_PER_MATCH) {
        this.#complete = true;
        this.#phase = 'over';
        this.#context?.audio?.emit('win', 1, null);
        return;
      }
      this.#phase = 'break';
      this.#phaseSeconds = 0;
      return;
    }
    this.#beginRunUp();
  }

  #nextInnings(): void {
    this.#innings += 1;
    this.#beginRunUp();
  }

  // -------------------------------------------------------------------------
  // The picture
  // -------------------------------------------------------------------------

  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear('#1d6b3a');
    renderer.pushSeatRotation(this.#rotated());

    this.#drawGround(renderer);
    this.#drawFielders(renderer);
    this.#drawPitch(renderer);
    this.#drawStumps(renderer);
    this.#drawBat(renderer);
    this.#drawBall(renderer);

    renderer.popSeatRotation();
    this.#drawCard(renderer);
  }

  #drawGround(renderer: Renderer): void {
    renderer.circle(GROUND_CX, GROUND_CY, BOUNDARY_R, '#2c8a4a');
    renderer.strokeCircle(GROUND_CX, GROUND_CY, BOUNDARY_R, 5, '#f4f7f2');
    // The inner ring is a distance marker, and it is what tells the striker at a glance
    // whether a shot is worth one or three.
    renderer.strokeCircle(GROUND_CX, GROUND_CY, 200, 2, 'rgba(244, 247, 242, 0.35)');
  }

  #drawPitch(renderer: Renderer): void {
    renderer.rect(GROUND_CX - 46, RELEASE_Y - 20, 92, RELEASE_DISTANCE + 90, '#c8b087');
    // The wide lines are a rule made visible: outside them the bowler is giving away a run.
    renderer.line(
      GROUND_CX - WIDE_HALF_WIDTH,
      GROUND_CY - 40,
      GROUND_CX - WIDE_HALF_WIDTH,
      GROUND_CY + 30,
      2,
      '#f4f7f2',
    );
    renderer.line(
      GROUND_CX + WIDE_HALF_WIDTH,
      GROUND_CY - 40,
      GROUND_CX + WIDE_HALF_WIDTH,
      GROUND_CY + 30,
      2,
      '#f4f7f2',
    );

    if (this.#phase !== 'runup') return;
    // Where this delivery is being aimed, shown to both seats. The striker is entitled to
    // watch the bowler's hand exactly as they would on a field.
    const markY = GROUND_CY - RELEASE_DISTANCE * this.#delivery.length;
    const bowler = seatPalette(this.#bowler());
    renderer.strokeCircle(this.#delivery.line, markY, 13, 3, bowler.base);
    renderer.line(this.#delivery.line - 7, markY, this.#delivery.line + 7, markY, 3, bowler.base);
  }

  #drawStumps(renderer: Renderer): void {
    for (let i = -1; i <= 1; i += 1) {
      const x = GROUND_CX + i * (STUMP_HALF_WIDTH - 4);
      renderer.rect(x - 2.5, GROUND_CY - 16, 5, 32, '#f6f1e2');
    }
  }

  #drawFielders(renderer: Renderer): void {
    // Fielders are nobody's colour: they belong to the match, not to a seat. They are drawn
    // as rings so that they stay legible against the grass in greyscale (rule 7).
    for (const fielder of FIELDERS) {
      renderer.circle(fielder.x, fielder.y, 13, '#123c22');
      renderer.strokeCircle(fielder.x, fielder.y, 13, 3, '#e9eee7');
    }
    renderer.circle(KEEPER.x, KEEPER.y, 13, '#123c22');
    renderer.strokeCircle(KEEPER.x, KEEPER.y, 13, 3, '#e9eee7');
  }

  #drawBat(renderer: Renderer): void {
    const striker = seatPalette(this.#striker());
    const swung = this.#swungAt >= 0;
    // The bat is the striker's colour *and* it changes shape when it is swung, because
    // colour is never the only signal (rule 7).
    const width = swung ? 54 : 30;
    renderer.rect(this.#batX - width / 2, GROUND_CY + 24, width, 10, striker.base);
    renderer.strokeRect(this.#batX - width / 2, GROUND_CY + 24, width, 10, 2, striker.deep);
  }

  #drawBall(renderer: Renderer): void {
    if (this.#phase === 'runup' || this.#phase === 'break' || this.#phase === 'over') return;
    // Height is drawn as size, because a plan view has nowhere else to put it: a ball high
    // over the fielders looks big, and one skidding along the ground looks small.
    const radius = 6 + clamp01(this.#ballHeight / HEIGHT_MAX) * 7;
    renderer.circle(this.#ballX, this.#ballY, radius, '#f2f4ef');
    renderer.strokeCircle(this.#ballX, this.#ballY, radius, 2, '#20261f');
  }

  /**
   * The scorecard, and the word for the ball just bowled.
   *
   * Drawn outside the rotation so it reads upright to whoever is batting, and kept to the
   * ends of the logical area, which rule 9 reserves for chrome rather than for extra field.
   */
  #drawCard(renderer: Renderer): void {
    const striker = this.#striker();
    const card = this.#cards[striker];
    const colour = seatPalette(striker).base;
    const top = this.#rotated();
    const y = top ? 74 : manifest.logical.height - 74;

    renderer.text(`${card.runs}-${card.wickets}`, GROUND_CX, y, 44, colour, 'centre');
    renderer.text(
      `over ${Math.floor(card.balls / 6)}.${card.balls % 6} of ${BALLS_PER_INNINGS / 6}`,
      GROUND_CX,
      y + 34,
      20,
      '#e6efe4',
      'centre',
    );

    if (this.#phase === 'settle' && this.#lastOutcome) {
      renderer.text(LABELS[this.#lastOutcome], GROUND_CX, y - 40, 26, '#ffffff', 'centre');
    }
    if (this.#phase === 'break') {
      renderer.text('innings over — swap', GROUND_CX, y - 40, 24, '#ffffff', 'centre');
    }
  }

  // -------------------------------------------------------------------------
  // The shell's questions
  // -------------------------------------------------------------------------

  onPause(): void {}

  onResume(): void {
    // A charge held across a pause is a ball nobody meant to bowl. Dropping it matches the
    // input idiom's rule that an interrupted gesture is abandoned rather than committed.
    if (this.#phase === 'runup') this.#charge = 0;
  }

  getScore(): MatchScore {
    const p1 = this.#cards.p1;
    const p2 = this.#cards.p2;
    return {
      p1: p1.runs,
      p2: p2.runs,
      winner: this.#complete ? winnerOf(p1, p2, true) : null,
    };
  }

  destroy(): void {
    this.#context = null;
  }
}

/** What each outcome is called, in the language of the game rather than of the code. */
const LABELS: Readonly<Record<BallOutcome, string>> = Object.freeze({
  dot: 'dot ball',
  one: '1 run',
  two: '2 runs',
  three: '3 runs',
  four: 'FOUR',
  six: 'SIX',
  bowled: 'BOWLED',
  caught: 'CAUGHT',
  wide: 'wide',
});

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
