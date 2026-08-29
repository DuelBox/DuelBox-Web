import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BAND_FAR,
  BAND_NEAR,
  BLAST,
  BOARD,
  BURST_SECONDS,
  CENTRE,
  DEPTH,
  LANES,
  RAIL,
  RANGE_MIN,
  SHOT_BURST,
  SHOT_FLYING,
  SHOT_RADIUS,
  SOLDIERS,
  boardX,
  boardY,
  botHold,
  createBotState,
  createSiege,
  laneU,
  resetBotState,
  resetSiege,
  scoreOf,
  setHold,
  sideOf,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Siege } from './rules.js';

/**
 * Fatal Siege — two walls, one army, and a gun that will not stand still.
 *
 * The rules module holds the whole simulation, in each seat's own frame: a soldier is a road
 * and a distance, a shot is a rail position and a distance. What lives here is how a person
 * expresses a shot through that, and how the siege is drawn.
 *
 * **Nothing is rotated at draw time and nothing needs to be.** Every coordinate on the board
 * comes out of `boardX` and `boardY`, which are exact half-turns of each other — `boardX('p2',
 * u) === BOARD − boardX('p1', u)` and the same for `y`, in integers, not to within a rounding
 * — so the picture is already the same from either side of the device, and there is no text
 * anywhere to read the wrong way up. That is why this file never touches `pushRotation` and
 * never reads the presentation, which in turn is why a match on a shared phone and the same
 * match on two phones playing remotely are bit-identical rather than nearly so.
 *
 * **Nothing is drawn where the simulation does not have it, either.** `alpha` is ignored on
 * purpose: the two things that move fastest here are the gun on its rail and the charge
 * running out from it, and those are precisely the two things a player is timing a press
 * against. Drawing them a fraction of a step ahead of the state a press would actually read
 * would make the picture lie about the only decision in the game.
 *
 * **Rule 7 is one rule applied everywhere: seat one is round and seat two is square.** Not
 * only the soldiers and the guns but the shots, the bursts, the charge ring and the notches a
 * breach leaves in a wall. Nothing a seat owns is drawn with the other seat's primitive, so a
 * greyscale screen still says which half of the board is whose — see `#seatMark`.
 */

const COLOUR_NIGHT = '#0b0e18';
const COLOUR_FIELD = '#141a2b';
const COLOUR_WALL = '#1d2439';
const COLOUR_ROAD = 'rgba(226, 232, 255, 0.10)';
const COLOUR_BAND = 'rgba(226, 232, 255, 0.20)';
const COLOUR_REACH = 'rgba(255, 138, 106, 0.34)';
const COLOUR_MUTED = 'rgba(226, 232, 255, 0.34)';
const COLOUR_GONE = 'rgba(226, 232, 255, 0.12)';
const COLOUR_BARREL = 'rgba(226, 232, 255, 0.55)';
const COLOUR_FLAME = '#ffd27a';
const COLOUR_INK = '#080b13';

const SEATS: readonly SeatId[] = ['p1', 'p2'];

/** How big a soldier is drawn. Half a road's spacing across, so a lane never looks crowded. */
const SOLDIER_SIZE = 17;
/** The core inside a soldier: a second mark of the seat's own shape, so it reads as armour. */
const SOLDIER_CORE = 6;
const GUN_SIZE = 15;
const GUN_CORE = 5;

/** How deep the wall band is, from the board edge in to the wall line. */
const WALL_BAND = 40;
/** A breach notch, one slot per soldier of the army, along the wall. */
const NOTCH_SIZE = 10;
const NOTCH_PITCH = RAIL / SOLDIERS;

/**
 * The dashed no-man's-land mark at the minimum range, and the dashed seam down the middle.
 *
 * The run is centred on the rail, so it is its own mirror under the half-turn, and every dash
 * is placed through `boardX` from a rail position rather than from a board `x` — which is what
 * makes seat two's run the exact reflection of seat one's rather than the same run shifted.
 */
const DASHES = 15;
const DASH_LENGTH = 18;
const DASH_PITCH = RAIL / DASHES;
const DASH_ORIGIN = (RAIL - ((DASHES - 1) * DASH_PITCH + DASH_LENGTH)) / 2;

