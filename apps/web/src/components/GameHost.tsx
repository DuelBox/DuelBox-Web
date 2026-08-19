'use client';

import { useEffect, useRef } from 'react';
import {
  Canvas2DRenderer,
  FixedLoop,
  InputManager,
  InputView,
  Rng,
  RunLoop,
  browserClock,
  clampDevicePixelRatio,
  fitViewport,
  viewportToLogical,
  vec2,
  type SafeAreaInsets,
  type SeatId,
} from '@duelbox/engine';
import {
  isSimulating,
  type Game,
  type GameContext,
  type GameManifest,
  type MatchPhase,
} from '@duelbox/game-sdk';
import styles from './GameHost.module.css';

/**
 * Runs one game on a canvas.
 *
 * Everything wall-clock, device and DOM lives here so games never touch any of it: the
 * host owns the canvas, the resize observer, the pointer and key listeners, the fixed
 * loop and the renderer. A game receives a fixed delta and a normalised input state, and
 * draws in logical units.
 *
 * The host does not decide when a match is running — it is told, through `phase`. That
 * keeps one answer to "is the simulation moving" (the match machine's) rather than two
 * that can disagree.
 */

export interface GameHostProps {
  manifest: GameManifest;
  createGame: () => Game;
  seed: number;
  /** The match machine's current phase. The host steps the game only while playing. */
  phase: MatchPhase;
  /** Which seat this device plays. Only meaningful in single-seat presentation. */
  localSeat?: SeatId;
  presentation?: 'shared-screen' | 'single-seat';
  botDifficulty?: Partial<Record<SeatId, 'easy' | 'normal' | 'hard'>>;
  /**
   * One fixed simulation step elapsed. Fires in every running phase, including the
   * countdown, so the shell's clock advances on the same timestep as the physics rather
   * than on a separate wall-clock timer that two devices would disagree about.
   */
  onTick?: (fixedDeltaSeconds: number) => void;
  onScore?: (p1: number, p2: number, winner: SeatId | 'draw' | null) => void;
  onActiveSeat?: (seat: SeatId | null) => void;
  /** The window went away. The shell decides what that means; the host never pauses itself. */
  onRequestPause?: () => void;
}

