import { InputState } from './input.js';
import type { InputManager, SeatInputState } from './input.js';
import { otherSeat } from './seat.js';
import type { LogicalSize, SeatId, ZoneSplit } from './seat.js';
import {
  copyFrameInto,
  copySeatInput,
  createFrameBuffer,
  createSeatInput,
  frameProblem,
  resetSeatInput,
} from './transport.js';
import type {
  FrameSink,
  MatchTransport,
  SeatInputFrame,
  SeatInputFrameBuffer,
} from './transport.js';

/**
 * Two devices, one match, stepped in lockstep.
 *
 * The session sits exactly where the `InputManager` sat — it has the same surface, the way
 * `InputRecorder` does, so a host that drives one drives the other without changing a line —
 * and it answers one question per step: *does this device have everything it needs to run
 * step N?* If it does, it hands back the input for both seats. If it does not, it hands back
 * null and the match waits.
 *
 * ## Delay, not prediction
 *
 * Input made on this device is not applied when it is made. It is stamped for step
 * `now + inputDelaySteps`, sent, and applied on that step by **both** devices — the local
 * one included. Nothing is predicted, nothing is rolled back, and neither player ever sees a
 * world that did not happen.
 *
 * Rollback is the other answer and it is the wrong one here, for four reasons in descending
 * order of how hard they are to argue with:
 *
 * 1. It cannot be built without changing the `Game` contract. Rolling back means snapshotting
 *    and restoring simulation state every step, and a `Game` exposes neither. Adding them is
 *    107 implementations of `serialise`/`restore`, each a fresh chance to miss a field and
 *    desynchronise, against a contract whose whole point is that the shell needs nothing from
 *    a game but `update` and `render`.
 * 2. Snapshots allocate, every step, per game. Rule 5 exists because that is what makes a
 *    match stutter, and a netcode that requires breaking it is not a netcode this engine can
 *    have.
 * 3. Prediction shows one player a world it then takes back. Rule 9 refuses to let one player
 *    see more of the arena than the other; showing one of them a future that gets rewritten
 *    while the other watches the real one is the same unfairness wearing a different hat.
 * 4. What delay costs is honest and it is paid equally: both players' own input feels
 *    `inputDelaySteps` late, and neither has an advantage over the other. What it buys is
 *    that the two devices are provably running the same match, which is the property this
 *    whole exercise is for.
 *
 * The cost is real and is not hidden: at 60 Hz, a delay of 4 steps is 67 ms added to every
 * action. A game whose feel cannot survive that declares itself `sameInputClassOnly` and
 * same-network-only rather than shipping something unfair, exactly as `docs/input-parity.md`
 * has games declare themselves rather than pretend.
 *
 * ## What happens when the peer's input has not arrived
 *
 * The match waits. `beginStep` returns null, the loop renders the world it already has, and
 * nothing about the simulation moves — not the step counter, not the input sampling, not a
 * hold timer. Time in this design is counted in steps, never in seconds off a wall clock, so
 * a stall costs both devices exactly the same number of steps: zero.
 *
 * Waiting is bounded. After `stallLimitSteps` consecutive waits the peer is declared gone and
 * the session fails for good. A match cannot be continued when the other player has
 * vanished — there is no honest way to play the rest of it against nobody — so failure here
 * means *this match ends*, and the shell offers local play or a bot, which is what #2452 asks
 * for and what `docs/play-configurations.md` already says about losing a second player.
 *
 * ## When there is no transport at all
 *
 * A session built with no transport is a pass-through: it forwards every call to the
 * `InputManager` and returns exactly what the manager returns, with no delay, no frames and
 * no waiting. That is not a fallback bolted on, it is the point — the shell gets one code
 * path, and the local one is provably today's, because it *is* today's: the same object,
 * returned unwrapped.
 *
 * ## What a host still owes a remote match
 *
 * Three things this deliberately does not do, each of which belongs above it.
 *
 * **The keyboard.** A session takes the whole pointer surface for the local seat, because
 * position is a thing it can attribute. Keys are not: an `InputManager` binds one half of the
 * keyboard to each seat and refuses to bind a code twice, so a remote player holding seat two
 * gets the arrow keys and nothing else. That is a host's decision and a one-line one — build
 * the manager with `bindings: { p1: DEFAULT_BINDINGS.p2, p2: DEFAULT_BINDINGS.p1 }` when the
 * local seat is `p2` — and it is left to the host because the host is what knows the player
 * is alone at this device.
 *
 * **The shared viewport.** {@link MatchConfig.logical} is *given* to both sessions, not
 * negotiated by them; `negotiateSharedLogical` is what produces it from two screens. What
 * this does is notice, on the first frame, when the two devices were given different ones.
 *
 * **Pausing.** A pause stops sampling and sending, so the other device stalls and eventually
 * ends the match. Two people agreeing to pause is a conversation between them, and a
 * conversation needs a message that is not a seat input — which this seam does not have.
 */

