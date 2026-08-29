import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BLAST,
  BURST_SECONDS,
  CARRIAGE_MAX_X,
  CARRIAGE_MIN_X,
  CENTRE,
  FUSE,
  GROUND,
  LANTERNS,
  LANTERN_RADIUS,
  ROCKET_BURSTING,
  ROCKET_FLYING,
  ROCKET_RADIUS,
  baseYOf,
  botHold,
  createBotState,
  createGround,
  firingSign,
  flightProgress,
  landingYOf,
  lanternsOf,
  launcherOf,
  resetBotState,
  resetGround,
  scoreOf,
  setHold,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Ground } from './rules.js';

/**
 * Explosive Festival — two carts, one ground, and a fuse that will not wait.
 *
 * The rules module holds the whole simulation in ground units. What lives here is how a
 * person expresses a shot through it, and how the festival is drawn.
 *
 * **Nothing is rotated at draw time and nothing needs to be.** The ground is point-symmetric
 * — the rails, the lantern deal, the carts' starting ends and both distance gauges are one
 * shape half-turned — so the picture is already the same from either side of the device, and
 * there is no text anywhere to read the wrong way up. That is why this file never touches
 * `pushRotation` and never reads the presentation, which in turn is why a match on a shared
 * phone and the same match on two phones playing remotely are bit-identical rather than
 * nearly so.
 *
 * **Nothing is drawn where the simulation does not have it, either.** `alpha` is ignored on
 * purpose: the two things that move fastest here are the cart and the sight, and those are
 * precisely the two things a player is timing a press against. Drawing them a fraction of a
 * step ahead of the state a press would actually read would make the picture lie about the
 * only decision in the game.
 */

const COLOUR_NIGHT = '#0c0f1a';
const COLOUR_GROUND = '#151a2c';
const COLOUR_LINE = 'rgba(224, 231, 255, 0.14)';
const COLOUR_MUTED = 'rgba(224, 231, 255, 0.38)';
const COLOUR_GONE = 'rgba(224, 231, 255, 0.12)';
const COLOUR_FLAME = '#ffd98a';
const COLOUR_INK = '#0a0c14';

/** How far a rocket at the top of its arc is drawn from the ground it is crossing. */
const LIFT = 34;
/** Length of the fuse mark behind a cart when the fuse is full. */
const FUSE_MARK = 26;

const SEATS: readonly SeatId[] = ['p1', 'p2'];

/** The dashed centre line, sized so the run is centred and its own mirror. */
const DASHES = 19;
const DASH_LENGTH = 22;
const DASH_PITCH = 40;
const DASH_ORIGIN = (GROUND - (DASHES * DASH_PITCH - (DASH_PITCH - DASH_LENGTH))) / 2;

/** Where a seat's tally sits: a column of pips on its own side edge, mirrored between seats. */
const TALLY_X = 34;
const TALLY_STEP = 34;
const TALLY_RADIUS = 11;

export class ExplosiveFestivalGame implements Game {
  readonly #ground: Ground = createGround();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  /**
   * Three streams, and the split is load-bearing in two different ways.
   *
   * **The deal must not depend on how anybody played it.** The lantern deal comes from
   * `#worldRng`, seeded once from the match seed, so what a pair is dealt is a function of the
   * seed and nothing else. On a stream shared with the bots it would not be: a bot draws six
   * values per rocket and the number of rockets it gets through depends on its tier, so a
   * different pairing would deal a different festival and a human against a bot would play in
   * one none of the balance figures were measured in.
   *
   * **And each seat has a stream of its own.** Drawing a constant number of values per rocket
   * fixes the *count* and not the *order*: whichever seat is polled first still takes the
   * earlier value from a shared stream every time. With a stream each, the poll order is not
   * observable at all, and `rules.test.ts` asserts exactly that by running the two calls in
   * both orders and comparing bit for bit.
   */
  #worldRng = new Rng(1);
  #botRng: Record<SeatId, Rng> = { p1: new Rng(2), p2: new Rng(3) };
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  /**
   * Which seat's cart starts at the low end of its rail.
   *
   * A real-time game has no opener and the contract lets it ignore this. It is read anyway,
   * because the two cart arrangements are exact mirrors — see `resetLauncher` — so hanging the
   * opener on it changes the match without changing who is favoured, and that is what lets the
   * shell's alternation across the rounds of a best-of put a seed's luck on each chair in turn.
   */
  #openingSeat: SeatId = 'p1';
  #winner: SeatId | 'draw' | null = null;

  get ground(): Ground {
    return this.#ground;
  }

