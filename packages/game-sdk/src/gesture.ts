import type { SeatInput } from './contract.js';

/**
 * Reading the end of a gesture.
 *
 * A gesture can end two ways and they mean opposite things. The player lets go, which
 * *commits* — that is {@link SeatInput.actionReleased}. Or it is taken away, which
 * *abandons* — a `pointercancel` from a system edge swipe, palm rejection or an incoming
 * call, or the shell pausing and calling `InputManager.clear()`. The engine tells the two
 * apart (#2480) and suppresses the release on a cancel, so no game commits a shot at the
 * moment its gesture is disowned.
 *
 * What the engine cannot do is drop the charge a game was *carrying*, and that is what
 * this module is for.
 */

/**
 * True on the one step a gesture was abandoned: the action ended, and it ended by being
 * taken away rather than let go.
 *
 * **This is the mirror of `actionReleased`, and the second half of the condition is why it
 * is a function rather than a bare field read.** The engine's line is
 * `actionReleased = !cancelled && !held && (was || latched)`; this is the same shape with
 * the cancellation the other way round. `pointerCancelled` on its own is *not* enough,
 * because the engine deliberately raises it for **any** cancelled pointer and not only the
 * last one down — it cannot know which finger was driving the aim. So when a second finger
 * is still on the glass, or the action key is still down, `actionHeld` stays true and the
 * gesture has not ended at all. Dropping the charge there destroys a draw that is still
 * live, which is a different bug in the same place.
 *
 * A game holding a charge across frames — a drawn bow, a wound sling, a filling power
 * gauge, a half-chosen run — reads this and discards it. Sixteen games hand-rolled the
 * predicate for issue #2501 and the `!actionHeld` half is the part that gets forgotten,
 * which is exactly why it lives here once instead.
 *
 * **Discard the charge, not the aim.** The charge is the only thing that commits, so
 * clearing it is enough to make an abandoned gesture commit nothing. The aim is a standing
 * setting these games already carry from one attempt to the next, it commits nothing on its
 * own once the charge is gone, and moving a player's reticle because their phone rang
 * punishes them twice for an interruption they did not cause.
 *
 * Reads two booleans and allocates nothing, so it is safe inside `update()` (rule 5).
 */
export function actionAbandoned(seat: SeatInput): boolean {
  return seat.pointerCancelled && !seat.actionHeld;
}
