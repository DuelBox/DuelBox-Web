import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OFFLINE_NOTICE,
  RELOAD_LABEL,
  UPDATE_NOTICE,
  applyNetAttribute,
  canRegisterWorker,
  netAttribute,
  workerScope,
  workerScriptUrl,
} from './offline-state';

/**
 * The half of the service-worker bridge that can be checked without a browser.
 *
 * `ServiceWorkerBridge.tsx` is a client component and this suite has no DOM and collects no
 * `.tsx` files, so what is testable here is what was deliberately pulled out of it: the URL
 * arithmetic that decides whether the worker is found at all on a project page, the attribute
 * the catalogue styles itself by, the guard that has to keep an unsupported browser quiet,
 * and the four strings the end-to-end spec matches on.
 *
 * The last of those is the reason this file reaches out to `e2e/offline.spec.ts` rather than
 * writing the words down twice. CLAUDE.md's running tally is mostly one failure repeated:
 * a guard that compares two hard-coded lists to each other, and so cannot fail. Copying "A
 * new version of DuelBox" into this file and asserting it equals the copy in the component
 * would be exactly that. So the spec — the thing that will actually reject a build — is read
 * as the source of truth for what the words have to contain, and the component's constants
 * are held against it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const spec = readFileSync(join(root, 'e2e', 'offline.spec.ts'), 'utf8');

describe('finding the worker on a host that is not the domain root', () => {
  it('leaves both URLs at the site root when there is no base path', () => {
    expect(workerScriptUrl('')).toBe('/sw.js');
    expect(workerScope('')).toBe('/');
  });

  /**
   * The GitHub Pages project-page case, which is the deployment this repository actually has.
   *
   * `next.config.ts` gives Next the same value as `basePath`, so every route and every asset
   * already carries it; a worker URL built by hand is one of the few strings in the app that
   * does not get it for free, which is why `base-path.ts` names this caller in its own
   * docstring. Getting it wrong is invisible in development and total in production.
   */
  it('carries the base path into the script URL and the scope', () => {
    expect(workerScriptUrl('/DuelBox-Web')).toBe('/DuelBox-Web/sw.js');
    expect(workerScope('/DuelBox-Web')).toBe('/DuelBox-Web/');
  });

  /**
   * A worker controls what sits at or below the directory its script came from, so a scope
   * the script's own location does not permit is a rejected registration rather than a
   * narrower one. Asserted for both deployments at once, because the pair being consistent is
   * the property — either one alone can be right while the two disagree.
   */
  it('keeps the script inside the scope it asks for, on either host', () => {
    for (const basePath of ['', '/DuelBox-Web']) {
      expect(workerScriptUrl(basePath).startsWith(workerScope(basePath))).toBe(true);
    }
  });
});

describe('the connection attribute', () => {
  it('is absent while there is a connection and stamped while there is not', () => {
    expect(netAttribute(true)).toBeNull();
    expect(netAttribute(false)).toBe('offline');
  });
});

describe('putting the connection attribute on the document', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeDocument() {
    const attrs = new Map<string, string>();
    return {
      documentElement: {
        setAttribute: (name: string, value: string) => attrs.set(name, value),
        removeAttribute: (name: string) => attrs.delete(name),
      },
      attrs,
    };
  }

  it('stamps data-net when the connection goes and clears it when it returns', () => {
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    applyNetAttribute(false);
    expect(doc.attrs.get('data-net')).toBe('offline');
    applyNetAttribute(true);
    expect(doc.attrs.has('data-net')).toBe(false);
  });

  it('does nothing, and does not throw, where there is no document', () => {
    vi.stubGlobal('document', undefined);
    expect(() => {
      applyNetAttribute(false);
    }).not.toThrow();
  });
});

describe('deciding whether to register at all', () => {
  it('registers only in a secure context on an engine that has the API', () => {
    expect(canRegisterWorker({ isSecureContext: true, navigator: { serviceWorker: {} } })).toBe(
      true,
    );
  });

  /**
   * Each of these is a real browser rather than a hypothetical one: an older iOS Safari or a
   * profile with the feature off has no `serviceWorker` on `navigator`; a build previewed
   * over plain HTTP from a LAN address is an insecure context. In all of them the bridge has
   * to be silent — no prompt, no thrown error, and a site that behaves exactly as it did
   * before the worker existed.
   */
  it('stays out of the way where it cannot work', () => {
    expect(canRegisterWorker({ isSecureContext: false, navigator: { serviceWorker: {} } })).toBe(
      false,
    );
    expect(canRegisterWorker({ isSecureContext: true, navigator: {} })).toBe(false);
    expect(canRegisterWorker({ isSecureContext: true })).toBe(false);
    expect(canRegisterWorker({})).toBe(false);
  });
});

/**
 * The words, held against the spec that will reject a build for not saying them.
 *
 * Every matcher the spec applies to a `role="status"` element is collected out of the file,
 * and the two notices this module owns are checked against the collection. That is a weaker
 * claim than "this notice satisfies that assertion" — it does not know which matcher belongs
 * to which test — and it is deliberately the weaker one: the failure being guarded against is
 * a rewording, and a rewording makes a notice satisfy *no* matcher at all.
 *
 * Two things stop it passing vacuously, and both are here because a guard nobody has watched
 * fail is a guard nobody has seen. The count is asserted, so a regex that stopped matching
 * the spec's shape fails rather than quietly collecting nothing. And a sentence the spec has
 * never contained is run through the same check and must come back unsatisfied.
 */
describe('the words the spec matches on', () => {
  const STATUS_MATCHER = /getByRole\('status'\)\.filter\(\{ hasText: (\/[^/]+\/|'[^']*') \}\)/g;

  const matchers = [...spec.matchAll(STATUS_MATCHER)].map((match) => match[1] ?? '');

  const satisfied = (text: string): boolean =>
    matchers.some((raw) =>
      raw.startsWith('/')
        ? new RegExp(raw.slice(1, -1)).test(text)
        : text.includes(raw.slice(1, -1)),
    );

  it('finds the assertions it is supposed to be reading', () => {
    // Four in the file today — three countdowns and the update prompt — plus the offline
    // pill. The floor is what matters: a regex that has stopped matching the spec's shape
    // collects nothing and would otherwise make every assertion below pass.
    expect(matchers.length).toBeGreaterThan(2);
    expect(satisfied('a sentence this site has never shown anybody')).toBe(false);
  });

  it('says something the offline assertion will find', () => {
    expect(satisfied(OFFLINE_NOTICE)).toBe(true);
  });

  it('says something the update assertion will find', () => {
    expect(satisfied(UPDATE_NOTICE)).toBe(true);
  });

  /**
   * The button is matched by accessible name rather than by text, so it is read out of the
   * spec the same way and built from the constant. `getByRole`'s `name` is a case-insensitive
   * substring by default, so a longer label would still pass the spec — and would still be
   * wrong, because the task this implements asks for that name exactly.
   */
  it('labels the control with the name the spec asks for', () => {
    expect(spec).toContain(`getByRole('button', { name: '${RELOAD_LABEL}' })`);
    expect(spec).not.toContain("getByRole('button', { name: 'Reload now' })");
  });
});
