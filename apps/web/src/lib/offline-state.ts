/**
 * The decisions behind the offline shell, kept apart from the component that acts on them.
 *
 * `components/ServiceWorkerBridge.tsx` is the subscription — it registers the worker, listens
 * for an update and listens for the connection coming and going. None of that can be unit
 * tested here: `vitest.config.ts` runs in the `node` environment with no DOM at all, and its
 * `include` collects `*.test.ts` and not `*.test.tsx`, so a test file for the component would
 * not even be picked up by the suite. What this file holds is therefore the half of the
 * bridge that *is* checkable without a browser — the two URLs a registration is built from,
 * the attribute the rest of the site styles itself by, the conditions under which registering
 * has to be a silent no-op, and the words a person actually reads.
 *
 * It is the split `lib/theme.ts` already makes for the colour scheme: a pure function that is
 * the whole decision, a thin applier that puts it on `<html>` and does nothing where there is
 * no document, and a test that pins the decision rather than the plumbing. Following the same
 * shape was not tidiness — `data-net` and `data-theme` are read by the same stylesheet, set at
 * the same moment in the same kind of effect, and a reader who has understood one should not
 * have to learn a second arrangement to understand the other.
 */

/**
 * The part of the global object that decides whether registering is possible at all.
 *
 * Declared structurally rather than taken as `Window` so it can be called with a plain object
 * in the suite, and — the reason it is shaped this way rather than that — so the two
 * properties are typed as *possibly missing*. TypeScript's DOM library says
 * `navigator.serviceWorker` is always there, which is exactly the lie this guard exists to
 * survive: on an engine without support the property is `undefined`, and a check written
 * against the DOM types would be deleted by `@typescript-eslint/no-unnecessary-condition` as
 * a comparison that can never be false. Giving the caller a narrower type is what lets the
 * runtime question be asked in code the linter agrees is worth asking.
 */
export interface WorkerHost {
  readonly isSecureContext?: boolean | undefined;
  readonly navigator?: { readonly serviceWorker?: unknown } | undefined;
}

/**
 * Whether this browser can be asked to register a worker.
 *
 * Three ways of getting `false`, and all three are ordinary rather than exotic. The API is
 * missing on older iOS Safari and in every browser with the feature turned off. The context
 * is insecure whenever the page is served over plain HTTP from anything but localhost, which
 * is what a colleague previewing a build off a LAN address has. And with scripting off this
 * function is never reached at all, which is the third and needs no branch.
 *
 * A registration that cannot work must be a no-op and never a thrown error: this runs in the
 * root layout, on every page, and a bridge that throws would take the shell down with it on
 * precisely the devices least able to spare it.
 */
export function canRegisterWorker(host: WorkerHost): boolean {
  return host.isSecureContext === true && host.navigator?.serviceWorker != null;
}

/**
 * The URL the worker script is fetched from, base path included.
 *
 * `app/base-path.ts` names this caller by name, and the reason is worth restating where the
 * string is actually built: a GitHub Pages *project* page serves the site from `/<repo>/`, so
 * a hand-written `/sw.js` asks the origin for a file that is one directory up from anything
 * this deployment owns. It 404s, the registration rejects, and the only visible symptom is
 * that the site is exactly as it was before the worker existed — which is the failure mode
 * that gets shipped, because nothing looks broken.
 */
export function workerScriptUrl(basePath: string): string {
  return `${basePath}/sw.js`;
}

/**
 * The scope the worker is registered for: the site root, base path included.
 *
 * A worker may only control pages at or below the directory its script is served from, so
 * this and {@link workerScriptUrl} are two halves of one fact and the test holds them
 * together rather than checking each alone. Asking for a scope the script's location does not
 * permit is a rejected registration, not a narrower one.
 */
export function workerScope(basePath: string): string {
  return `${basePath}/`;
}

/**
 * The value `data-net` should take, or `null` to remove the attribute.
 *
 * The whole decision, in one place, taking the flag the browser actually reports so the
 * argument and `navigator.onLine` cannot get out of step with each other. Absent rather than
 * `data-net="online"` when there is a connection, for the same reason `data-theme` is absent
 * for `system`: the attribute is an exception being announced, and a stylesheet that has to
 * match a value meaning "nothing is unusual" is a stylesheet with a rule for every page.
 */
export function netAttribute(online: boolean): 'offline' | null {
  return online ? null : 'offline';
}

/**
 * Puts the connection state on `<html>`, where CSS can see it.
 *
 * `globals.css` selects on `html[data-net='offline']` to annotate catalogue links with
 * whether this device is holding that game, and it does so only while there is no connection
 * — a badge on three cards out of a hundred and eight is noise while every one of them works.
 * That annotation is somebody else's code; this function is the only thing that raises the
 * flag it keys off, so the two are coupled through one attribute name and nothing else.
 *
 * A no-op where there is no document, like `applyTheme` next door, so a caller need not
 * guard: the static export renders these components on a build machine.
 */
export function applyNetAttribute(online: boolean): void {
  if (typeof document === 'undefined') return;
  const attribute = netAttribute(online);
  if (attribute === null) document.documentElement.removeAttribute('data-net');
  else document.documentElement.setAttribute('data-net', attribute);
}

/**
 * What the bar says while the connection is gone.
 *
 * CLAUDE.md rule 7: colour is never the only signal. The word "Offline" is the signal here
 * and the panel's styling is decoration on top of it, so this reads the same in greyscale, to
 * a screen reader, and to somebody who has never seen the site in colour. The second sentence
 * matches the wording `globals.css` puts on a catalogue link that this device is holding —
 * "Saved on this device" — because two different phrasings for one fact, on one screen, is a
 * person wondering whether they mean two different things.
 */
export const OFFLINE_NOTICE = 'Offline. The games saved on this device still play.';

/**
 * What the bar says when a new build has installed and is waiting to take over.
 *
 * Named rather than written into the component because the e2e suite matches on a substring
 * of it, and `offline-state.test.ts` holds this constant against the substring the spec
 * actually greps for. A reworded prompt is then a failing unit test rather than a failing
 * end-to-end run twenty minutes later, and — the direction that matters more — a prompt
 * reworded to say something the spec no longer looks for cannot pass by accident.
 */
export const UPDATE_NOTICE = 'A new version of DuelBox is ready.';

/**
 * The accessible name of the control that takes the update.
 *
 * Exactly one word, and it is the word the spec asks for by name. It is the label rather than
 * a description of what happens — "Reload" is what the button does to this document, which is
 * the honest promise; the worker swap is the mechanism and the person pressing it does not
 * need to know there is one.
 */
export const RELOAD_LABEL = 'Reload';

/**
 * The message the page posts to a waiting worker to ask it to take over now.
 *
 * The contract between this file and `apps/web/public/sw.js`, which cannot import it — a
 * worker is a separate script in a separate realm, loaded by URL, with no module graph shared
 * with the page. So the two agree on a string and nothing enforces that they do: this
 * constant is documentation and a single spelling for the page's half, not a guarantee. The
 * thing that actually catches a mismatch is the end-to-end test, which presses Reload and
 * waits for the document to be replaced; if the worker is listening for a different word,
 * nothing happens and that test fails on the timeout.
 */
export const SKIP_WAITING = 'SKIP_WAITING';
