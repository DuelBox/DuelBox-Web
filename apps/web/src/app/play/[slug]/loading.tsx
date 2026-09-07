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
 * reached it. That press is this file's reason to exist. A player on a slow connection
 * sees it on any play route; a player on a fast one who followed a link the router had
 * already prefetched sees nothing, which is correct.
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
 * "Moves nothing" is measured rather than reasoned about. #93's one acceptance criterion is
 * that cumulative layout shift stays under 0.1 across the swap, and it went unexecuted while
 * this paragraph argued for it: `e2e/page-transition.spec.ts` now presses "Surprise me" with
 * the route un-prefetched and adds up every layout-shift entry the swap produces, counting
 * even the ones the published metric excuses for following a press.
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
 * already has rather than by one that arrives with the page it is standing in for.
 *
 * `db-fill` is load-bearing in that same way. The shell keys the entire play-route layout
 * off that class: `:has(.db-fill)` in `globals.css` fixes the shell's height and stands the
 * footer down. A fallback without it would raise a footer for as long as it was up and drop
 * it again when the page arrived.
 *
 * A server component, and it has to stay one. The shell budget has about two kilobytes of
 * headroom, and a fallback that shipped a component would bill every visitor for the
 * moment before somebody else's game.
 */
export default function PlayLoading() {
  return (
    <div className="db-wrap db-fill">
      {/* The play route promises a heading in every phase — see the page beside this file,
          which renders one for exactly this reason. This is a phase. It cannot name the
          game: a loading file is handed no params, by design. */}
      <h1 className="db-visually-hidden">Loading the game</h1>
      <div className="db-panel">
        <p role="status">Loading…</p>
      </div>
    </div>
  );
}
