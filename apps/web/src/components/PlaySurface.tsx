'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { setActiveSeatPalette, type SeatId } from '@duelbox/engine';
import {
  advanceClock,
  clockExpired,
  clockRemaining,
  clockWarning,
  createClock,
  formatClock,
  initialMatchState,
  reduce,
  resetClock,
  type Game,
  type GameManifest,
  type MatchClock,
  type MatchEvent,
  type MatchRules,
} from '@duelbox/game-sdk';
import { PLAYABLE, loadGame } from '@/data/registry';
import { GAME_NAMES } from '@/data/game-names.generated';
import { hasSeenHints, markHintsSeen } from '@/lib/control-hints';
import { SEAT_CHARACTERS, seatNamesFor } from '@/lib/seats';
import {
  addOutcome,
  EMPTY_TALLY,
  readGameRecord,
  recordResult,
  type Opponent,
  type Tally,
} from '@/lib/head-to-head';
import { readPlayerNames } from '@/lib/player-names';
import { readSettings } from '@/lib/settings';
import { useGameplayTouchTarget } from '@/lib/touch-target';
import { readSetup, writeSetup } from '@/lib/last-mode';
import { armAudio, audio } from '@/lib/audio';
import { ducksMatchAudio, shellCueFor } from '@/lib/match-cues';
import { vibrate } from '@/lib/haptics';
import { readRecent, recordPlayed } from '@/lib/recent';
import {
  currentGame,
  initialTournament,
  isCurrentLeg,
  pickTournamentGames,
  reduce as reduceTournament,
  resume,
  TOURNAMENT_LEG_ROUNDS,
  TOURNAMENT_LENGTH,
  legsToWin,
  type TournamentState,
} from '@/lib/tournament';
import { clearTournament, readTournament, writeTournament } from '@/lib/tournament-store';
import {
  DEFAULT_SETUP,
  botSeatsFor,
  matchRulesFor,
  type BotDifficulty,
  type MatchSetup,
  type PlayMode,
} from '@/lib/match-setup';
import { GameHost } from './GameHost';
import { TournamentTrack } from './TournamentTrack';
import { TracePanel } from './TracePanel';
import { MatchHud } from './MatchHud';
import { MatchOverlay } from './MatchOverlay';
import { MatchOptions } from './MatchOptions';
import { GameOptionsPanel } from './GameOptionsPanel';
import { ExitControl } from './ExitControl';
import { ControlHints } from './ControlHints';
import { HandoffOverlay } from './HandoffOverlay';
import { GameErrorBoundary } from './GameErrorBoundary';
import { shouldHandOff } from './handoff';
import { Controls } from './Controls';
import styles from './PlaySurface.module.css';

type Mode = PlayMode;

/**
 * The shared match flow every game runs inside: choose a mode, count in, play, pause,
 * see the result, play again.
 *
 * None of it belongs to a game. Games supply a simulation and an outcome; the countdown,
 * the HUD, the pause menu, the result screen and the rematch all come from here, so the
 * hundred-and-eighth game inherits them for free and the first seven cannot drift apart.
 */
