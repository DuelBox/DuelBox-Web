import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BIRD_RADIUS,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  FLIGHTS_TO_WIN,
  GAP_MIN,
  GAP_START,
  HORIZON,
  MAX_FLIGHTS,
  SKY_HEIGHT,
  TOOTH_LENGTH,
  WALL_THICKNESS,
  botIntent,
  createBotState,
  createMatch,
  gapFor,
  nextWall,
  resetBotState,
  resetMatch,
  step,
  winnerOf,
  worldXOf,
  worldYOf,
} from './rules.js';
import type { BotDifficulty, BotState, Bird, Intent, Match } from './rules.js';

/**
 * Happy Birds — a sky each, one run of spiked walls, and one button.
 *
 * The rules module holds the whole simulation, in sky-local units. What lives here is how
 * a person's tap becomes an {@link Intent}, and how one set of sky-local numbers is drawn
 * twice, a half turn apart.
 */

const COLOUR_DUSK = '#0b1020';
/**
 * Two shades of sky, so which half is yours survives greyscale.
 *
 * Far enough apart to read as two different surfaces at a glance and in a monochrome
 * screenshot, which the first pair — about two per cent of luminance apart — did not.
 */
const COLOUR_SKY_NEAR = '#22355f';
const COLOUR_SKY_FAR = '#101d38';
const COLOUR_HORIZON = '#070b16';
const COLOUR_HORIZON_EDGE = 'rgba(226, 236, 255, 0.24)';
const COLOUR_GROUND = '#2f7a4a';
const COLOUR_GROUND_DARK = '#1d5030';
const COLOUR_TOOTH = '#d8dee9';
const COLOUR_BANK = '#454f63';
const COLOUR_BANK_TIGHT = '#7a4650';
const COLOUR_INK = '#050914';
const COLOUR_CHALK = 'rgba(226, 236, 255, 0.5)';
const COLOUR_SPENT = 'rgba(226, 236, 255, 0.16)';
const COLOUR_LIVE = '#f2c94c';

/** How deep the grass strip is drawn along each seat's own edge. */
const GROUND_DEPTH = 24;

/** Sky-x of the flight pips and of the next-gap marker, behind the bird. */
const PIP_LEAD = -112;
const MARKER_LEAD = -84;

/** Teeth across the width of one bank. Three fits 26 units without reading as a comb. */
const TEETH = 3;

/** Both seats, as a constant rather than an array allocated per frame. */
const SEATS: readonly SeatId[] = ['p1', 'p2'];

export class HappyBirdsGame implements Game {
  readonly #match: Match = createMatch();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  /**
   * Whether each seat's "up" key was already down last step.
   *
   * A wing-beat is an **edge**, not a level. The engine hands the action key over as a
   * clean press/hold/release already, but the movement axis is a level — so W and Up,
   * which are the keys anybody reaches for first in a game about flying, would otherwise
   * beat a wing on every one of the sixty steps they were held. Kept here rather than in
   * the rules because it is a fact about a keyboard, not about the game.
   */
  #p1Up = false;
  #p2Up = false;