/**
 * A second of delay at 60 Hz. Past this the game is not playable and a bigger buffer is not
 * the repair.
 */
const MAX_INPUT_DELAY_STEPS = 60;

/**
 * One step, and it is a floor rather than a default.
 *
 * Zero is not a smaller delay, it is a different netcode: it would have each device hold a
 * step open until the other's input for *that same step* arrived, so every step would cost a
 * round trip and the match would run at the speed of the wire rather than at 60 Hz. Worse,
 * neither device could send until it had already stepped, and both would wait for the other
 * forever. Refused at construction rather than deadlocked at run time.
 */
const MIN_INPUT_DELAY_STEPS = 1;

/** Five seconds at 60 Hz. Long enough for a lift doors' worth of lost signal, short enough
 * that nobody is left staring at a frozen board wondering whether to reload. */
const DEFAULT_STALL_LIMIT_STEPS = 300;

/** Slack either side of the window frames can legitimately arrive in. See `#capacity`. */
const WINDOW_SLACK = 32;

/** FNV-1a's offset basis, used as the seed of every fingerprint. */
const CHECK_SEED = 0x811c9dc5;

/**
 * Eight bytes of scratch, read back as two 32-bit words with the byte order named
 * explicitly.
 *
 * `DataView` rather than a `Float64Array` overlaid with a `Uint32Array`, because that
 * overlay reads whichever byte order the machine happens to use and two devices are the
 * entire subject here. Written once at module load, so mixing a number allocates nothing.
 */
const SCRATCH = new DataView(new ArrayBuffer(8));