export function PlaySurface({ slug }: { slug: string }) {
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [manifest, setManifest] = useState<GameManifest | null>(null);
  const [create, setCreate] = useState<(() => Game) | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [activeSeat, setActiveSeat] = useState<SeatId | null>(null);
  /**
   * Whether to record an input trace, read once from `?trace=1`.
   *
   * A query parameter rather than a build flag, because the report that matters is the one
   * somebody makes about the deployed site, and a flag they cannot turn on is a flag that
   * never records the bug. Read in an effect rather than during render: this page is
   * statically exported, and reading `location` while rendering makes the server's HTML and
   * the browser's first paint disagree.
   */
  const [recording, setRecording] = useState(false);
  const [getTrace, setGetTrace] = useState<(() => string) | null>(null);
  useEffect(() => {
    setRecording(new URLSearchParams(globalThis.location.search).get('trace') === '1');
  }, []);

  /**
   * Armed here rather than in `GameHost`, and the difference is the whole point.
   *
   * `GameHost` mounts only *after* Start is pressed, so by the time it could attach a
   * listener the gesture that should have unlocked audio has already happened, and the
   * first match plays in silence — which is the failure #167 describes, reached from the
   * other side. The play page mounts before Start, so the Start tap is itself the
   * unlocking gesture and nobody is ever asked for permission.
   *
   * Idempotent, and `armAudio` also re-arms after iOS suspends the context for a
   * backgrounded tab or a phone call.
   */
  useEffect(() => {
    armAudio();
  }, []);
  // A new seed per match keeps a rematch from replaying the previous one exactly.
  const [seed, setSeed] = useState(1);

  /**
   * What this player last chose for this game: mode, bot tier and match length.
   *
   * Loaded in an effect rather than during render, for the reason the trace flag is: the
   * page is statically exported, so the server's HTML knows nothing about this device's
   * storage, and reading it while rendering makes the first paint disagree with it. The
   * defaults render, and the remembered choice replaces them a frame later.
   */
  const [setup, setSetup] = useState<MatchSetup>(DEFAULT_SETUP);
  /** What the two people here call themselves, if they have said (#161). */
  const [chosenNames, setChosenNames] = useState<Readonly<Partial<Record<SeatId, string>>>>({});
  /**
   * The tournament this device has in progress, if it has one (#157).
   *
   * Written down on every change rather than held here, because a tournament spans seven
   * URLs: leg three is a different page from leg two, so every advance through one is a
   * page load and React state cannot carry it across. `resume` derives the phase, which is
   * the one thing about a tournament that is deliberately not stored.
   */
  const [tournament, setTournament] = useState<TournamentState>(initialTournament);
  /**
   * Whether the match on screen is a tournament leg, fixed at the moment it starts.
   *
   * State rather than a look at `tournament`, because the tournament moves on the instant a
   * leg is reported: a derived answer would flip to "not a leg" as the result screen
   * appeared, and the HUD would grow round pips for a best-of nobody chose.
   */
  const [legMatch, setLegMatch] = useState(false);
  // Three reads of this device's storage, in one effect because they are one thing: what
  // this browser already knows before anybody presses Start.
  useEffect(() => {
    setSetup(readSetup(slug));
    setHintsDue(!hasSeenHints(slug));
    setChosenNames(readPlayerNames());
    // `PLAYABLE` rather than nothing: a line-up drawn before a game was switched off (#208)
    // would otherwise send the pair to a route this build no longer exports, and a leg can
    // only be reported from the route it names.
    const stored = readTournament(PLAYABLE);
    setTournament(stored === null ? initialTournament() : resume(stored));
  }, [slug]);

  /**
   * Which seats a bot holds this match, and how hard it tries.
   *
   * Memoised because its identity has to be stable for the life of a match: it sits in
   * the game host's setup-effect dependencies, and when this was written inline it was a
   * fresh object on every render — the first countdown frame tore the game down and
   * rebuilt it, and bot matches hung on the countdown forever. Neither dependency can
   * change while a match is running: the tier is only offered before one starts.
   */
  const botSeats = useMemo(
    () => (mode === null ? undefined : botSeatsFor(mode, setup.difficulty)),
    [mode, setup.difficulty],
  );

  /**
   * Who is in the far seat, which is the record this match belongs on.
   *
   * Derived from the same `botSeats` map the game host is handed rather than from `mode`
   * again, so "who is a bot" is decided once per match. A bot's wins are not the far
   * player's wins, and the store keeps the two apart — see `lib/head-to-head.ts`.
   */
  const opponent: Opponent = botSeats === undefined ? 'friend' : 'bot';

  /**
   * The head-to-head at this game *before* the match now on screen, from storage.
   *
   * It was the tally for one sitting, held here and nowhere else, so five matches on
   * Tuesday were gone by Wednesday and gone the moment anybody reloaded (#160). The store
   * is the source now, and this state exists only so nothing has to read storage during a
   * render.
   *
   * Deliberately the record *before* this match rather than after it. A passive effect
   * runs after the commit that showed the result, so a screen fed from one painted the
   * score as it stood before the match the players had just watched end — and on the very
   * first match at a game it painted with no record line at all and then inserted one
   * above the Rematch button a frame later, under a thumb already on its way there. What
   * the panel is handed is this plus the outcome the match machine has already settled,
   * which is known during the same render.
   *
   * Re-read whenever the match changes — a new `seed` is a new match — so the match after
   * this one starts from what the store now holds.
   */
  const [recordBefore, setRecordBefore] = useState<Tally>(EMPTY_TALLY);
  useEffect(() => {
    setRecordBefore(readGameRecord(slug, opponent));
  }, [slug, opponent, seed]);

  /**
   * The seven games built so far settle their own rounds and report a winner, so the
   * shell trusts that outcome rather than second-guessing it from the score. Games that
   * declare a win condition instead get it resolved here; both paths run the same flow.
   *
   * The match length is the player's, from the pre-match screen. It was hardcoded to one
   * round, which made `round-over` unreachable in the entire product (#2485) — and with
   * it the round pips, the "Next round" screen and the opening-seat rotation of #2466,
   * all of which are implemented and were being shipped switched off.
   */
  const rules = useMemo<MatchRules>(
    // A tournament leg is a single match whatever the player's remembered length says: the
    // tournament is the best-of, and seven best-of-threes is a different product
    // (`docs/tournament.md`).
    () => matchRulesFor(legMatch ? TOURNAMENT_LEG_ROUNDS : setup.rounds),
    [legMatch, setup.rounds],
  );

  const [match, send] = useReducer(
    (state: ReturnType<typeof initialMatchState>, event: MatchEvent) => reduce(state, event, rules),
    undefined,
    initialMatchState,
  );

  /** Whether the quit confirmation is open (#144). The persistent exit control is always shown. */
  const [exitOpen, setExitOpen] = useState(false);
  /** An error a game threw, caught at the host boundary, surfaced as the recovery screen (#151). */
  const [gameError, setGameError] = useState<unknown>(null);
  /** The seat the device is being passed to, or null when no hand-off is in progress (#134). */
  const [handoffTo, setHandoffTo] = useState<SeatId | null>(null);
  /**
   * Whether this device has been shown this game's "which half is yours" hints (#137), and
   * which seats have since played.
   *
   * `null` until storage has been read, which is one frame after the first paint on a static
   * export — and a hint that flashed up for a returning pair and vanished would be worse than
   * one that arrives a frame late.
   */
  const [hintsDue, setHintsDue] = useState(false);
  const [seatUsed, setSeatUsed] = useState<Record<SeatId, boolean>>({ p1: false, p2: false });
  /** The active seat the last hand-off check saw, so only a real change of hands blacks out. */
  const handoffFrom = useRef<SeatId | null>(null);

  /**
   * The round/match clock (#149), advanced from the fixed step and shown in the HUD.
   *
   * Held in a ref and advanced every tick, but only surfaced to React when the displayed
   * `m:ss` actually changes — a clock re-rendering the whole surface sixty times a second is
   * the one thing a HUD element must not do. Inert unless a game declares `roundLimitSeconds`,
   * which none in the catalogue does today, so the whole path costs nothing for them.
   */
  const clockLimit = rules.roundLimitSeconds ?? null;
  const clockRef = useRef<MatchClock>(createClock(clockLimit, rules.clockWarnSeconds));
  const [clockView, setClockView] = useState<{ text: string; warning: boolean } | null>(null);
  // Read inside the stable `handleTick` without re-creating it every frame.
  const clockLimitRef = useRef(clockLimit);
  clockLimitRef.current = clockLimit;
  const phaseRef = useRef(match.phase);
  phaseRef.current = match.phase;
  const tallyRef = useRef(match.tally);
  tallyRef.current = match.tally;
  /** True once this round's expiry has been reported, so it fires the round end exactly once. */
  const expiredRef = useRef(false);
  // The physical size a gameplay control should be on this device (#1889). Read in an
  // effect inside the hook and kept current across a DPR change, so it is the shell target
  // on the first paint and the device-aware size a frame later.
  const gameplayTarget = useGameplayTouchTarget();

  useEffect(() => {
    let cancelled = false;
    // Select the seat palette before the game chunk loads (#174). A game may read
    // `SEAT_PALETTE.p1.base` into a module-level constant as its file is evaluated, so the
    // choice has to be in effect before the dynamic import inside `loadGame` resolves and
    // runs that file — hence here, synchronously, rather than in `GameHost` where the chunk
    // has already been read. It is a no-op on the default and cheap either way.
    setActiveSeatPalette(readSettings().seatPalette);
    loadGame(slug)
      .then((loaded) => {
        if (cancelled) return;
        setManifest(loaded.manifest);
        setCreate(() => () => loaded.create());
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Escape pauses and resumes. The host deliberately never swallows it.
  //
  // Shift+Escape opens the quit confirmation instead (#144) — a distinct shortcut that is
  // deliberately not a seat action key. Enter is seat two's and Space is seat one's, and the
  // host captures both while the board is live, so a shortcut on either could never reach
  // here (HANDOFF: the Enter-is-seat-two bug); the host passes Escape straight through with
  // its modifiers, so Shift+Escape arrives intact.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.code !== 'Escape') return;
      const live =
        match.phase === 'playing' || match.phase === 'countdown' || match.phase === 'paused';
      if (event.shiftKey) {
        if (live) setExitOpen(true);
        return;
      }
      if (match.phase === 'playing' || match.phase === 'countdown') send({ kind: 'pause' });
      else if (match.phase === 'paused') send({ kind: 'resume' });
    }
    globalThis.addEventListener('keydown', onKey);
    return () => {
      globalThis.removeEventListener('keydown', onKey);
    };
  }, [match.phase]);

  /**
   * Stop the browser's own pull-to-refresh while a match is running.
   *
   * The canvas already declares `overscroll-behavior: contain`, but that only covers a
   * gesture that *starts on the canvas*. A match letterboxes, so on a phone there is page
   * either side of the board — and a swipe down that starts there reaches the document and
   * pulls the page to refresh, throwing away the match. `touch-action` on the canvas
   * cannot help, because the finger never touched the canvas.
   *
   * Scoped to a live match rather than to the whole route, so a player looking at a lobby
   * or a result can still refresh the page the ordinary way.
   */
  useEffect(() => {
    const live =
      match.phase === 'countdown' || match.phase === 'playing' || match.phase === 'paused';
    if (!live) return;
    const root = document.documentElement;
    root.dataset.match = 'live';
    return () => {
      delete root.dataset.match;
    };
  }, [match.phase]);

  /**
   * The seed of the match already written down, so a match is counted exactly once.
   *
   * A seed identifies a match here: one is drawn on Start and another on every rematch.
   * This effect used to add one to the tally from its previous value on every entry into
   * `match-over`, which is a shape that counts twice as soon as anything re-runs it — a
   * remount, a Fast Refresh, a dependency added later — and a double count is invisible
   * precisely because both numbers look plausible. A ref rather than state: writing it
   * must not cause the render that would run this effect again.
   */
  const counted = useRef(0);
  useEffect(() => {
    if (match.phase !== 'match-over') return;
    const outcome = match.matchOutcome;
    // A match the machine ends with no outcome at all is not a result to record. It is
    // also not reachable today, and recording a phantom draw if it ever became reachable
    // is worse than recording nothing.
    if (outcome === null || counted.current === seed) return;
    counted.current = seed;
    // Write only. What the result screen shows is `addOutcome` applied to the same tally
    // this call is about to write, from the same function, so the two cannot be different
    // arithmetic — and the panel does not have to wait for a second commit to be right.
    recordResult(slug, outcome, opponent);
    /**
     * And the tournament, if this is the game it is waiting on.
     *
     * A leg is reported by that route and by no other, which is what makes a result count
     * once: the result screen still offers Rematch — taking it away would be a worse answer
     * than leaving it — and a replayed leg is a friendly game that goes on the head-to-head
     * record above and not on the tournament. The head-to-head write is unconditional for
     * the same reason: a match played to its end is a match played to its end.
     */
    if (!isCurrentLeg(tournament, slug)) return;
    const advanced = reduceTournament(tournament, { kind: 'report', outcome });
    writeTournament(advanced);
    setTournament(advanced);
  }, [match.phase, match.matchOutcome, seed, slug, opponent, tournament]);

  /**
   * A buzz when a round ends and another when the match does (#135).
   *
   * Inert until the player turns vibration on: `vibrate` checks the setting and the device
   * before it does anything and returns quietly when either says no, so on the default
   * install this costs one settings read per phase change and nothing else. A draw gets
   * the short tap rather than the win pattern — the phone is lying between two people who
   * both just failed to win, and celebrating at them is the wrong note.
   */
  useEffect(() => {
    if (match.phase === 'round-over') vibrate('score');
    else if (match.phase === 'match-over') vibrate(match.matchOutcome === 'draw' ? 'tap' : 'win');
  }, [match.phase, match.matchOutcome]);

  /**
   * The same phase changes, said in sound (#168) and given room to be heard (#172).
   *
   * The shell owns the count-in, the pause and the result, so it owns their cues too;
   * `lib/match-cues.ts` turns the match state into one of them and
   * `packages/engine/src/sound-events.ts` is the vocabulary both halves of the product read.
   * Nothing is audible yet — no sound file exists (#169, #170), so `play` is handed a name
   * nothing has registered and answers false — and that is the intended state: the names are
   * wired now so the recordings drop into a shell already asking for them.
   */
  const cue = shellCueFor(match);
  const beat = Math.ceil(match.countdownRemaining);
  /** The cue and beat already raised, so a re-run of this effect is not a second sound. */
  const raised = useRef('');
  useEffect(() => {
    if (cue === null) return;
    // The beat is part of the identity, not decoration: a count-in raises the same cue once
    // a second, and without the number the second beat reads as a repeat of the first and is
    // dropped. It also covers development's double-invoked effects, which would otherwise
    // make every cue in the product fire twice in the one environment anybody is listening.
    const key = `${cue}:${String(beat)}`;
    if (raised.current === key) return;
    raised.current = key;
    const sound = audio();
    sound.play(cue);
    // Drained here rather than left to the host's per-frame `flush()`, which is the only
    // other caller. The loop is stopped in every phase that is not live, so a cue raised at
    // a pause or a result would sit in the queue until somebody started the next match and
    // then fire against that screen instead.
    sound.flush();
  }, [cue, beat]);

  /**
   * Hold the match down while a count-in or a result is on screen.
   *
   * This is the caller #172's reference-counted duck was written for and did not have. The
   * duck moves the master gain rather than a sound, so it works with nothing playing (a
   * ramp on a node with no voices under it) and before the first gesture has built a context
   * at all; and it cannot fight the mute, because a muted system reports zero however deep
   * the duck is. `ducksMatchAudio` says which cues take one and why the other two do not.
   *
   * One duck per held reason, released in the cleanup, so the pairing is React's to get
   * right rather than ours: an effect that is torn down and set up again nets one duck, and
   * the counted API means an unduck can never run a debt up that the *next* announcement
   * would pay by not ducking at all.
   */
  const ducking = cue !== null && ducksMatchAudio(cue);
  useEffect(() => {
    if (!ducking) return;
    const sound = audio();
    sound.duck();
    return () => {
      sound.unduck();
    };
  }, [ducking]);

  const handleTick = useCallback((dt: number) => {
    send({ kind: 'tick', seconds: dt });
    // The clock advances on the same fixed step (#149), but only when a game is timed —
    // otherwise there is nothing to run and nothing to re-render.
    if (clockLimitRef.current === null) return;
    const advanced = advanceClock(clockRef.current, phaseRef.current, dt);
    clockRef.current = advanced;
    const remaining = clockRemaining(advanced);
    if (remaining !== null) {
      const text = formatClock(remaining);
      const warning = clockWarning(advanced);
      // Surface to React only when the shown value changes, so the HUD updates about once a
      // second rather than every frame.
      setClockView((previous) =>
        previous !== null && previous.text === text && previous.warning === warning
          ? previous
          : { text, warning },
      );
    }
    if (clockExpired(advanced) && phaseRef.current === 'playing' && !expiredRef.current) {
      // Time is up. Report the round's current tally with `timeExpired`, which the win
      // condition resolves into a round or match end. Latched so it fires once.
      expiredRef.current = true;
      send({ kind: 'score', tally: tallyRef.current, timeExpired: true });
    }
  }, []);

  /**
   * Reset the clock at the start of every round, and whenever a fresh match begins.
   *
   * The round number and the seed together identify a round; when either changes the clock
   * goes back to its limit and the expiry latch clears, so a rematch or the next round of a
   * best-of counts its own time from zero rather than inheriting the last one's.
   */
  useEffect(() => {
    clockRef.current = resetClock(createClock(clockLimit, rules.clockWarnSeconds));
    expiredRef.current = false;
    setClockView(clockLimit === null ? null : { text: formatClock(clockLimit), warning: false });
  }, [seed, match.round, clockLimit, rules.clockWarnSeconds]);

  const handleScore = useCallback((p1: number, p2: number, winner: SeatId | 'draw' | null) => {
    send({ kind: 'score', tally: { p1, p2 }, outcome: winner });
  }, []);

  const handlePauseRequest = useCallback(() => {
    send({ kind: 'pause' });
  }, []);

  const start = useCallback(
    (chosen: Mode) => {
      // Remembered as a default for next time, never as a decision: reopening this game
      // pre-selects what you last chose, it does not start it.
      writeSetup(slug, { mode: chosen });
      setSetup((previous) => ({ ...previous, mode: chosen }));
      // Counted as played from the moment a mode is chosen rather than when the match
      // ends, because a pair who quit halfway through still played it (#87).
      recordPlayed(slug);
      // Settled here rather than derived while the match runs: see `legMatch`.
      setLegMatch(isCurrentLeg(tournament, slug));
      setMode(chosen);
      setActiveSeat(null);
      const next = seed + 1;
      setSeed(next);
      // The seed goes with the event: it is what the match machine flips its opening-seat
      // coin from, and that coin has to be reproducible from the match rather than drawn
      // from entropy the replay cannot recover (#2466).
      send({ kind: 'start', seed: next });
    },
    // `seed` is read, so it belongs here: without it the callback closes over the seed
    // from the render that created it and every match after the first would open on a
    // stale one. This was found by hand; `react-hooks/exhaustive-deps` now fails the
    // build on it, so the next one will not be (#2482).
    [slug, seed, tournament],
  );

  /**
   * Starts a tournament from this game's lobby (#156).
   *
   * The first leg is the game the press happened in and the other six are drawn; that
   * follows from where the entry point is rather than from taste, and
   * `docs/tournament.md` sets out both. The current game is kept out of the pool so the
   * line-up cannot repeat it.
   *
   * `Math.random` is right here and forbidden under `packages/`: this is the shell deciding
   * what to open, not a simulation, and no match depends on which games were drawn.
   *
   * Reduced from whatever state the machine is in rather than from a fresh one, so the
   * `complete → start` transition in its table is the one that actually runs when a pair
   * start a second tournament off the screen that told them who won the first. A `start`
   * while one is running is refused by that same table, which is why nothing offers it.
   */
  const beginTournament = useCallback(
    (against: Opponent) => {
      const games = [
        slug,
        ...pickTournamentGames(
          PLAYABLE.filter((candidate) => candidate !== slug),
          readRecent(),
          TOURNAMENT_LENGTH - 1,
          Math.random,
        ),
      ];
      const drawn = reduceTournament(tournament, { kind: 'start', games, opponent: against });
      writeTournament(drawn);
      setTournament(drawn);
    },
    [slug, tournament],
  );

  /**
   * Leaves the tournament, in one press.
   *
   * Storage is cleared outside the updater on purpose: React may call a state updater more
   * than once, and an updater that also wrote to storage would be a side effect running an
   * unknown number of times.
   */
  const leaveTournament = useCallback(() => {
    clearTournament();
    setTournament((current) => reduceTournament(current, { kind: 'abandon' }));
  }, []);

  const rematch = useCallback(() => {
    setActiveSeat(null);
    setGameError(null);
    handoffFrom.current = null;
    setHandoffTo(null);
    const next = seed + 1;
    setSeed(next);
    send({ kind: 'rematch', seed: next });
  }, [seed]);

  const quit = useCallback(() => {
    setMode(null);
    setLegMatch(false);
    setExitOpen(false);
    setGameError(null);
    handoffFrom.current = null;
    setHandoffTo(null);
    send({ kind: 'quit' });
  }, []);

  /**
   * Restart the match cleanly, from the pause menu (#145) or the recovery screen (#151).
   *
   * A quit back to idle followed by a fresh start, with a new seed so the game host tears the
   * game down and rebuilds it — the honest way to guarantee a restarted match is a new match
   * and not a half-reset one. The mode is React state and survives, so the same opponent is
   * kept; only the match itself starts over.
   */
  const restart = useCallback(() => {
    setActiveSeat(null);
    setExitOpen(false);
    setGameError(null);
    handoffFrom.current = null;
    setHandoffTo(null);
    const next = seed + 1;
    setSeed(next);
    send({ kind: 'quit' });
    send({ kind: 'start', seed: next });
  }, [seed]);

  /** A game threw; the host stopped the loop, and this raises the recovery screen (#151). */
  const handleGameError = useCallback((error: unknown) => {
    setGameError(error ?? new Error('The game stopped unexpectedly.'));
  }, []);

  /**
   * The active seat changed. Track it for the turn indicator, and raise the pass-and-play
   * blackout when a hand-off game changes hands (#134).
   *
   * Only for a game that opted in, and only on a real change from one seat to another — the
   * first seat of a match is nobody handing over. A game that does not opt in never blacks out.
   */
  /**
   * A seat's first successful input, from `GameHost` (#137).
   *
   * The seat's hint goes, and the *pair* is marked as shown the moment either seat plays —
   * not when both do. A pair who have started are a pair who have understood, and a game
   * where one player moves first is every game; waiting for the second would leave a device
   * that has played a match still counted as never having seen the hints.
   */
  const handleSeatInput = useCallback(
    (seat: SeatId) => {
      setSeatUsed((used) => (used[seat] ? used : { ...used, [seat]: true }));
      markHintsSeen(slug);
    },
    [slug],
  );

  const handleActiveSeat = useCallback(
    (seat: SeatId | null) => {
      setActiveSeat(seat);
      if (manifest !== null && shouldHandOff(manifest, handoffFrom.current, seat)) {
        setHandoffTo(seat);
      }
      handoffFrom.current = seat;
    },
    [manifest],
  );

  const continueHandoff = useCallback(() => {
    setHandoffTo(null);
  }, []);

  // Both written through as they are chosen rather than when a match starts, so a player
  // who sets a tier and then walks away still finds it set tomorrow.
  const chooseDifficulty = useCallback(
    (difficulty: BotDifficulty) => {
      writeSetup(slug, { difficulty });
      setSetup((previous) => ({ ...previous, difficulty }));
    },
    [slug],
  );

  const chooseRounds = useCallback(
    (rounds: number) => {
      writeSetup(slug, { rounds });
      setSetup((previous) => ({ ...previous, rounds }));
    },
    [slug],
  );

  const suggested = useMemo(() => suggestNextGame(slug), [slug]);

  /** The game the tournament is waiting on, if there is a tournament and it is waiting. */
  const waiting = currentGame(tournament);

  /**
   * Where the result screen points.
   *
   * The tournament's next game when there is one, so the link the overlay already draws
   * carries the tournament forward and neither it nor the match machine has to learn what a
   * tournament is. Otherwise the ordinary suggestion, so a result is never a dead end.
   */
  const nextGame =
    waiting === undefined || waiting === slug
      ? suggested
      : { slug: waiting, name: nameOf(waiting) };

  if (loadState === 'error') {
    return (
      <div className="db-panel" role="alert">
        <h2>This game is not playable yet</h2>
        <p>Its rules and controls are settled, but the build has not landed. Try another game.</p>
      </div>
    );
  }

  if (loadState === 'loading' || !manifest || !create) {
    return (
      <div className="db-panel">
        <p>Loading {slug.replace(/-/g, ' ')}…</p>
      </div>
    );
  }

  if (match.phase === 'idle' || mode === null) {
    const remembered = setup.mode;
    const offered = manifest.modes.filter((m): m is Mode => m === 'friend' || m === 'bot');
    // The remembered mode leads, so the button under the player's thumb is the one they
    // used last. Order, not preselection — nothing starts without a deliberate press.
    const ordered = [...offered].sort((a, b) => {
      if (a === remembered) return -1;
      if (b === remembered) return 1;
      return 0;
    });
    /** Whether the tournament is waiting on *this* game, which is the only leg it can start. */
    const legHere = isCurrentLeg(tournament, slug);
    /*
     * The track has to name both seats before a mode has been chosen, and `botSeats` is
     * undefined until a match starts — so who is in the far seat comes from the tournament,
     * which settled that once for all seven of its games.
     */
    const trackNames = seatNamesFor(
      botSeatsFor(tournament.opponent, setup.difficulty),
      chosenNames,
    );
    return (
      <div className="db-panel">
        <h2>{manifest.name}</h2>
        {tournament.phase === 'idle' ? null : (
          <TournamentTrack
            state={tournament}
            names={trackNames}
            onLeave={leaveTournament}
            {...(legHere
              ? {
                  onPlay: () => {
                    start(tournament.opponent);
                  },
                }
              : {})}
            {...(legHere || waiting === undefined ? {} : { href: `/play/${waiting}/` })}
          />
        )}
        {/* The ordinary lobby, and it stands down only on the game the tournament is
            waiting on: a tournament running elsewhere is no reason to stop somebody
            playing the game they have actually opened. */}
        {legHere ? null : (
          <>
            {/* Above the buttons, because these settle what the button is about to start —
                and the buttons stay last, nearest the thumb that presses them. The tier is
                offered only where the manifest has a bot to play, which today is every
                playable game: even the solo puzzles declare `friend` and `bot` as well,
                because a solo-only manifest is a game page nobody can start. */}
            <MatchOptions
              showDifficulty={offered.includes('bot')}
              difficulty={setup.difficulty}
              onDifficulty={chooseDifficulty}
              rounds={setup.rounds}
              onRounds={chooseRounds}
            />
            {/* The game's own options (#1751), rendered generically from its manifest and
                persisted per game. A game that declares none shows nothing here. */}
            <GameOptionsPanel slug={slug} options={manifest.options ?? []} />
            <div className={styles.modes}>
              {ordered.map((offer, index) => (
                <button
                  key={offer}
                  type="button"
                  className={index === 0 ? styles.primary : styles.secondary}
                  onClick={() => {
                    start(offer);
                  }}
                >
                  {offer === 'friend' ? 'Play together here' : `Play against ${SEAT_CHARACTERS.p2}`}
                </button>
              ))}
            </div>
            {/* The tournament's way in (#156), and the two entry buttons are the reference
                app's two: player against player, and player against the bot. They are here
                rather than in a bar on every page because a control on every page is shell
                weight on every page, and this feature is priced against the budget of the
                route it runs on — `docs/tournament.md` sets the whole argument out.

                Offered while one is finished as well as while there is none, because that
                is the screen a pair are on when they decide to go again. It is withheld
                only while one is actually running, and the machine refuses a `start` there
                anyway — this is the same rule, not a second copy of it. */}
            {tournament.phase === 'playing' ? null : (
              <>
                <p className={styles.tournamentLede}>
                  Or play a tournament: {TOURNAMENT_LENGTH} games drawn at random, starting with
                  this one. First to {legsToWin(TOURNAMENT_LENGTH)} takes it.
                </p>
                {/*
                  `ordered`, not a hardcoded pair. These two buttons used to be written out as
                  `['friend', 'bot'] as const`, ignoring `manifest.modes` entirely — so a game
                  that declared only `friend` would still have offered "Tournament against Pip".
                  Nothing is dead today because every one of the 108 games declares `bot`, which
                  is exactly why it would have stayed unnoticed until the first one did not.
                  It reads from the same list the start buttons above it do, so the two can
                  never disagree about what this game can be played as.
                */}
                <div className={styles.modes}>
                  {ordered.map((against) => (
                    <button
                      key={against}
                      type="button"
                      className={styles.secondary}
                      onClick={() => {
                        beginTournament(against);
                      }}
                    >
                      {against === 'friend'
                        ? 'Tournament together'
                        : `Tournament against ${SEAT_CHARACTERS.p2}`}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <Controls manifest={manifest} />
      </div>
    );
  }

  /**
   * What the two seats are called this match.
   *
   * Derived from the same `botSeats` map the game host is handed, so the scoreboard, the
   * result screen and the simulation cannot disagree about who is a bot. The shell used to
   * write a *partial* override here — seat two only — and leave seat one to whatever
   * fallback each component happened to carry, which is how the HUD came to read
   * "Pip vs Player two" (#2513).
   *
   * A name the pair chose for themselves replaces the seat's own, and `seatNamesFor` still
   * marks the seat if a bot is in it — so naming the far seat and then playing the bot
   * shows the bot marked rather than the player's name on it.
   */
  const seatNames = seatNamesFor(botSeats, chosenNames);

  /**
   * The record the result screen shows: what the store held when this match began, plus
   * the match itself once the machine has settled it.
   *
   * Computed here rather than read back after the write, so the first paint of the result
   * panel already carries the final numbers — see `recordBefore` above.
   */
  const record =
    match.phase === 'match-over' && match.matchOutcome !== null
      ? addOutcome(recordBefore, match.matchOutcome)
      : recordBefore;

  const hudProps = {
    state: match,
    rounds: rules.rounds ?? 1,
    activeSeat,
    seatNames,
    botSeats,
    ...(clockView ? { clock: clockView.text, clockWarning: clockView.warning } : {}),
  };

  /** Whether the match is live, which is when the exit control and the pull-to-refresh guard apply. */
  const matchLive =
    match.phase === 'countdown' || match.phase === 'playing' || match.phase === 'paused';

  return (
    <div
      className={styles.surface}
      // The physical gameplay target (#1889), published as a custom property the play
      // controls read. Computed from the device's pixel ratio in the presentation layer, so
      // a control jabbed at across a table holds its size in millimetres rather than in a
      // pixel count that a dense screen shrinks. Falls back to the shell target where a
      // control does not opt in.
      style={{ ['--db-gameplay-target' as string]: `${String(gameplayTarget)}px` }}
    >
      {/* The tournament's standing, on the one screen during a leg where it is what the
          pair are talking about: the moment a game ends. It is deliberately not up while
          the board is live — the match HUD is the score that matters then, and a phone two
          people share has no height to spare for a second one. */}
      {tournament.phase === 'idle' || match.phase !== 'match-over' ? null : (
        <TournamentTrack state={tournament} names={seatNames} onLeave={leaveTournament} />
      )}

      {/* Two people sit on opposite sides of one device, so the scoreboard faces both
          ways. The far copy is turned to face the player at the top of the screen. */}
      <MatchHud {...hudProps} flipped />

      <div className={styles.boardArea}>
        <div className={styles.board}>
          {/* A crash inside the game surfaces the recovery screen rather than a frozen board
              or a white screen (#151). The boundary catches a throw in React's own render;
              the host catches a throw inside the fixed loop and hands it back as
              `externalError`, so both land on the same Restart / Quit screen. */}
          <GameErrorBoundary externalError={gameError} onRestart={restart} onQuit={quit}>
            <GameHost
              manifest={manifest}
              createGame={create}
              seed={seed}
              phase={match.phase}
              presentation="shared-screen"
              localSeat="p1"
              openingSeat={match.openingSeat}
              {...(botSeats ? { botDifficulty: botSeats } : {})}
              onTick={handleTick}
              onScore={handleScore}
              onActiveSeat={handleActiveSeat}
              onSeatInput={handleSeatInput}
              onRequestPause={handlePauseRequest}
              onError={handleGameError}
              recordTrace={recording}
              // Wrapped, not passed. React treats a function handed to a state setter as an
              // *updater* and calls it with the previous state — so `setGetTrace(get)` invoked
              // the getter and stored the string it returned, and the panel then tried to call
              // a string. The trace stayed empty and nothing threw where anyone would see it.
              onTraceReady={(get) => {
                setGetTrace(() => get);
              }}
            />
          </GameErrorBoundary>
          <TracePanel getTrace={recording ? getTrace : null} />
          {/* The persistent edge-anchored exit and its forfeit confirmation (#144). Up
              whenever the match is live, so quitting mid-play is always one deliberate step
              away and never one accidental tap. */}
          {matchLive ? (
            <ExitControl
              open={exitOpen}
              onOpen={() => {
                setExitOpen(true);
              }}
              onCancel={() => {
                setExitOpen(false);
              }}
              onQuit={quit}
            />
          ) : null}
          {/* Which half belongs to whom, on this device's first go at this game (#137). Only
              while the board is live: before the countdown there is nothing to play, and after
              the match the result screen is what the pair are reading. */}
          {hintsDue && matchLive ? <ControlHints names={seatNames} used={seatUsed} /> : null}
          {/* The pass-and-play hand-off blackout (#134), only for a game that opted in and
              only while a hand-off is in progress. It sits above the board so no frame of the
              previous seat's state shows through. */}
          {handoffTo !== null ? (
            <HandoffOverlay
              toSeat={handoffTo}
              toName={seatNames[handoffTo]}
              onContinue={continueHandoff}
            />
          ) : null}
          <MatchOverlay
            state={match}
            manifest={manifest}
            rounds={rules.rounds ?? 1}
            seatNames={seatNames}
            record={record}
            nextGame={nextGame}
            presentation="shared-screen"
            onResume={() => {
              send({ kind: 'resume' });
            }}
            onQuit={quit}
            onNextRound={() => {
              send({ kind: 'next-round' });
            }}
            onRematch={rematch}
            onRestart={restart}
          />
        </div>
      </div>

      <MatchHud {...hudProps} onPause={handlePauseRequest} />
    </div>
  );
}

/**
 * What a game is called, or its slug turned back into words when the build has no name for
 * it. One function, because the suggestion and the tournament's next leg both need it and a
 * second copy is a second place for a link to be labelled differently.
 */
function nameOf(slug: string): string {
  return GAME_NAMES[slug] ?? slug.replace(/-/g, ' ');
}

/**
 * Something to play next, so a result screen is never a dead end. Deterministic — the
 * slug picks it — because a suggestion that changes on every render reads as a glitch.
 */
function suggestNextGame(slug: string): { slug: string; name: string } | undefined {
  const others = PLAYABLE.filter((candidate) => candidate !== slug);
  const first = others[0];
  if (first === undefined) return undefined;
  let hash = 0;
  for (let i = 0; i < slug.length; i += 1) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  const pick = others[hash % others.length] ?? first;
  return { slug: pick, name: nameOf(pick) };
}
