'use client';

import { Component, type ReactNode } from 'react';
import { errorMessage } from '@duelbox/game-sdk';
import { T } from '@/lib/i18n/T';
import styles from './GameErrorBoundary.module.css';

/**
 * The recovery screen a crashing game lands on instead of a frozen board (#151).
 *
 * One game throwing must not take the shell down or lose a tournament in progress. There are
 * two ways a game throws, and this handles both:
 *
 * - **During React's own render or commit** — caught by this boundary the ordinary React way,
 *   through `getDerivedStateFromError`.
 * - **Inside the fixed loop's `update()` or `render()`** — which a React boundary can *not*
 *   catch, because it happens in a `requestAnimationFrame` callback outside React. The host
 *   guards those calls itself (`guard` in the SDK), stops the loop, and reports the error up;
 *   the parent hands it back here as `externalError`, so the same recovery UI answers both.
 *
 * Either way the loop is already stopped by the time this renders — a boundary that kept
 * stepping a broken game would just crash again on the next frame — and the player is offered
 * Restart and Quit rather than a white screen.
 *
 * The copy goes through `<T>` rather than `t()` because this is a class component and there is
 * no hook to read the catalogue with (#220). The message line takes whatever the throw carried,
 * so its id is a variable: the three sentences this shell can actually put there — the SDK's
 * own fallback and the two errors the host raises — are registered in `lib/i18n/sources.ts`,
 * and a game's own thrown message stays in whatever language the game wrote it in.
 */
export interface GameErrorBoundaryProps {
  children: ReactNode;
  /** An error the host caught in the loop, surfaced here so both paths share one screen. */
  externalError?: unknown;
  /** Clear the error and start the match over. */
  onRestart: () => void;
  /** Leave the match and return to the catalog, tournament progress intact. */
  onQuit: () => void;
}

interface GameErrorBoundaryState {
  caught: unknown;
}

export class GameErrorBoundary extends Component<GameErrorBoundaryProps, GameErrorBoundaryState> {
  constructor(props: GameErrorBoundaryProps) {
    super(props);
    this.state = { caught: null };
  }

  static getDerivedStateFromError(error: unknown): GameErrorBoundaryState {
    return { caught: error };
  }

  private handleRestart = (): void => {
    // Clear our own caught error before restarting, or the boundary would keep showing the
    // recovery screen over a freshly restarted, healthy match.
    this.setState({ caught: null });
    this.props.onRestart();
  };

  override render(): ReactNode {
    const error = this.state.caught ?? this.props.externalError ?? null;
    if (error === null) return this.props.children;

    return (
      <div className={styles.recovery} role="alert">
        <div className={styles.panel}>
          <h2 className={styles.heading}>
            <T id="This game hit a snag" />
          </h2>
          <p className={styles.detail}>
            <T id={errorMessage(error)} />
          </p>
          <p className={styles.reassure}>
            <T id="The match was stopped safely. You can start it over or head back." />
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={this.handleRestart} autoFocus>
              <T id="Restart" />
            </button>
            <button type="button" className={styles.secondary} onClick={this.props.onQuit}>
              <T id="Quit match" />
            </button>
          </div>
        </div>
      </div>
    );
  }
}