export function GameHost({
  manifest,
  createGame,
  seed,
  phase,
  localSeat = 'p1',
  presentation = 'shared-screen',
  botDifficulty,
  onTick,
  onScore,
  onActiveSeat,
  onRequestPause,
}: GameHostProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runnerRef = useRef<RunLoop | null>(null);
  const loopRef = useRef<FixedLoop | null>(null);
  const gameRef = useRef<Game | null>(null);

  // Callbacks and phase are read through refs so changing any of them never re-runs the
  // setup effect: doing so would tear down the canvas and restart the match mid-play.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const onScoreRef = useRef(onScore);
  onScoreRef.current = onScore;
  const onActiveSeatRef = useRef(onActiveSeat);
  onActiveSeatRef.current = onActiveSeat;
  const onRequestPauseRef = useRef(onRequestPause);
  onRequestPauseRef.current = onRequestPause;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const logical = manifest.logical;
    const renderer = new Canvas2DRenderer(context, logical);
    const inputView = new InputView();
    const input = new InputManager(logical, {
      split: manifest.zoneSplit === 'vertical' ? 'vertical' : 'horizontal',
      bottomSeat: localSeat,
    });

    const game = createGame();
    gameRef.current = game;
    const gameContext: GameContext = {
      manifest,
      rng: new Rng(seed),
      presentation,
      localSeat,
      botDifficulty: (seat) => botDifficulty?.[seat] ?? null,
    };
    game.init(gameContext);

    let view = fitViewport(logical, canvas.clientWidth, canvas.clientHeight, readInsets());
    const scratch = vec2();

    // The element is passed in rather than closed over: TypeScript will not carry the
    // null-narrowing of a ref into a hoisted function declaration.
    function resize(el: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
      const dpr = clampDevicePixelRatio(globalThis.devicePixelRatio);
      const cssWidth = el.clientWidth;
      const cssHeight = el.clientHeight;
      el.width = Math.round(cssWidth * dpr);
      el.height = Math.round(cssHeight * dpr);
      // Draw in CSS pixels; the backing store carries the device ratio.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      view = fitViewport(logical, cssWidth, cssHeight, readInsets());
      renderer.setViewport(view);
    }
    resize(canvas, context);

    const observer = new ResizeObserver(() => {
      resize(canvas, context);
    });
    observer.observe(canvas);

    const el = canvas;

    /** Screen coordinates reach the game in logical units, never device pixels. */
    function toLogical(event: PointerEvent): { x: number; y: number } {
      const rect = el.getBoundingClientRect();
      viewportToLogical(scratch, event.clientX - rect.left, event.clientY - rect.top, view);
      return scratch;
    }

    function onPointerDown(event: PointerEvent): void {
      // A touch that lands while the board is frozen must not be queued up and fired the
      // instant play resumes.
      if (!isSimulating(phaseRef.current)) return;
      el.setPointerCapture(event.pointerId);
      const point = toLogical(event);
      input.pointerDown(event.pointerId, point.x, point.y);
    }
    function onPointerMove(event: PointerEvent): void {
      if (!isSimulating(phaseRef.current)) return;
      const point = toLogical(event);
      input.pointerMove(event.pointerId, point.x, point.y);
    }
    function onPointerUp(event: PointerEvent): void {
      input.pointerUp(event.pointerId);
    }
    function onKeyDown(event: KeyboardEvent): void {
      // Escape belongs to the shell's pause menu, so it is never swallowed here.
      if (event.code === 'Escape') return;
      // A held modifier means the player is talking to the browser or the OS, not to
      // the game: Cmd+W closes the tab, Ctrl+R reloads, Alt+Tab switches window. Two
      // reasons to let those through untouched. Swallowing them traps the player in the
      // page, and on macOS a letter pressed with Command held never delivers its keyup
      // at all — so treating it as gameplay leaves that key stuck down for the rest of
      // the match.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!isSimulating(phaseRef.current)) return;
      input.keyDown(event.code);
      if (SCROLL_KEYS.has(event.code)) event.preventDefault();
    }
    function onKeyUp(event: KeyboardEvent): void {
      input.keyUp(event.code);
    }
    function onModifierRelease(event: KeyboardEvent): void {
      // Safety net for the keyup that never arrives. If a modifier is released and the
      // player was mid-chord, anything still held is cleared rather than left down.
      if (event.key === 'Meta' || event.key === 'Control' || event.key === 'Alt') input.clear();
    }
    function onContextMenu(event: Event): void {
      // A long press is a legitimate game input; on touch it otherwise raises the
      // callout menu and the press is lost. CSS cannot suppress this on Android.
      event.preventDefault();
    }
    function onBlur(): void {
      // Otherwise a player returns to a stuck direction.
      input.clear();
      onRequestPauseRef.current?.();
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('contextmenu', onContextMenu);
    globalThis.addEventListener('keydown', onKeyDown);
    globalThis.addEventListener('keyup', onKeyUp);
    globalThis.addEventListener('keyup', onModifierRelease);
    globalThis.addEventListener('blur', onBlur);

    let lastP1 = -1;
    let lastP2 = -1;
    let lastSeat: SeatId | null | undefined;

    const loop = new FixedLoop({
      update(dt) {
        // The shell's clock runs in every live phase; the simulation only while playing.
        onTickRef.current?.(dt);
        if (!isSimulating(phaseRef.current)) {
          // Input still has to be drained, or a key held through a countdown arrives as
          // a fresh press on the first simulated step.
          input.beginStep(dt);
          return;
        }
        game.update(dt, inputView.sync(input.beginStep(dt)));
        const score = game.getScore();
        if (score.p1 !== lastP1 || score.p2 !== lastP2) {
          lastP1 = score.p1;
          lastP2 = score.p2;
          onScoreRef.current?.(score.p1, score.p2, score.winner);
        }
        const seat = game.getActiveSeat?.() ?? null;
        if (seat !== lastSeat) {
          lastSeat = seat;
          onActiveSeatRef.current?.(seat);
        }
      },
      render(alpha) {
        renderer.beginFrame();
        game.render(renderer, alpha);
        renderer.endFrame();
      },
    });
    loopRef.current = loop;

    const runner = new RunLoop(loop, browserClock());
    runnerRef.current = runner;

    // A host rebuilt mid-match must come back running if the phase says it should be.
    // The phase effect below only fires when the phase *changes*, so a host recreated
    // while the phase stayed the same would be left stopped for good — the match would
    // hang wherever it was, with no error and nothing in the console.
    if (phaseRef.current === 'countdown' || phaseRef.current === 'playing') runner.start();

    function onVisibility(): void {
      // Tab-switching must not fast-forward the accumulator, and a hidden match must not
      // keep burning battery. The shell is told; it owns the decision.
      if (document.hidden) onRequestPauseRef.current?.();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      runner.stop();
      runnerRef.current = null;
      loopRef.current = null;
      gameRef.current = null;
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('contextmenu', onContextMenu);
      globalThis.removeEventListener('keydown', onKeyDown);
      globalThis.removeEventListener('keyup', onKeyUp);
      globalThis.removeEventListener('keyup', onModifierRelease);
      globalThis.removeEventListener('blur', onBlur);
      game.destroy();
    };
  }, [manifest, createGame, seed, localSeat, presentation, botDifficulty]);

  // Start and stop with the phase. Separate from setup so pausing never rebuilds the game.
  useEffect(() => {
    const runner = runnerRef.current;
    const game = gameRef.current;
    if (!runner || !game) return;
    const live = phase === 'countdown' || phase === 'playing';
    if (live) {
      // The time spent paused is not owed to the simulation; without this the first
      // frame back would try to catch it all up at once.
      loopRef.current?.reset();
      game.onResume();
      runner.start();
    } else {
      runner.stop();
      game.onPause();
    }
  }, [phase]);

  return <canvas ref={canvasRef} className={styles.canvas} aria-label={`${manifest.name} board`} />;
}

/** Arrow keys and space scroll the page by default, which ruins a game. */
const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'PageUp',
  'PageDown',
]);

/** Reads the safe-area insets the layout exposes, so nothing sits under a notch. */
function readInsets(): SafeAreaInsets {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string): number => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : 0;
  };
  return {
    top: read('--db-safe-top'),
    right: read('--db-safe-right'),
    bottom: read('--db-safe-bottom'),
    left: read('--db-safe-left'),
  };
}
