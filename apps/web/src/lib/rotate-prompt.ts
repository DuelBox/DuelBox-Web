import type { GameManifest } from '@duelbox/game-sdk';

/**
 * When to show the rotate-your-device prompt (#136).
 *
 * Some layouts genuinely need one orientation — a wide air-hockey table squashed into a
 * portrait phone is worse than an honest "turn the device". The requirement is *already*
 * declared in the manifest: `orientation` is `'portrait' | 'landscape' | 'any'`, validated at
 * build time. So this is only the decision of whether, right now, to prompt — and the answer
 * is "the game asks for an orientation the device is not currently in".
 *
 * The prompt this drives must be **non-blocking and never pause a live match** — that is the
 * component's contract, and this predicate deliberately knows nothing about match phase so it
 * cannot be the thing that couples them. A game declaring `'any'` never prompts, whatever the
 * device is doing.
 */

/** `'landscape'` when the viewport is wider than it is tall, else `'portrait'`. A square is
    portrait, arbitrarily but consistently, so the boundary is defined rather than flapping. */
export function orientationOf(width: number, height: number): 'portrait' | 'landscape' {
  return width > height ? 'landscape' : 'portrait';
}

/**
 * Whether to show the rotate prompt for a game whose manifest declares `declared`, on a
 * viewport of `width` × `height`.
 *
 * True only when the game declares a specific orientation and the device is in the other one.
 * `'any'` is always false — the overwhelming majority of the catalogue, which must never see
 * the prompt.
 */
export function shouldPromptRotate(
  declared: GameManifest['orientation'],
  width: number,
  height: number,
): boolean {
  if (declared === 'any') return false;
  return orientationOf(width, height) !== declared;
}
