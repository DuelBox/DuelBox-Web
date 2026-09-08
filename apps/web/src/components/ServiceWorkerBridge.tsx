'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { BASE_PATH } from '@/app/base-path';
import {
  OFFLINE_NOTICE,
  RELOAD_LABEL,
  SKIP_WAITING,
  UPDATE_NOTICE,
  applyNetAttribute,
  canRegisterWorker,
  workerScope,
  workerScriptUrl,
} from '@/lib/offline-state';
import { MATCH_FINISHED, type BeforeInstallPromptEvent } from '@/lib/install-prompt-key';

/**
 * The install offer (#195): its store, its rule and its two buttons all arrive on demand.
 *
 * This component is in the root layout, so every byte of it is shell. The offer only ever
 * shows on a result screen, so the decision (`lib/install-prompt`) is fetched when a match
 * finishes and the buttons (`InstallOffer`) are mounted through `lazy()` only once it has
 * said yes. Measured: with both inline, the shell was 310 B over; like this it fits.
 */
const loadInstallStore = () => import('@/lib/install-prompt');
const InstallOffer = lazy(() => import('./InstallOffer'));
type InstallStore = Awaited<ReturnType<typeof loadInstallStore>>;
interface ReadyOffer {
  readonly event: BeforeInstallPromptEvent;
  readonly store: InstallStore;
}
import styles from './ServiceWorkerBridge.module.css';

/**
 * The page's end of the service worker (#192, #193, #194).
 *
 * Three jobs, and they are one component because they are one subject: this is the page
 * listening to the worker and to the network. It registers the worker; it notices when a new
 * build has installed and is waiting, and offers it rather than imposing it; and it stamps
 * the connection state where the stylesheet can see it and says so in words. Splitting them
 * would put three client components in the root layout where one will do, and every byte of
 * a root-layout component is paid for by every visitor on every route.
 *
 * ## Why the whole thing is one live region, mounted only when it has something to say
 *
 * This was the design decision that took the longest and it is the one most likely to be
 * changed back by somebody who has not read this, so it is written out.
 *
 * The repository has been bitten twice in this area, in opposite directions, and both scars
 * are recorded next to the code that carries them. `SettingsPanel` had an `<output>` beside
 * its status line; `<output>` carries an implicit `role="status"`, so the settings page had
 * two live regions announcing over each other. And `MatchOverlay` found that a live region
 * has to be on the page *before* the words are — a region inserted with its text already in
 * it is either not announced at all or announced entirely, heading and buttons included.
 *
 * Taken together those two rule out the obvious shape. An always-mounted announcer, which is
 * what `MatchOverlay` settled on, cannot be done here: this component is in the root layout,
 * so an always-mounted `role="status"` would be on all 223 exported pages, and
 * `e2e/settings.spec.ts` and `e2e/record.spec.ts` both do `page.getByRole('status')` with no
 * filter and would fail Playwright's strict-mode check the moment a second one existed. Two
 * regions — an offline pill and an update prompt as separate elements, which is what
 * `globals.css` was written for — is the `SettingsPanel` defect by construction.
 *
 * So: one element, mounted when there is something to say, and filled a commit later. The
 * first render puts the empty region in the document; `useEffect` runs after that commit is
 * on screen and schedules a second render that puts the words inside it. Two DOM mutations in
 * two separate tasks, which is what makes the announcement the one `MatchOverlay` measured as
 * working. The empty first pass wears `db-visually-hidden` rather than the bar's own class,
 * so nobody sees an empty panel flash at the foot of the page for a frame.
 *
 * ## Why the styling comes from `globals.css`
 *
 * `.db-net-bar`, `.db-net-do` and the `html[data-net='offline']` catalogue annotations are
 * already in `apps/web/src/app/globals.css`, written for exactly this and landed ahead of it.
 * Reusing them costs zero bytes on the JavaScript budget the shell is measured by — a
 * stylesheet is not counted, a CSS-module import is — and avoids a second description of the
 * same panel. The one thing they do not give is the touch target on the button, which is why
 * there is a module here at all and why it has exactly one rule in it.
 */