function mix32(seed: number, word: number): number {
  let x = (seed ^ word) >>> 0;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Fold one number into a rolling 32-bit checksum, bit for bit.
 *
 * Every bit of the double is mixed, so 0.1 and 0.1000000001 are different values here as
 * they are in the simulation — a checksum that rounded first would agree about two matches
 * that had already diverged, which is the one thing it must never do.
 */
export function mixNumber(seed: number, value: number): number {
  SCRATCH.setFloat64(0, value, true);
  return mix32(mix32(seed, SCRATCH.getUint32(0, true)), SCRATCH.getUint32(4, true));
}

/**
 * Everything both devices must already agree about before the first step.
 *
 * Not negotiated here. Whatever brought the two players together settles this and hands it
 * to both sessions; what this module does is notice when they disagree.
 */
export interface MatchConfig {
  /** The game's manifest id. A trace cannot be replayed into the wrong game, nor a match. */
  readonly game: string;
  /** The match seed. Both devices deal the identical world from it. */
  readonly seed: number;
  /**
   * The negotiated shared logical box (rule 9), the same on both devices.
   *
   * `negotiateSharedLogical` produces it from the two screens; both then letterbox to it, so
   * neither player sees more of the play area than the other and a coordinate means the same
   * thing at both ends.
   */
  readonly logical: LogicalSize;
  readonly stepsPerSecond: number;
  /** Steps between making an input and its taking effect, on both devices alike. */
  readonly inputDelaySteps: number;
}

/**
 * A 32-bit fingerprint of everything the two devices must agree about.
 *
 * It seeds the rolling checksum rather than riding on the frame as a field of its own, so a
 * pair that disagrees about the seed, the shared viewport, the step rate, the delay or even
 * which game they are playing reports a mismatch on the very first frame either of them
 * sends — before a step has run, rather than after the match has silently forked.
 */
export function configFingerprint(config: MatchConfig): number {
  let hash = CHECK_SEED;
  for (let i = 0; i < config.game.length; i += 1) hash = mix32(hash, config.game.charCodeAt(i));
  hash = mixNumber(hash, config.seed);
  hash = mixNumber(hash, config.logical.width);
  hash = mixNumber(hash, config.logical.height);
  hash = mixNumber(hash, config.stepsPerSecond);
  hash = mixNumber(hash, config.inputDelaySteps);
  return hash >>> 0;
}

/**
 * `'local'` is a session with no transport, which never leaves that state. The other four
 * belong to a remote match: `'running'` stepped last time it was asked, `'waiting'` did not
 * and is still hoping, and `'failed'` and `'desynced'` are terminal — the match is over and
 * the shell must say so rather than leave a frozen board on screen.
 */
export type SessionStatus = 'local' | 'running' | 'waiting' | 'failed' | 'desynced';

export interface LockstepOptions {
  /** Which seat this device plays. The other one arrives over the transport. */
  readonly localSeat: SeatId;
  readonly config: MatchConfig;
  /**
   * Where the peer's input comes from. Absent or null means there is no peer: the session
   * becomes a pass-through and the match is an ordinary local one.
   */
  readonly transport?: MatchTransport | null;
  /** Consecutive steps spent waiting before the peer is declared gone. */
  readonly stallLimitSteps?: number;
}

export class LockstepSession implements FrameSink {
  readonly #input: InputManager;
  readonly #transport: MatchTransport | null;
  readonly #localSeat: SeatId;
  readonly #peerSeat: SeatId;
  readonly #delay: number;
  readonly #stallLimit: number;
  /**
   * Slots in each ring.
   *
   * A peer runs step `n` only once it has our frame for `n`, which we send `delay` steps
   * before we run `n` ourselves — so it can never be more than `delay` steps ahead of us, and
   * the frames it sends can never be stamped more than `2 * delay` ahead of the step we are
   * about to run. The slack is room for duplicates and for a hostile peer's nonsense, which
   * is dropped rather than allowed to overwrite a frame we still need.
   */
  readonly #capacity: number;
  readonly #localRing: SeatInputFrameBuffer[];
  readonly #peerRing: SeatInputFrameBuffer[];
  readonly #outgoing: SeatInputFrameBuffer = createFrameBuffer();
  readonly #localRecord: SeatInputState = createSeatInput();
  readonly #peerRecord: SeatInputState = createSeatInput();
  readonly #state: InputState;

  /** Checksums this device has sealed, by step, and which step each slot holds. */
  readonly #sealed: Uint32Array;
  readonly #sealedStep: Int32Array;
  /** Checksums the peer has sent that this device could not compare yet. */
  readonly #peerCheck: Uint32Array;
  readonly #peerCheckStep: Int32Array;

  readonly #initialCheck: number;
  #check: number;
  #lastSealed = -1;
  #lastSealedCheck: number;

  #status: SessionStatus;
  #step = 0;
  #stall = 0;
  #accepted = 0;
  #rejected = 0;
  #duplicates = 0;

  constructor(input: InputManager, options: LockstepOptions) {
    const config = options.config;
    const delay = config.inputDelaySteps;
    if (
      !Number.isInteger(delay) ||
      delay < MIN_INPUT_DELAY_STEPS ||
      delay > MAX_INPUT_DELAY_STEPS
    ) {
      throw new RangeError(
        `inputDelaySteps must be an integer in [${String(MIN_INPUT_DELAY_STEPS)}, ${String(MAX_INPUT_DELAY_STEPS)}], received ${String(delay)}`,
      );
    }
    const stallLimit = options.stallLimitSteps ?? DEFAULT_STALL_LIMIT_STEPS;
    if (!Number.isInteger(stallLimit) || stallLimit < 1) {
      throw new RangeError(
        `stallLimitSteps must be a positive integer, received ${String(stallLimit)}`,
      );
    }
    this.#input = input;
    this.#transport = options.transport ?? null;
    this.#localSeat = options.localSeat;
    this.#peerSeat = otherSeat(options.localSeat);
    this.#delay = delay;
    this.#stallLimit = stallLimit;
    this.#status = this.#transport === null ? 'local' : 'waiting';

    const capacity = 2 * delay + WINDOW_SLACK;
    this.#capacity = capacity;
    this.#localRing = new Array<SeatInputFrameBuffer>(capacity);
    this.#peerRing = new Array<SeatInputFrameBuffer>(capacity);
    for (let i = 0; i < capacity; i += 1) {
      this.#localRing[i] = createFrameBuffer();
      this.#peerRing[i] = createFrameBuffer();
    }
    this.#sealed = new Uint32Array(capacity);
    this.#sealedStep = new Int32Array(capacity).fill(-1);
    this.#peerCheck = new Uint32Array(capacity);
    this.#peerCheckStep = new Int32Array(capacity).fill(-1);

    this.#initialCheck = configFingerprint(config);
    this.#check = this.#initialCheck;
    this.#lastSealedCheck = this.#initialCheck;

    this.#state =
      this.#localSeat === 'p1'
        ? new InputState(this.#localRecord, this.#peerRecord)
        : new InputState(this.#peerRecord, this.#localRecord);

    if (this.#transport !== null) {
      // In a remote match the whole surface is this player's, always. There is nobody else
      // at this device to give half of it to, and a turn-based board must not rotate away
      // from the one person looking at it (`docs/play-configurations.md`: Remote never
      // rotates). The two setters below are no-ops for the same reason.
      input.setSplit('shared');
      input.setBoardSeat(this.#localSeat);
    }
  }

  /** The manager underneath, for a host that needs it directly. */
  get manager(): InputManager {
    return this.#input;
  }

  get status(): SessionStatus {
    return this.#status;
  }

  /** True while this session is a plain local match with no peer. */
  get local(): boolean {
    return this.#transport === null;
  }

  get localSeat(): SeatId {
    return this.#localSeat;
  }

  /** Simulation steps completed. The frame stamp of the step about to run. */
  get step(): number {
    return this.#step;
  }

  /** Consecutive steps spent waiting for the peer; 0 whenever the last step ran. */
  get stallSteps(): number {
    return this.#stall;
  }

  /** The rolling checksum of everything {@link mix} has been given. */
  get checksum(): number {
    return this.#check;
  }

  /** Peer frames taken into the ring. */
  get accepted(): number {
    return this.#accepted;
  }

  /** Peer frames refused: malformed, wrong seat, or outside the window they could apply in. */
  get rejected(): number {
    return this.#rejected;
  }

  /** Peer frames arriving for a step already held or already simulated. */
  get duplicates(): number {
    return this.#duplicates;
  }

  /**
   * Fold one simulation observable into this device's checksum.
   *
   * Called by the host after a step with whatever the match can see of the game — the two
   * scores, the winner, whose turn it is — the same values `cross-viewport.test.ts` compares
   * to prove two devices stepped the same match. Mixing nothing is allowed and costs only
   * the ability to notice a divergence; mixing anything that is not part of the simulation
   * (a frame rate, a screen size, a random tie-break) would report every match as a
   * divergence, so the rule is simple: only what the rules of the game produced.
   */
  mix(value: number): void {
    this.#check = mixNumber(this.#check, value);
  }

  // ---- the InputManager surface, so a host drives this exactly as it drives one ----

  get logical(): LogicalSize {
    return this.#input.logical;
  }

  keyDown(code: string): void {
    this.#input.keyDown(code);
  }

  keyUp(code: string): void {
    this.#input.keyUp(code);
  }

  pointerDown(id: number, x: number, y: number): void {
    this.#input.pointerDown(id, x, y);
  }

  pointerMove(id: number, x: number, y: number): void {
    this.#input.pointerMove(id, x, y);
  }

  pointerUp(id: number): void {
    this.#input.pointerUp(id);
  }

  pointerCancel(id: number): void {
    this.#input.pointerCancel(id);
  }

  isBound(code: string): boolean {
    return this.#input.isBound(code);
  }

  /** Ignored in a remote match: the whole surface belongs to the local seat. */
  setBoardSeat(seat: SeatId): void {
    if (this.#transport !== null) return;
    this.#input.setBoardSeat(seat);
  }

  /** Ignored in a remote match, for the same reason as {@link setBoardSeat}. */
  setSplit(split: ZoneSplit): void {
    if (this.#transport !== null) return;
    this.#input.setSplit(split);
  }

  /**
   * Drop everything held, for a pause or a lost window.
   *
   * Local to this device. The peer's session clears its own hands when its own window goes
   * away, and neither can clear the other's — a frame already sent has already happened.
   */
  clear(): void {
    this.#input.clear();
  }

  /**
   * Input for the step about to run, or null if this device cannot run it yet.
   *
   * Null is not an error and not a frame drop: it means *wait*. The caller renders and comes
   * back next frame. Allocates nothing, on either path.
   */
  beginStep(fixedDeltaSeconds: number): Readonly<InputState> | null {
    const transport = this.#transport;
    // A local match is the manager, unwrapped and unmodified. Nothing below this line runs.
    if (transport === null) return this.#input.beginStep(fixedDeltaSeconds);
    if (this.#over()) return null;

    transport.drain(this);
    // Re-asked rather than remembered: `drain` hands frames to `accept`, which is where a
    // checksum mismatch is found. Through a method, so nothing narrows the field away.
    if (this.#over()) return null;

    const transportStatus = transport.status;
    if (transportStatus === 'closed' || transportStatus === 'failed') {
      this.#fail();
      return null;
    }

    const step = this.#step;
    if (!this.#peerReady(step)) {
      this.#stall += 1;
      this.#status = 'waiting';
      if (this.#stall >= this.#stallLimit) this.#fail();
      return null;
    }

    // Sealed before the outgoing frame is filled, so the checksum it carries is this
    // device's answer for every step it has actually finished.
    this.#seal(step - 1);
    if (this.#over()) return null;

    // Sampled now, applied in `delay` steps — on both devices, this one included.
    const sampled = this.#input.beginStep(fixedDeltaSeconds);
    const outgoing = this.#outgoing;
    outgoing.seat = this.#localSeat;
    outgoing.step = step + this.#delay;
    outgoing.checkStep = this.#lastSealed;
    outgoing.check = this.#lastSealedCheck;
    copySeatInput(outgoing.input, sampled.seat(this.#localSeat));
    const localSlot = this.#localRing[outgoing.step % this.#capacity];
    if (localSlot !== undefined) copyFrameInto(localSlot, outgoing);
    transport.send(outgoing);

    this.#applyLocal(step);
    this.#applyPeer(step);

    this.#step = step + 1;
    this.#stall = 0;
    this.#status = 'running';
    return this.#state;
  }

  /**
   * End the match's transport. The session stays readable; it simply never steps again.
   *
   * A local session has nothing to close and is not ended by this. Saying otherwise would be
   * a lie the status told: with no transport, `beginStep` goes on returning the manager's own
   * state — as it must, because that is what local play *is* — so a `failed` local session
   * would be a session reporting one thing and doing another.
   */
  close(): void {
    if (this.#transport === null) return;
    this.#transport.close();
    if (this.#status !== 'desynced') this.#status = 'failed';
  }

  /**
   * Take a frame off the transport.
   *
   * Every frame is validated here, because this is the one place another person's browser
   * reaches this device's simulation. A frame that is malformed, that claims the local seat,
   * that is stamped for a step already simulated, or that is stamped absurdly far ahead is
   * counted and dropped — never allowed to overwrite a frame this device still needs.
   */
  accept(frame: Readonly<SeatInputFrame>): void {
    if (this.#over()) return;
    if (frameProblem(frame) !== null) {
      this.#rejected += 1;
      return;
    }
    if (frame.seat !== this.#peerSeat) {
      this.#rejected += 1;
      return;
    }
    const step = frame.step;
    if (step < this.#step) {
      // Already simulated, so this is a duplicate: a step cannot have run without its frame.
      this.#duplicates += 1;
      return;
    }
    if (step >= this.#step + this.#capacity) {
      this.#rejected += 1;
      return;
    }
    const slot = this.#peerRing[step % this.#capacity];
    if (slot === undefined) return;
    if (slot.step === step) this.#duplicates += 1;
    else {
      // Any other step this slot holds is one already simulated: the live window is exactly
      // `capacity` steps wide, so no two unsimulated steps can share a slot.
      copyFrameInto(slot, frame);
      this.#accepted += 1;
    }
    this.#takePeerCheck(frame.checkStep, frame.check);
  }

  /**
   * Whether this match is over, either way it can be.
   *
   * A method rather than a comparison at each site, so that reading it once does not narrow
   * the field for the rest of the function — the status can change inside a call, which is
   * exactly what `drain` does when a frame turns out to disagree.
   */
  #over(): boolean {
    return this.#status === 'failed' || this.#status === 'desynced';
  }

  /**
   * The two devices are no longer playing the same match. Stop, and hang up.
   *
   * Only one of the two finds this out — whichever holds both checksums first — because the
   * one that notices stops stepping, and a session that has stopped stepping sends nothing
   * more for the other to compare against. So it closes the transport, which is how the other
   * device learns immediately rather than by waiting out its stall timer. It ends the match
   * on both, and only one of them can say why; carrying the reason across would need a
   * message that is not a seat input, and this seam deliberately has no such thing.
   */
  #desync(): void {
    if (this.#status === 'desynced') return;
    this.#status = 'desynced';
    this.#transport?.close();
  }

  /**
   * Give up on the peer, and hang up on the way out.
   *
   * The transport is closed rather than merely abandoned, because the common reason a device
   * stops sending is that its player put the phone down — the link is still there, and the
   * other person is sitting in front of a frozen board waiting out a timer that will tell
   * them nothing this could not tell them now.
   */
  #fail(): void {
    if (this.#status === 'failed') return;
    this.#status = 'failed';
    this.#transport?.close();
  }

  /** Whether the peer's input for `step` is in hand. The warm-up steps need nothing. */
  #peerReady(step: number): boolean {
    if (step < this.#delay) return true;
    const slot = this.#peerRing[step % this.#capacity];
    return slot !== undefined && slot.step === step;
  }

  #applyLocal(step: number): void {
    if (step < this.#delay) {
      // Nobody had made an input yet, and both devices know it without being told.
      resetSeatInput(this.#localRecord);
      return;
    }
    const slot = this.#localRing[step % this.#capacity];
    if (slot === undefined || slot.step !== step) {
      resetSeatInput(this.#localRecord);
      return;
    }
    copySeatInput(this.#localRecord, slot.input);
  }

  #applyPeer(step: number): void {
    if (step < this.#delay) {
      resetSeatInput(this.#peerRecord);
      return;
    }
    const slot = this.#peerRing[step % this.#capacity];
    // `#peerReady` has already said this slot holds this step.
    if (slot === undefined || slot.step !== step) {
      resetSeatInput(this.#peerRecord);
      return;
    }
    copySeatInput(this.#peerRecord, slot.input);
  }

  /** Record this device's checksum as of the end of `step`, and compare if the peer's is in. */
  #seal(step: number): void {
    if (step < 0 || step <= this.#lastSealed) return;
    const slot = step % this.#capacity;
    this.#sealed[slot] = this.#check;
    this.#sealedStep[slot] = step;
    this.#lastSealed = step;
    this.#lastSealedCheck = this.#check;
    if (this.#peerCheckStep[slot] === step && this.#peerCheck[slot] !== this.#check) {
      this.#desync();
    }
  }

  #takePeerCheck(checkStep: number, check: number): void {
    if (checkStep < 0) {
      // Before either device has finished a step, the checksum is the config fingerprint —
      // so this compares the seed, the shared viewport, the step rate, the input delay and
      // the game itself, on the first frame that arrives.
      if (check !== this.#initialCheck) this.#desync();
      return;
    }
    const slot = checkStep % this.#capacity;
    if (checkStep <= this.#lastSealed) {
      if (this.#sealedStep[slot] === checkStep && this.#sealed[slot] !== check) {
        this.#desync();
      }
      return;
    }
    // Ahead of this device: hold it until the matching step has been sealed here.
    this.#peerCheckStep[slot] = checkStep;
    this.#peerCheck[slot] = check;
  }
}
