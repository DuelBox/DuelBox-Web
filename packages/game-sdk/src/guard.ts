/**
 * The one place a call into game code is allowed to throw.
 *
 * A game's `update()` and `render()` run inside the host's fixed loop, sixty times a second.
 * An unguarded throw there does not politely stop — it escapes the loop's frame callback, and
 * what the player sees is a frozen board or a white screen with a live pause button behind it,
 * exactly the failure mode a survival match's missing end condition produced before (HANDOFF,
 * Road Dodge). One game throwing must never take the shell down or lose a tournament in
 * progress (#151).
 *
 * So every call the host makes into a game goes through here. It runs the call, and on a throw
 * it swallows the error, hands it to `onError` once, and returns false — the signal the host
 * uses to stop the loop and raise the recovery UI rather than step the broken game again. It is
 * the loop-side half of #151; a React error boundary around the host is the render-side half,
 * for a throw that happens outside these callbacks (in React's own commit).
 *
 * It allocates nothing on the success path — no closure, no wrapper object — because it is on
 * the hot path (rule 5): a `try`/`catch` around a direct call is free until the `catch` runs.
 */
export function guard(fn: () => void, onError: (error: unknown) => void): boolean {
  try {
    fn();
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}

/**
 * An error reduced to a message, for the recovery UI and error tracking.
 *
 * A thrown value is not always an `Error` — a game can `throw 'nope'` or throw an object — so
 * this never assumes `.message` is there. What it returns is safe to put on screen and to send
 * to tracking: a string, always, and never the raw value a `toString` might turn into
 * `[object Object]` or worse.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return 'The game hit an unexpected error.';
}