export class FatalSiegeGame implements Game {
  readonly #siege: Siege = createSiege();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  /**
   * Three streams, and the split is load-bearing in two different ways.
   *
   * **The wave must not depend on how anybody played it.** The roads the army marches up come
   * from `#worldRng`, seeded once from the match seed, so what a pair is besieged by is a
   * function of the seed and nothing else. On a stream shared with the bots it would not be: a
   * bot draws six values per shot and the number of shots it gets through depends on its tier,
   * so a different pairing would deal a different wave and a human against a bot would play in
   * one none of the balance figures were measured in.
   *
   * **And each seat has a stream of its own.** Drawing a constant number of values per shot
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
   * Which end of their own rails both guns start from.
   *
   * A real-time game has no opener and the contract lets it ignore this. It is read anyway,
   * because it moves *both* guns together — see `resetTurret` in the rules — so it changes the
   * match without changing who is favoured, and the two seats stay exact half-turn images of
   * each other throughout. That is what lets the shell's alternation across the rounds of a
   * best-of put a seed's luck on each chair in turn; a game that ignored it hands a balance
   * harness the identical match twice and cannot tell a seat effect from a seed effect.
   */
  #openingSeat: SeatId = 'p1';
  #winner: SeatId | 'draw' | null = null;

  get siege(): Siege {
    return this.#siege;
  }

