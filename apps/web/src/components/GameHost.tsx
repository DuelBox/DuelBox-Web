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
} from '@duelbox/engine';
import type { Game, GameContext, GameManifest } from '@duelbox/game-sdk';
import styles from './GameHost.module.css';

/**
 * Runs one game on a canvas.
 *
 * Everything wall-clock, device and DOM lives here so games never touch any of it: the
 * host owns the canvas, the resize observer, the pointer and key listeners, the fixed
 * loop and the renderer. A game receives a fixed delta and a normalised input state, and
 * draws in logical units.
 */

export interface GameHostProps {
  manifest: GameManifest;
  createGame: () => Game;
  seed: number;
  /** Which seat this device plays. Only meaningful in single-seat presentation. */
  localSeat?: 'p1' | 'p2';
  presentation?: 'shared-screen' | 'single-seat';
  botDifficulty?: Partial<Record<'p1' | 'p2', 'easy' | 'normal' | 'hard'>>;
  onScore?: (p1: number, p2: number, winner: 'p1' | 'p2' | 'draw' | null) => void;
}

export function GameHost({
  manifest,
  createGame,
  seed,
  localSeat = 'p1',
  presentation = 'shared-screen',
  botDifficulty,
  onScore,
}: GameHostProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The latest onScore without re-running the effect; re-creating the loop on every
  // parent render would restart the match.
  const onScoreRef = useRef(onScore);
  onScoreRef.current = onScore;

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
      el.setPointerCapture(event.pointerId);
      const point = toLogical(event);
      input.pointerDown(event.pointerId, point.x, point.y);
    }
    function onPointerMove(event: PointerEvent): void {
      const point = toLogical(event);
      input.pointerMove(event.pointerId, point.x, point.y);
    }
    function onPointerUp(event: PointerEvent): void {
      input.pointerUp(event.pointerId);
    }
    function onKeyDown(event: KeyboardEvent): void {
      // Escape belongs to the shell's pause menu, so it is never swallowed here.
      if (event.code === 'Escape') return;
      input.keyDown(event.code);
      if (SCROLL_KEYS.has(event.code)) event.preventDefault();
    }
    function onKeyUp(event: KeyboardEvent): void {
      input.keyUp(event.code);
    }
    function onBlur(): void {
      // Otherwise a player returns to a stuck direction.
      input.clear();
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    globalThis.addEventListener('keydown', onKeyDown);
    globalThis.addEventListener('keyup', onKeyUp);
    globalThis.addEventListener('blur', onBlur);

    let lastP1 = -1;
    let lastP2 = -1;

    const loop = new FixedLoop({
      update(dt) {
        game.update(dt, inputView.sync(input.beginStep(dt)));
        const score = game.getScore();
        if (score.p1 !== lastP1 || score.p2 !== lastP2) {
          lastP1 = score.p1;
          lastP2 = score.p2;
          onScoreRef.current?.(score.p1, score.p2, score.winner);
        }
      },
      render(alpha) {
        renderer.beginFrame();
        game.render(renderer, alpha);
        renderer.endFrame();
      },
    });

    const runner = new RunLoop(loop, browserClock());
    runner.start();

    function onVisibility(): void {
      // Tab-switching must not fast-forward the accumulator, and a paused match must not
      // keep burning battery.
      if (document.hidden) {
        runner.stop();
        game.onPause();
      } else {
        game.onResume();
        runner.start();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      runner.stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      globalThis.removeEventListener('keydown', onKeyDown);
      globalThis.removeEventListener('keyup', onKeyUp);
      globalThis.removeEventListener('blur', onBlur);
      game.destroy();
    };
  }, [manifest, createGame, seed, localSeat, presentation, botDifficulty]);

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