  init(context: GameContext): void {
    // Three independent streams from the one seed the shell gave us, drawn in a fixed order
    // so the match still replays exactly.
    this.#worldRng = new Rng(context.rng.next() | 0);
    this.#botRng = { p1: new Rng(context.rng.next() | 0), p2: new Rng(context.rng.next() | 0) };
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#openingSeat = context.openingSeat;
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGround(this.#ground, this.#worldRng, this.#openingSeat);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;
    this.#take('p1', input, fixedDeltaSeconds);
    this.#take('p2', input, fixedDeltaSeconds);
    step(this.#ground, fixedDeltaSeconds);
    this.#winner = winnerOf(this.#ground);
  }

  /**
   * One seat's control for this step, from a bot or from a person, through the same door.
   *
   * A person's is a single boolean and there is nothing else to read: no position, no
   * direction, no drag. That is deliberate and it is the answer to the defect this archetype
   * keeps shipping — the shell divides the pointer surface into two zones, so an absolute
   * pointer hands one seat a part of the arena the other cannot reach. A press has no
   * coordinates for a zone to withhold.
   *
   * `actionPressed` is folded in beside `actionHeld` because a tap whose press and release
   * both land inside one frame — most taps, on a touchscreen — reports as pressed and
   * released with `actionHeld` never true. Without it that tap would be swallowed entirely
   * and the player would see nothing happen; with it, it is a press and a release one step
   * apart, which is a rocket dropped at your own feet. Doing nothing is the worse answer:
   * "the game ignored me" is not a rule anybody can learn.
   */
  #take(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const state = seat === 'p1' ? this.#botP1State : this.#botP2State;
      setHold(
        this.#ground,
        seat,
        botHold(this.#ground, seat, difficulty, state, this.#botRng[seat], fixedDeltaSeconds),
      );
      return;
    }
    const seatInput = input.seat(seat);
    setHold(this.#ground, seat, seatInput.actionHeld || seatInput.actionPressed);
  }

  getScore(): MatchScore {
    return {
      p1: scoreOf(this.#ground, 'p1'),
      p2: scoreOf(this.#ground, 'p2'),
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGround(this.#ground, this.#worldRng, this.#openingSeat);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks against
  // the class as well as against `Game`. Declaring only the one-argument form is what made
  // render-purity tests unable to render at two different alphas (issue #2464).
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_NIGHT);
    this.#drawGround(renderer);
    for (const seat of SEATS) this.#drawLanterns(renderer, seat);
    for (const seat of SEATS) this.#drawSight(renderer, seat);
    for (const seat of SEATS) this.#drawCart(renderer, seat);
    this.#drawRockets(renderer);
    for (const seat of SEATS) this.#drawTally(renderer, seat);
  }

  /** The ground, and the one mark that says where the frontier is. */
  #drawGround(renderer: Renderer): void {
    renderer.rect(0, 0, GROUND, GROUND, COLOUR_GROUND);
    // The centre line, drawn as a run of short marks rather than a wall: a rocket crosses it
    // freely, and what changes at it is only whose lanterns are on the far side. The run is
    // centred so it is its own mirror under the half-turn, like everything else on the ground.
    for (let i = 0; i < DASHES; i += 1) {
      const x = DASH_ORIGIN + i * DASH_PITCH;
      renderer.line(x, CENTRE, x + DASH_LENGTH, CENTRE, 2, COLOUR_LINE);
    }
    for (const seat of SEATS) {
      const y = baseYOf(seat);
      renderer.line(CARRIAGE_MIN_X, y, CARRIAGE_MAX_X, y, 2, COLOUR_LINE);
    }
  }

  /**
   * One seat's lanterns, standing and put out alike.
   *
   * Rule 7: seat one's are round and seat two's are square, and a lantern that has been put
   * out leaves the same shape behind as a faint outline — so which half of the ground is
   * whose survives both the half-turn and a greyscale screen, and a player can still see the
   * shape of the row they have already broken.
   */
  #drawLanterns(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const lanterns = lanternsOf(this.#ground, seat);
    for (let i = 0; i < lanterns.length; i += 1) {
      const lantern = lanterns[i];
      if (lantern === undefined) continue;
      if (!lantern.standing) {
        this.#seatOutline(renderer, seat, lantern.x, lantern.y, LANTERN_RADIUS - 6, 2, COLOUR_GONE);
        continue;
      }
      this.#seatMark(renderer, seat, lantern.x, lantern.y, LANTERN_RADIUS, palette.base);
      this.#seatOutline(renderer, seat, lantern.x, lantern.y, LANTERN_RADIUS, 3, palette.deep);
      // The flame inside is what a burst puts out, drawn small so a lit lantern and a dead
      // one differ in what is in them as well as in how bright they are.
      renderer.circle(lantern.x, lantern.y, 5, COLOUR_FLAME);
    }
  }

  /**
   * The sight: the column the cart has kept, and the point the rocket will come down on.
   *
   * Drawn as the shot itself rather than as a gauge. The line is the column and the ring
   * running along it is the landing point, drawn **at the real blast radius**, so what a
   * player is choosing is the circle that will be cleared rather than a number to translate.
   * That is also what makes the risk visible: run the ring back far enough and it is sitting
   * on your own front row.
   */
  #drawSight(renderer: Renderer, seat: SeatId): void {
    const launcher = launcherOf(this.#ground, seat);
    if (!launcher.loaded) return;
    const palette = SEAT_PALETTE[seat];
    const fromY = baseYOf(seat);
    const y = landingYOf(seat, launcher.range);
    renderer.line(
      launcher.x,
      fromY,
      launcher.x,
      y,
      2,
      launcher.aiming ? palette.soft : COLOUR_GONE,
    );
    renderer.strokeCircle(launcher.x, y, BLAST, 3, launcher.aiming ? palette.base : COLOUR_MUTED);
    this.#seatMark(renderer, seat, launcher.x, y, 4, palette.base);
  }

  /**
   * A cart on its rail, and the fuse burning behind it.
   *
   * The fuse is a mark whose **length** is what is left of it, drawn behind the cart on that
   * seat's own side, so the one thing in this game that cannot be waited out is legible
   * without colour and without a number.
   */
  #drawCart(renderer: Renderer, seat: SeatId): void {
    const launcher = launcherOf(this.#ground, seat);
    const palette = SEAT_PALETTE[seat];
    const y = baseYOf(seat);
    const behind = -firingSign(seat);

    if (launcher.loaded) {
      const left = Math.max(0, launcher.fuse / FUSE);
      renderer.line(
        launcher.x,
        y + behind * 10,
        launcher.x,
        y + behind * (10 + FUSE_MARK * left),
        5,
        COLOUR_FLAME,
      );
      // The tube, pointing into the ground: a loaded cart looks different from a reloading one.
      renderer.line(launcher.x, y, launcher.x, y - behind * 16, 7, palette.deep);
    }
    this.#seatMark(renderer, seat, launcher.x, y, 15, palette.base);
    renderer.circle(launcher.x, y, 5, COLOUR_INK);
  }

  /** Rockets in the air, and the bursts they leave. Seat one is round, seat two square. */
  #drawRockets(renderer: Renderer): void {
    const rockets = this.#ground.rockets;
    for (let i = 0; i < rockets.length; i += 1) {
      const rocket = rockets[i];
      if (rocket === undefined) continue;
      const seat: SeatId = rocket.owner === 0 ? 'p1' : 'p2';
      const palette = SEAT_PALETTE[seat];
      if (rocket.state === ROCKET_FLYING) {
        const travelled = flightProgress(rocket);
        const y = rocket.fromY + (rocket.toY - rocket.fromY) * travelled;
        const lift = 4 * travelled * (1 - travelled);
        // Drawn back toward whoever fired it as it rises: from where they sit, a rocket in
        // the air is nearer than the ground under it, which is the whole of the height cue.
        renderer.circle(rocket.x, y, ROCKET_RADIUS * 0.55, COLOUR_LINE);
        const lifted = y - firingSign(seat) * lift * LIFT;
        this.#seatMark(renderer, seat, rocket.x, lifted, ROCKET_RADIUS, COLOUR_FLAME);
        this.#seatMark(renderer, seat, rocket.x, lifted, ROCKET_RADIUS - 4, palette.deep);
        continue;
      }
      if (rocket.state !== ROCKET_BURSTING) continue;
      // The burst opens out to exactly the radius the rules use, so the blast is something a
      // player watches rather than something they are told about afterwards.
      const opened = 1 - Math.max(0, rocket.burst) / BURST_SECONDS;
      renderer.strokeCircle(rocket.x, rocket.toY, BLAST * (0.3 + 0.7 * opened), 4, COLOUR_FLAME);
      this.#seatOutline(renderer, seat, rocket.x, rocket.toY, BLAST, 2, palette.soft);
    }
  }

  /**
   * A seat's tally, on its own side edge and mirrored between the two.
   *
   * Three states and none of them needs a number: **solid** for a lantern taken by a burst
   * that came down on the paper, **hollow** for one taken off a burst that was merely near
   * enough, and **faint** for one still standing. That is the tiebreak made visible — a player
   * level on lanterns can see which way it will go — and it is the same object the shell's
   * scoreboard is counting, so nothing has to be reconciled.
   */
  #drawTally(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const taken = scoreOf(this.#ground, seat);
    const clean = Math.min(taken, launcherOf(this.#ground, seat).clean);
    const x = seat === 'p1' ? TALLY_X : GROUND - TALLY_X;
    const edgeY = baseYOf(seat);
    const inward = firingSign(seat);
    for (let i = 0; i < LANTERNS; i += 1) {
      const y = edgeY + inward * i * TALLY_STEP;
      if (i < clean) this.#seatMark(renderer, seat, x, y, TALLY_RADIUS, palette.base);
      else if (i < taken) this.#seatOutline(renderer, seat, x, y, TALLY_RADIUS, 3, palette.base);
      else this.#seatOutline(renderer, seat, x, y, TALLY_RADIUS, 3, COLOUR_GONE);
    }
  }

  /** Seat one is round and seat two square, everywhere on the ground. Rule 7, in one place. */
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
    width: number,
    colour: string,
  ): void {
    if (seat === 'p1') renderer.strokeCircle(x, y, size, width, colour);
    else renderer.strokeRect(x - size, y - size, size * 2, size * 2, width, colour);
  }
}