export function ServiceWorkerBridge() {
  const [online, setOnline] = useState(true);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [announced, setAnnounced] = useState(false);
  /** The browser's install event, captured and held until a match has been played (#195). */
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  /** The offer, once a match has finished and the store has said yes; null is "say nothing". */
  const [offer, setOffer] = useState<ReadyOffer | null>(null);

  /**
   * The connection, from the browser's own events.
   *
   * `navigator.onLine` at mount and then the `online` and `offline` events, which is the only
   * signal a page gets without asking the network something — and asking the network whether
   * the network is there is the one probe this site will not make.
   *
   * A measured limitation, already written into `e2e/offline.spec.ts` and repeated here so it
   * is not rediscovered: Chromium's offline emulation does not make `navigator.onLine` false
   * in a page created *after* emulation was switched on. It stays `true`, so the indicator
   * cannot be exercised by a cold start under Playwright and the cold-start tests
   * deliberately do not assert it. A real device with the radio off reports `false` on load
   * and this reads it correctly there; what the suite can cover is losing the connection with
   * a page open, which is what the catalogue test does.
   *
   * `true` for the first render rather than a read during render, because the site is
   * statically exported: a value read while rendering would be baked into the HTML on the
   * build machine and would disagree with the browser's first paint.
   */
  useEffect(() => {
    const sync = (): void => {
      applyNetAttribute(navigator.onLine);
      setOnline(navigator.onLine);
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  /**
   * Registration, and the watch for a build that has installed behind this one.
   *
   * On `load`, not during render and not in an effect that races the first paint. Installing
   * precaches the whole shell — fifty-odd URLs and about half a megabyte — and starting that
   * while the page the visitor is looking at is still fetching its own chunks makes the first
   * visit slower to serve the second one. `readyState` is checked first because by the time
   * React has hydrated the load event has usually already fired, and an effect that only
   * listens would then wait for an event that has been and gone: nothing would ever register,
   * on every visit, which is a failure with no symptom other than the feature not existing.
   *
   * There is no teardown beyond the `load` listener, and that is deliberate rather than
   * missed. This component is mounted by the root layout for the lifetime of the document, so
   * there is no unmount to clean up after outside React's development double-invoke; and the
   * listeners below are attached to the registration and to the worker, which outlive any
   * component. A `cancelled` flag would remove none of them and would only look like cleanup.
   *
   * `container.controller !== null` is what separates an update from a first install. A
   * worker that has just installed for the first time has nothing to displace, so it
   * activates immediately and there is nothing to offer anybody; a worker that installs while
   * another one is controlling this page is the case #194 is about, and it stays in `waiting`
   * until somebody says so. Nothing here calls `skipWaiting`, on purpose: a match in progress
   * is never swapped out from under itself, and the spec asserts the state is still
   * `installed` at the moment the prompt appears.
   *
   * **Three entry points, and the third is the one that was missing.** `updatefound` is the
   * live case — a new deploy found while this page is open, which is what
   * `e2e/offline.spec.ts` manufactures and therefore the only one that spec can catch.
   * `registration.waiting` at mount is the case that is easy to forget and common in
   * practice: the update installed during the last visit, nobody took it, and the person is
   * back on a page still served by the old worker. `registration.installing` at mount is the
   * one that is easy to *reason* wrongly about, and it is the ordinary path in production.
   * `docs/deploy.md` says how a device learns about a deploy at all: the browser re-fetches
   * `sw.js` on navigation, on its own schedule, and starts installing the moment the bytes
   * differ. That happens while the document is still loading — and this registers on `load`,
   * deliberately, a beat later. So by the time `register()` resolves, `updatefound` has
   * frequently already fired on a registration object nobody was holding yet, and there is
   * no way to hear an event that has been and gone: `waiting` is still null because the
   * worker is `installing`, not installed, and the prompt would appear one visit late, every
   * time, for the update path almost every real visitor is on. One `offer` covers all three:
   * it reads both slots at mount and then follows whatever it was handed through
   * `statechange`, so a worker that is already installed is taken as it stands and one that
   * is still installing is waited for. That is why the state is re-read inside `settle`
   * rather than assumed from which slot the worker came out of.
   */
  useEffect(() => {
    if (!canRegisterWorker(window)) return;
    const container = navigator.serviceWorker;

    const start = (): void => {
      void container
        .register(workerScriptUrl(BASE_PATH), { scope: workerScope(BASE_PATH) })
        .then((registration) => {
          const offer = (worker: ServiceWorker | null): void => {
            if (worker === null) return;
            const settle = (): void => {
              if (worker.state === 'installed' && container.controller !== null) setWaiting(worker);
            };
            settle();
            worker.addEventListener('statechange', settle);
          };
          offer(registration.waiting);
          offer(registration.installing);
          registration.addEventListener('updatefound', () => {
            offer(registration.installing);
          });
        })
        .catch(() => {
          // Swallowed, and this is the whole of the error handling on purpose. A registration
          // can reject for reasons that are none of the visitor's business — the script 404s
          // on a misconfigured host, the policy forbids it, the profile has workers off — and
          // in every one of them the right outcome is the site behaving exactly as it did
          // before this component existed. There is nothing here to tell anybody and nothing
          // for them to do about it.
        });
    };

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      window.removeEventListener('load', start);
    };
  }, []);

  /**
   * The words go in one commit after the region does. See the note at the top of the file.
   */
  /**
   * The install offer (#195): capture, defer, ask once after a finished match.
   *
   * `beforeinstallprompt` arrives seconds into a first visit, which is the worst moment to
   * ask — a visitor who has played nothing has no reason to say yes, and a prompt dismissed
   * then is one Chromium will not offer again for months. `preventDefault` stops the browser's
   * own mini-infobar and hands the decision here; the event is held in state and nothing is
   * shown until `PlaySurface` raises `MATCH_FINISHED`, which it does after recording a result.
   * A "Not now" is remembered for thirty days in `lib/install-prompt.ts`, which is also where
   * the rule lives, in one pure function with a test per clause.
   */
  useEffect(() => {
    const capture = (event: Event): void => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', capture);
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
    };
  }, []);

  useEffect(() => {
    if (installEvent === null) return;
    let live = true;
    const finished = (): void => {
      void loadInstallStore().then((store) => {
        if (!live) return;
        const ready = store.shouldOfferInstall({
          hasPrompt: true,
          matchFinished: true,
          memory: store.readInstallMemory(),
          now: Date.now(),
        });
        setOffer(ready ? { event: installEvent, store } : null);
      });
    };
    window.addEventListener(MATCH_FINISHED, finished);
    return () => {
      live = false;
      window.removeEventListener(MATCH_FINISHED, finished);
    };
  }, [installEvent]);

  const speaking = !online || waiting !== null || offer !== null;
  useEffect(() => {
    setAnnounced(speaking);
  }, [speaking]);

  /**
   * Take the update: ask the waiting worker to take over, and reload when it has.
   *
   * The reload is driven by `controllerchange` and never by a timer, because the only thing
   * worth waiting for is the new worker actually being in charge — reloading on a guess lands
   * the document back on the old one and the prompt reappears.
   *
   * The listener is attached here, inside the click, rather than once at mount, and that is
   * the whole of the loop guard. `controllerchange` also fires the *first* time a worker
   * claims a page, which every first visit does; a handler installed at mount that reloaded
   * unconditionally would reload every visitor's first page load, and on an engine that
   * re-claims after a reload it would do it again, and again. Attaching it only when somebody
   * has asked for the update means the only `controllerchange` it can ever see is the one it
   * caused. `once` covers the second half: an engine that fires the event twice reloads once.
   *
   * What is deliberately not guarded is a second press while the first is still in flight: it
   * attaches a second listener, posts the message again, and calls `reload()` twice in the
   * same task. `skipWaiting` is idempotent and the second `reload()` lands on a document that
   * is already going, so the cost of that is nothing and the cost of preventing it is a piece
   * of state on the one component in the root layout that every visitor downloads.
   */
  const takeUpdate = (worker: ServiceWorker): void => {
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        window.location.reload();
      },
      { once: true },
    );
    worker.postMessage({ type: SKIP_WAITING });
  };

  if (!speaking) return null;
  if (!announced) return <div className="db-visually-hidden" role="status" />;
  return (
    <div className="db-net-bar" role="status">
      {online ? null : <span>{OFFLINE_NOTICE}</span>}
      {offer === null ? null : (
        <Suspense fallback={null}>
          <InstallOffer
            event={offer.event}
            store={offer.store}
            onDone={() => {
              setOffer(null);
              setInstallEvent(null);
            }}
          />
        </Suspense>
      )}
      {waiting === null ? null : (
        <>
          <span>{UPDATE_NOTICE}</span>
          <button
            type="button"
            className={`db-net-do ${styles.reload}`}
            onClick={() => {
              takeUpdate(waiting);
            }}
          >
            {RELOAD_LABEL}
          </button>
        </>
      )}
    </div>
  );
}