  get match(): Match {
    return this.#match;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    this.#p1Up = false;
    this.#p2Up = false;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetMatch(this.#match);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    const p1 = this.#intentFor('p1', input, fixedDeltaSeconds);
    const p2 = this.#intentFor('p2', input, fixedDeltaSeconds);
    step(this.#match, p1, p2, fixedDeltaSeconds, this.#rng);

    this.#winner = winnerOf(this.#match);
  }

  #intentFor(seat: SeatId, input: InputState, fixedDeltaSeconds: number): Intent {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      return botIntent(
        this.#match,
        seat,
        difficulty,
        seat === 'p1' ? this.#botP1State : this.#botP2State,
        fixedDeltaSeconds,
        this.#rng,
      );
    }
    return this.#humanIntent(seat, input);
  }

  /**
   * One button, two things it can say.
   *
   * A fresh press beats a wing; the same button still held folds the wings into a dive.
   * That is the whole scheme, and it is the same scheme through a thumb and through a key
   * — the engine has already folded a pointer down in this seat's zone and this seat's
   * action key into one action, so nothing here needs to know which arrived.
   *
   * The up key is folded in as a *third* way to beat, on its own rising edge, because W
   * and Up are what a player tries first. It is only ever a beat: holding it does not
   * dive, which would be a strange thing for a key called "up" to do.
   *
   * Neither family has a rate advantage to find, because the beat itself is capped by the
   * wing's recharge inside {@link step} — a key held down, a key mashed and a thumb
   * tapping all reach the same ceiling.
   */
  #humanIntent(seat: SeatId, input: InputState): Intent {
    const seatInput = input.seat(seat);
    const up = seatInput.move.y < 0;
    const wasUp = seat === 'p1' ? this.#p1Up : this.#p2Up;
    if (seat === 'p1') this.#p1Up = up;
    else this.#p2Up = up;

    if (seatInput.actionPressed || (up && !wasUp)) return 'flap';
    if (seatInput.actionHeld) return 'tuck';
    return 'idle';
  }

  getActiveSeat(): SeatId | null {
    // Never: both skies are live at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    return {
      p1: this.#match.p1.flights,
      p2: this.#match.p2.flights,
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetMatch(this.#match);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
    this.#p1Up = false;
    this.#p2Up = false;
  }

  /**
   * Draw the match as it stands.
   *
   * The interpolation alpha the contract offers is deliberately not read: nothing here is
   * drawn between two simulation states, so a frame is the state as it is.
   */
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_DUSK);
    this.#drawHorizon(renderer);
    for (const seat of SEATS) {
      this.#drawSky(renderer, seat);
      this.#drawWalls(renderer, seat);
      this.#drawPips(renderer, seat);
      this.#drawBird(renderer, seat);
    }
  }

  /**
   * Fill a band of one sky, given in sky-local heights.
   *
   * Every rectangle in this file goes through here, so the half turn that separates the
   * two seats is written once. p1's sky counts upward from the bottom edge of the field
   * and p2's downward from the top, and taking the smaller of the two mapped edges makes
   * that difference disappear at the call site.
   */
  #band(
    renderer: Renderer,
    seat: SeatId,
    lead: number,
    width: number,
    low: number,
    high: number,
    colour: string,
  ): void {
    const centreX = worldXOf(seat, lead);
    const a = worldYOf(seat, low);
    const b = worldYOf(seat, high);
    const top = a < b ? a : b;
    renderer.rect(centreX - width / 2, top, width, Math.abs(b - a), colour);
  }

  #drawSky(renderer: Renderer, seat: SeatId): void {
    const shade = seat === 'p1' ? COLOUR_SKY_NEAR : COLOUR_SKY_FAR;
    const top = seat === 'p1' ? FIELD_HEIGHT - SKY_HEIGHT : 0;
    renderer.rect(0, top, FIELD_WIDTH, SKY_HEIGHT, shade);

    // The grass, along this seat's own edge of the device.
    const groundTop = seat === 'p1' ? FIELD_HEIGHT - GROUND_DEPTH : 0;
    renderer.rect(0, groundTop, FIELD_WIDTH, GROUND_DEPTH, COLOUR_GROUND);
    // Rule 7: the two grass strips carry different tufts — p1's upright, p2's raked — so
    // the halves are told apart by pattern as well as by which green they are.
    for (let x = 0; x < FIELD_WIDTH; x += 30) {
      const skew = seat === 'p1' ? 0 : 12;
      renderer.line(x, groundTop, x + skew, groundTop + GROUND_DEPTH, 2, COLOUR_GROUND_DARK);
    }

    // A tick on the near edge at the height of the gap coming next: the same information
    // the wall itself carries, brought back to where the bird already is, so a phone-sized
    // sky is still readable at speed.
    const wall = nextWall(this.#match);
    if (wall !== null) {
      this.#band(renderer, seat, MARKER_LEAD, 24, wall.centre - 2, wall.centre + 2, COLOUR_CHALK);
    }
  }

  /**
   * The horizon band, and the flight budget written across it.
   *
   * The budget is the one thing in the match that genuinely belongs to both players — the
   * walls are dealt once and flown by both — so it is drawn in the one strip that belongs
   * to neither. A spent tick is dim, a remaining one bright, and running out of them is
   * what ends a match nobody has won three flights of.
   *
   * Spent from **both ends inward**, so the bar is symmetric under the half turn that
   * separates the seats. Filling from one end would have one player watching it empty
   * toward them and the other watching it empty away.
   */
  #drawHorizon(renderer: Renderer): void {
    const top = SKY_HEIGHT;
    renderer.rect(0, top, FIELD_WIDTH, HORIZON, COLOUR_HORIZON);
    renderer.line(0, top, FIELD_WIDTH, top, 2, COLOUR_HORIZON_EDGE);
    renderer.line(0, top + HORIZON, FIELD_WIDTH, top + HORIZON, 2, COLOUR_HORIZON_EDGE);

    const spacing = (FIELD_WIDTH - 40) / MAX_FLIGHTS;
    const spent = this.#match.flightsPlayed;
    for (let i = 0; i < MAX_FLIGHTS; i += 1) {
      const used = i * 2 < spent || (MAX_FLIGHTS - 1 - i) * 2 < spent;
      renderer.rect(
        20 + i * spacing,
        top + HORIZON / 2 - 6,
        spacing - 5,
        12,
        used ? COLOUR_SPENT : COLOUR_LIVE,
      );
    }
  }

  /**
   * One seat's view of the walls.
   *
   * There is one run of walls and both seats are drawn from it, at the one gap width the
   * flight is currently on — so the two halves of the device carry the same obstacle in
   * the same place at the same instant, and a player can check that for themselves.
   */
  #drawWalls(renderer: Renderer, seat: SeatId): void {
    const gap = gapFor(this.#match.cleared);
    const half = gap / 2;
    // The banks redden as the gap closes, so how far into a flight you are is visible
    // without counting walls — and it is a second signal for the width itself.
    const tight = gap <= (GAP_START + GAP_MIN) / 2;
    const bankColour = tight ? COLOUR_BANK_TIGHT : COLOUR_BANK;

    for (let i = 0; i < this.#match.walls.length; i += 1) {
      const wall = this.#match.walls[i]!;
      if (!wall.live) continue;
      const x = worldXOf(seat, wall.lead);
      if (x < -WALL_THICKNESS || x > FIELD_WIDTH + WALL_THICKNESS) continue;

      const low = wall.centre - half;
      const high = wall.centre + half;
      this.#drawBank(renderer, seat, wall.lead, 0, low, 1, bankColour);
      this.#drawBank(renderer, seat, wall.lead, SKY_HEIGHT, high, -1, bankColour);
    }
  }

  /**
   * One bank of one wall: a body from the surface, and a row of teeth pointing at the gap.
   *
   * `direction` is +1 for the bank standing on the ground and -1 for the one hanging from
   * the ceiling, so the two are the same code read in opposite directions. The tips reach
   * exactly the height the rules call the boundary — a bank drawn short of its own edge
   * would be a game that looks more generous than it is.
   */
  #drawBank(
    renderer: Renderer,
    seat: SeatId,
    lead: number,
    surface: number,
    edge: number,
    direction: number,
    colour: string,
  ): void {
    const base = edge - direction * TOOTH_LENGTH;
    const bodyLow = direction > 0 ? surface : base;
    const bodyHigh = direction > 0 ? base : surface;
    if (bodyHigh > bodyLow) {
      this.#band(renderer, seat, lead, WALL_THICKNESS, bodyLow, bodyHigh, colour);
      // Rule 7 again: p2's banks are barred across and p1's are plain, so the two skies
      // are distinguishable in a greyscale screenshot with the birds out of frame.
      if (seat === 'p2') {
        for (let i = 1; i <= 3; i += 1) {
          const at = bodyLow + ((bodyHigh - bodyLow) * i) / 4;
          this.#band(renderer, seat, lead, WALL_THICKNESS + 6, at - 1.5, at + 1.5, COLOUR_INK);
        }
      }
    }

    const x = worldXOf(seat, lead);
    const width = WALL_THICKNESS / TEETH;
    const baseY = worldYOf(seat, base);
    const tipY = worldYOf(seat, edge);
    for (let i = 0; i < TEETH; i += 1) {
      const left = x - WALL_THICKNESS / 2 + i * width;
      renderer.line(left, baseY, left + width / 2, tipY, 3, COLOUR_TOOTH);
      renderer.line(left + width / 2, tipY, left + width, baseY, 3, COLOUR_TOOTH);
    }
  }

  /**
   * Flights won, as pips up each seat's own outer edge, filling toward that player.
   *
   * The shell's HUD prints both numbers; what it cannot show mid-flight is how close the
   * match is without reading two of them. Rule 7: p1's pips are round and p2's square, so
   * the two columns are told apart by shape and not only by which colour they are.
   */
  #drawPips(renderer: Renderer, seat: SeatId): void {
    const bird = seat === 'p1' ? this.#match.p1 : this.#match.p2;
    const palette = SEAT_PALETTE[seat];
    const spacing = 46;
    const first = SKY_HEIGHT / 2 - ((FLIGHTS_TO_WIN - 1) * spacing) / 2;
    for (let i = 0; i < FLIGHTS_TO_WIN; i += 1) {
      const height = first + i * spacing;
      const filled = i < bird.flights;
      const colour = filled ? palette.base : COLOUR_SPENT;
      if (seat === 'p1') {
        renderer.circle(worldXOf(seat, PIP_LEAD), worldYOf(seat, height), 11, colour);
      } else {
        this.#band(renderer, seat, PIP_LEAD, 22, height - 11, height + 11, colour);
      }
    }
  }

  #drawBird(renderer: Renderer, seat: SeatId): void {
    const bird: Readonly<Bird> = seat === 'p1' ? this.#match.p1 : this.#match.p2;
    const palette = SEAT_PALETTE[seat];
    const x = worldXOf(seat, 0);
    const y = worldYOf(seat, bird.height);

    // A short streak opposite the way it is travelling, so a dive is readable. Clamped
    // into the sky, or a bird near the ceiling would trail a line across the horizon and
    // into the other seat's half.
    const behind = bird.height - bird.velocity * 0.05;
    const clamped = behind < 0 ? 0 : behind > SKY_HEIGHT ? SKY_HEIGHT : behind;
    renderer.line(x, worldYOf(seat, clamped), x, y, 5, palette.soft);

    renderer.circle(x, y, BIRD_RADIUS, palette.base);
    renderer.strokeCircle(x, y, BIRD_RADIUS, 2, COLOUR_INK);
    // Rule 7: p1's bird carries a single centre spot, p2's is banded across.
    if (seat === 'p1') {
      renderer.circle(x, y, 5, COLOUR_INK);
    } else {
      for (let i = -1; i <= 1; i += 1) {
        // Chorded to the circle rather than a fixed width, so the outer bands sit inside
        // the bird instead of poking out of its sides.
        const offset = i * 7;
        const reach = Math.sqrt(BIRD_RADIUS * BIRD_RADIUS - offset * offset) - 2;
        renderer.rect(x - reach, y + offset - 1.5, reach * 2, 3, COLOUR_INK);
      }
    }

    if (bird.down) {
      // Down: a cross over the bird, so which seat lost the flight is legible during the
      // pause without reading the pips.
      const reach = BIRD_RADIUS + 6;
      renderer.line(x - reach, y - reach, x + reach, y + reach, 3, COLOUR_TOOTH);
      renderer.line(x - reach, y + reach, x + reach, y - reach, 3, COLOUR_TOOTH);
    } else if (bird.recharge <= 0) {
      // Cocked: a thin ring that says the next tap will land. It is drawn because the bot
      // reads exactly this about its own wing, and rule 6 means a player must be able to
      // see anything the bot can — see the recharge gate in botIntent.
      renderer.strokeCircle(x, y, BIRD_RADIUS + 5, 1.5, COLOUR_CHALK);
    }
  }
}