  init(context: GameContext): void {
    // Three independent streams from the one seed the shell gave us, drawn in a fixed order so
    // the match still replays exactly.
    this.#worldRng = new Rng(context.rng.next() | 0);
    this.#botRng = { p1: new Rng(context.rng.next() | 0), p2: new Rng(context.rng.next() | 0) };
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#openingSeat = context.openingSeat;
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetSiege(this.#siege, this.#worldRng, this.#openingSeat);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;
    this.#take('p1', input, fixedDeltaSeconds);
    this.#take('p2', input, fixedDeltaSeconds);
    step(this.#siege, fixedDeltaSeconds);
    this.#winner = winnerOf(this.#siege);
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
   * both land inside one frame — most taps, on a touchscreen — reports as pressed and released
   * with `actionHeld` never true. Without it that tap would be swallowed entirely and the
   * player would see nothing happen; with it, it is a press and a release one step apart,
   * which is a shot dropped at the foot of your own wall. Doing nothing is the worse answer:
   * "the game ignored me" is not a rule anybody can learn.
   */
  #take(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const state = seat === 'p1' ? this.#botP1State : this.#botP2State;
      setHold(
        this.#siege,
        seat,
        botHold(this.#siege, seat, difficulty, state, this.#botRng[seat], fixedDeltaSeconds),
      );
      return;
    }
    const seatInput = input.seat(seat);
    setHold(this.#siege, seat, seatInput.actionHeld || seatInput.actionPressed);
  }

  getScore(): MatchScore {
    return {
      p1: scoreOf(this.#siege, 'p1'),
      p2: scoreOf(this.#siege, 'p2'),
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetSiege(this.#siege, this.#worldRng, this.#openingSeat);
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
    this.#drawField(renderer);
    for (const seat of SEATS) this.#drawWall(renderer, seat);
    for (const seat of SEATS) this.#drawSight(renderer, seat);
    for (const seat of SEATS) this.#drawSoldiers(renderer, seat);
    for (const seat of SEATS) this.#drawShots(renderer, seat);
    for (const seat of SEATS) this.#drawGun(renderer, seat);
  }

  /**
   * The ground both armies walk over: the roads, the two scoring bands, and the line inside
   * which nothing can be reached.
   *
   * Every mark here is neutral, and deliberately so. Rule 7 evidence comes from the seat
   * shapes; the field is not owned by anybody and painting it in a seat colour would be the
   * one way to pass rule 7 by recolouring the background.
   */
  #drawField(renderer: Renderer): void {
    renderer.rect(0, 0, BOARD, BOARD, COLOUR_FIELD);
    for (const seat of SEATS) {
      const wallY = boardY(seat, 0);
      const farY = boardY(seat, DEPTH);
      for (let lane = 0; lane < LANES; lane += 1) {
        const x = boardX(seat, laneU(lane));
        renderer.line(x, wallY, x, farY, 2, COLOUR_ROAD);
      }
      // The two band edges, drawn as the lines they are: cross the far one and a soldier is
      // worth three, the near one and it is worth two, neither and it is worth one. A player
      // reads the value of a shot off the field rather than off a table.
      const left = boardX(seat, 0);
      const right = boardX(seat, RAIL);
      for (const band of [BAND_NEAR, BAND_FAR]) {
        const y = boardY(seat, band);
        renderer.line(left, y, right, y, 2, COLOUR_BAND);
      }
      // The minimum range, dashed: inside it a soldier cannot be reached at all and is walking
      // through the gate for nothing. It is the single most important line on the board and the
      // only one drawn broken, so it does not read as another band.
      const reachY = boardY(seat, RANGE_MIN);
      for (let i = 0; i < DASHES; i += 1) {
        const u = DASH_ORIGIN + i * DASH_PITCH;
        renderer.line(
          boardX(seat, u),
          reachY,
          boardX(seat, u + DASH_LENGTH),
          reachY,
          3,
          COLOUR_REACH,
        );
      }
    }
    // Where the two fields meet. Nothing crosses it — the seats never share a soldier — so it
    // is drawn as a seam rather than as a frontier, and centred so it is its own mirror.
    for (let i = 0; i < DASHES; i += 1) {
      const u = DASH_ORIGIN + i * DASH_PITCH;
      renderer.line(boardX('p1', u), CENTRE, boardX('p1', u + DASH_LENGTH), CENTRE, 1, COLOUR_GONE);
    }
  }

  /**
   * A seat's wall, and the notches the army has already put in it.
   *
   * One slot per soldier of the whole army, filled in as they walk through the gate. That is
   * the tie-break made visible — level on ground held, the seat that let fewer through takes it
   * — and it is also the only running count in the game that is not the score, so a player who
   * is level can see which way it will go without being told a number.
   */
  #drawWall(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const wallY = boardY(seat, 0);
    const outward = seat === 'p1' ? 1 : -1;
    renderer.rect(0, seat === 'p1' ? wallY : 0, BOARD, WALL_BAND, COLOUR_WALL);
    renderer.line(0, wallY, BOARD, wallY, 3, COLOUR_MUTED);

    const through = sideOf(this.#siege, seat).through;
    const y = wallY + outward * (WALL_BAND / 2);
    for (let i = 0; i < SOLDIERS; i += 1) {
      const x = boardX(seat, (i + 0.5) * NOTCH_PITCH);
      if (i < through) this.#seatMark(renderer, seat, x, y, NOTCH_SIZE, palette.base);
      else this.#seatOutline(renderer, seat, x, y, NOTCH_SIZE, 2, COLOUR_GONE);
    }
  }

  /**
   * The sight: the road the gun has kept, and the ring the shot will clear.
   *
   * Drawn as the shot itself rather than as a gauge. The stem is the column and the ring at the
   * end of it is the landing point, drawn **at the real blast radius**, so what the release is
   * choosing is literally the circle that will be cleared. A player runs the ring out until it
   * sits on a soldier and lets go; there is no number anywhere to translate.
   *
   * A loaded gun that has not been pressed shows the same ring faint, at the bottom of the
   * charge — which is where a tap lands, ninety units out, on top of your own gate. That is
   * a rule worth being able to see before paying for it.
   */
  #drawSight(renderer: Renderer, seat: SeatId): void {
    const turret = sideOf(this.#siege, seat).turret;
    if (!turret.loaded) return;
    const palette = SEAT_PALETTE[seat];
    const x = boardX(seat, turret.u);
    const fromY = boardY(seat, 0);
    const y = boardY(seat, turret.range);
    renderer.line(x, fromY, x, y, 2, turret.aiming ? COLOUR_MUTED : COLOUR_GONE);
    this.#seatOutline(renderer, seat, x, y, BLAST, 3, turret.aiming ? palette.base : COLOUR_GONE);
  }

  /** One seat's field. Seat one's soldiers are round, seat two's square, core and all. */
  #drawSoldiers(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const soldiers = sideOf(this.#siege, seat).soldiers;
    for (let i = 0; i < soldiers.length; i += 1) {
      const soldier = soldiers[i];
      if (soldier === undefined || !soldier.alive) continue;
      const x = boardX(seat, laneU(soldier.lane));
      const y = boardY(seat, soldier.d);
      this.#seatMark(renderer, seat, x, y, SOLDIER_SIZE, palette.base);
      this.#seatOutline(renderer, seat, x, y, SOLDIER_SIZE, 3, palette.deep);
      // A second mark of the same shape inside the first. It carries no information — it is
      // there so that a soldier is legibly a *soldier* rather than a disc, and so that the
      // shape that tells the seats apart survives being drawn small.
      this.#seatMark(renderer, seat, x, y, SOLDIER_CORE, COLOUR_INK);
    }
  }

  /** Shots in the air, and the bursts they leave. */
  #drawShots(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const shots = sideOf(this.#siege, seat).shots;
    const wallY = boardY(seat, 0);
    for (let i = 0; i < shots.length; i += 1) {
      const shot = shots[i];
      if (shot === undefined) continue;
      const x = boardX(seat, shot.u);
      if (shot.state === SHOT_FLYING) {
        const travelled = shot.flightTime > 0 ? shot.flight / shot.flightTime : 1;
        const reached = travelled < 1 ? travelled : 1;
        const y = boardY(seat, shot.range * reached);
        renderer.line(x, wallY, x, y, 1, COLOUR_GONE);
        this.#seatMark(renderer, seat, x, y, SHOT_RADIUS, COLOUR_FLAME);
        this.#seatMark(renderer, seat, x, y, SHOT_RADIUS - 3, palette.deep);
        continue;
      }
      if (shot.state !== SHOT_BURST) continue;
      // The burst opens out to exactly the radius the rules use, so the blast is something a
      // player watches rather than something they are told about afterwards.
      const opened = 1 - (shot.burst > 0 ? shot.burst : 0) / BURST_SECONDS;
      const y = boardY(seat, shot.range);
      this.#seatOutline(renderer, seat, x, y, BLAST * (0.3 + 0.7 * opened), 4, COLOUR_FLAME);
      this.#seatOutline(renderer, seat, x, y, BLAST, 2, palette.soft);
    }
  }

  /**
   * The gun on its rail.
   *
   * The barrel is drawn pointing into the field only while a shot is loaded, so a gun that is
   * reloading looks different from one that is ready — the reload is the scarce thing in this
   * game and it is worth being able to see.
   */
  #drawGun(renderer: Renderer, seat: SeatId): void {
    const turret = sideOf(this.#siege, seat).turret;
    const palette = SEAT_PALETTE[seat];
    const x = boardX(seat, turret.u);
    const y = boardY(seat, 0);
    const inward = seat === 'p1' ? -1 : 1;
    // Drawn in the neutral metal rather than in the seat's colour, and that is rule 7 rather
    // than taste: a line is the one primitive both seats would otherwise share, and a shared
    // primitive in a seat's own palette is exactly what `greyscale.test.ts` counts against a
    // game. Everything either seat owns is a circle or a rectangle and never both.
    if (turret.loaded) renderer.line(x, y, x, y + inward * 18, 7, COLOUR_BARREL);
    this.#seatMark(renderer, seat, x, y, GUN_SIZE, palette.base);
    this.#seatMark(renderer, seat, x, y, GUN_CORE, COLOUR_INK);
  }

  /**
   * Seat one is round and seat two square, everywhere on the board. Rule 7, in one place.
   *
   * Everything either seat owns goes through here or through {@link FatalSiegeGame.seatOutline}
   * — soldiers, guns, shots, bursts, the charge ring and the wall notches — so no primitive is
   * ever shared between the two seats and no argument about which colour is which is doing any
   * work. `game.test.ts` asserts that a whole match draws no rectangle in seat one's palette
   * and no circle in seat two's.
   */
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
