import { T } from '@/lib/i18n/T';

/**
 * What the play route shows while its own payload and code are still on their way (#93).
 *
 * ## Why this route, and why only this one
 *
 * The site is a static export, so every route's HTML is written at build time and a
 * loading state is never seen on a first load. It is only ever seen during a *client*
 * navigation, in the window between the press and the next route's payload arriving — and
 * on the content routes that window barely exists: their payload is markup the router has
 * usually prefetched before the finger lands, and their client code is already in the
 * shell. A skeleton there would be markup nobody sees and everybody maintains.
 *
 * The play route is the exception on both counts. It is the only route in the product with
 * client code of its own behind it — the on-demand bundle the size budget prices
 * separately, which nobody downloads by arriving at the site — and it is the route the
 * router regularly cannot have prefetched. `QuickPlay` is in the site header, so it is on
 * every page, and it decides which game to open at the moment it is pressed: on all but
 * the catalogue, nothing on the page linked to where it goes, and on the catalogue the
 * card that did is usually far below the fold, where a viewport-driven prefetch never
 * reached it. That press is this file's reason to exist.
 *
 * ## How often a player sees it: measured, and the answer is not "on a slow connection"
 *
 * This file used to end the paragraph above by saying a player on a slow connection sees
 * this on any play route, and a player on a fast one who followed a prefetched link sees
 * nothing. The second half is right. The first half was never measured and #2539 measured
 * it: **in the exported build, no amount of slowness produces it.** Thirty-five navigations
 * across two builds with different build ids and webpack runtime hashes, in Chromium and in
 * real WebKit, from three starting routes, with the payload held, the chunks held, both held
 * and neither — and this fallback painted in none of them. Holding *only* the play route's
 * own page chunk, for four seconds, does not produce it either: the address does not change,
 * the previous page stays on screen for the whole four seconds, and then the lobby appears.
 *
 * The reason is an ordering rather than a speed. The router does not commit the arriving
 * route until that route's client modules have loaded — commit tracks the last of them to
 * the millisecond, at 800ms of hold and at 4000ms alike — so by the moment the new tree is
 * committed there is nothing inside this boundary left to suspend on, and no moment for a
 * fallback to fill. Nothing is missing from the wire either: `/play/<slug>/index.txt` carries
 * this markup as a row of its own, and the segment's `loading-*.js` — 147 bytes of webpack
 * registration and no code — was not requested in any navigation whose requests were logged.
 *
 * It is kept rather than deleted, for two reasons and neither of them is inertia. #2539
 * records builds on which it *did* paint — six failures from one build, three passes from
 * the next — and that half was not reproduced here, so the honest reading is that the
 * router's commit ordering is not stable across builds, not that this can never be reached.
 * And a `loading.tsx` is what makes the segment a Suspense boundary at all: deleting it does
 * not make the wait shorter, it only decides that a play route which does suspend shows
 * nothing while it waits. Against that, the price of keeping it is 57 gzipped bytes a route,
 * counted further down.
 *
 * What it is not is covered. `loading-states.test.ts` holds this fallback's shape and
 * `e2e/page-transition.spec.ts` holds the arrival it belongs to, and neither of them can
 * watch this markup do its job, because on the evidence above it never gets to. If a build
 * ever shows it, that spec's docstring is where the news goes.
 *
 * ## Why it is a panel and not a wall of grey boxes
 *
 * What replaces this is not the lobby. The game's own chunk is fetched by `PlaySurface`
 * after it mounts, so the next thing on screen is that component's own loading panel — one
 * centred line. Boxes shaped like the lobby would therefore be a layout shift with a
 * skeleton's manners: they would be replaced by something a different size before the real
 * content ever appeared. So this *is* the panel it becomes: `db-panel` is the one
 * definition of that geometry and `PlaySurface` draws its panels in the same class, so the
 * swap moves nothing.
 *
 * "Moves nothing" is measured rather than reasoned about, and the measurement corrected the
 * reason. `e2e/page-transition.spec.ts` presses "Surprise me" with the route un-prefetched
 * and reads the boxes of the header, the main landmark, the footer and this panel's own
 * corner on both sides of the swap. They are identical — but not because the two panels are
 * the same size. `PlaySurface`'s one-line panel is 119px tall and the lobby it becomes is
 * 576px, and nothing moves because the panel is anchored to the top of a shell whose height
 * `db-fill` has already fixed, so it grows downward into height that was reserved before
 * either of them drew. The shared `db-panel` class is what keeps the corner and the width
 * identical; `db-fill` is what makes the growth cost nothing.
 *
 * #93's own acceptance criterion — cumulative layout shift under 0.1 across the swap — is
 * summed there too, counting even the entries the published metric excuses for following a
 * press. It is kept as the criterion's own words and it is not the guard: it measures 0, and
 * the sabotage that breaks the paragraph above (dropping `db-fill` from the arriving page,
 * which moves the footer 154px) reads 0.0282, still under the published line. A threshold
 * nothing has been made to cross is not a check, which is why the boxes are asserted beside
 * it — and both were watched failing on a sabotaged build before either was believed.
 *
 * Only this route has one, and that is a decision rather than an omission. #93's actions name
 * a catalogue-grid skeleton too; it is declined for the reason above — its navigation is
 * prefetched markup with no chunk behind it — and `loading-states.test.ts` holds the list to
 * exactly one entry so that adding a second has to come with the argument.
 *
 * ## Why the class is global and not a CSS module
 *
 * It was a module import first — `PlaySurface.module.css`, on the reasoning that borrowing
 * the stylesheet is what keeps the two in step. It cost 363 gzipped bytes on the on-demand
 * budget, which is the thing this file was written not to do. A CSS module is a JavaScript
 * import, so Next emits a client chunk for any route segment that has one, and for a server
 * component that chunk is a map of class names to hashed class names and nothing else: no
 * behaviour, fetched during the very navigation this fallback exists to smooth. The
 * geometry moved to `globals.css` instead, where `db-fill` and the rest of the play route's
 * layout hooks already live for the neighbouring reason — the fallback needs them before
 * the route's own stylesheet has loaded.
 *
 * Worth stating plainly, because "costs nothing" was claimed here once and was not true: a
 * `loading.tsx` is not free even importing nothing. Next emits a chunk for the segment
 * either way, and with no imports left in it that chunk is an empty module plus webpack's
 * registration boilerplate — 132 gzipped bytes, measured, and the floor. What the move
 * bought is the 231 above it, and a fallback that is styled by a stylesheet every route
 * already has rather than by one that arrives with the page it is standing in for. #2539
 * adds one detail to that accounting: no navigation it measured ever requested that chunk,
 * so the floor is a byte on the build's ledger rather than on any player's. What a player
 * does pay for is this markup inside every play route's payload, fetched whether or not the
 * router ever renders it: 57 gzipped bytes a route, 6.1 KB over the 108, measured by
 * stripping the row out of each built payload and gzipping it again. That is the price of
 * keeping it, and it is small enough that the argument above wins.
 *
 * `db-fill` is load-bearing in that same way. The shell keys the entire play-route layout
 * off that class: `:has(.db-fill)` in `globals.css` fixes the shell's height and stands the
 * footer down. A fallback without it would raise a footer for as long as it was up and drop
 * it again when the page arrived.
 *
 * A server component, and it has to stay one. The shell budget has about two kilobytes of
 * headroom, and a fallback that shipped a component would bill every visitor for the
 * moment before somebody else's game.
 *
 * Its two lines of copy go through `<T>` for the reason the page beside it does, and at the
 * same price: this markup is in all 108 play payloads, so the wrapper is paid 108 times. It
 * was measured with the heading on the page rather than separately — the commit carries the
 * figure — and `speculatedBytes` clears its budget with it.
 */
export default function PlayLoading() {
  return (
    <div className="db-wrap db-fill">
      {/* The play route promises a heading in every phase — see the page beside this file,
          which renders one for exactly this reason. This is a phase. It cannot name the
          game: a loading file is handed no params, by design. */}
      <h1 className="db-visually-hidden">
        <T id="Loading the game" />
      </h1>
      <div className="db-panel">
        <p role="status">
          <T id="Loading…" />
        </p>
      </div>
    </div>
  );
}
