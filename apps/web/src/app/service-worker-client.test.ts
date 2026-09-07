/**
 * The offline claim, held together across four files that cannot see each other.
 *
 * `service-worker-client.ts` is a hand-concatenated string, `public/sw.js` is plain
 * JavaScript no TypeScript project compiles, `globals.css` names ids and attributes neither
 * of them declares, and `scripts/emit-service-worker.mjs` substitutes placeholders it has
 * to guess the spelling of. Nothing in the type system connects any pair of them. Rename one
 * id, change one message string, adjust one placeholder, and the result is a site that
 * builds green, ships, and quietly has no offline, no update prompt, or a Reload button that
 * does nothing.
 *
 * So each of those seams gets an assertion here rather than an assumption. Every one was
 * checked by breaking it on purpose and watching this file go red.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { SERVICE_WORKER_CLIENT } from './service-worker-client';
import { BASE_PATH } from './base-path';

const WORKER = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8');
const CSS = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');
const EMIT = readFileSync(
  fileURLToPath(new URL('../../../../scripts/emit-service-worker.mjs', import.meta.url)),
  'utf8',
);

/**
 * Comments stripped, the same two ways `scripts/check-zero-cost.mjs` strips them.
 *
 * The distinction is load-bearing rather than tidy. The line-comment stripper is a regex,
 * and `'https://example.com'` contains `//`, so full stripping turns that literal into
 * `'https:` — which means a check for a remote origin run over the fully stripped text can
 * never fire on the one thing it is looking for. That was true here, and it was found by
 * inserting a remote origin and watching this file stay green.
 */
const blockStripped = WORKER.replace(/\/\*[\s\S]*?\*\//g, '');
const workerCode = blockStripped.replace(/\/\/.*$/gm, '');

describe('the inline client script', () => {
  it('is syntactically valid JavaScript', () => {
    // It is assembled by joining twenty-odd string literals, so a missing brace is a
    // completely ordinary mistake and one no type-checker, linter or bundler will see: to
    // every tool in this repository it is a string. `new vm.Script` compiles it and runs
    // none of it — `new Function` would do the same job and is banned by `no-implied-eval`,
    // correctly, since the two are indistinguishable to a reader.
    expect(() => new Script(SERVICE_WORKER_CLIENT)).not.toThrow();
  });

  it('registers the worker at the site root, honouring the base path', () => {
    expect(SERVICE_WORKER_CLIENT).toContain(`n.serviceWorker.register("${BASE_PATH}/sw.js"`);
    expect(SERVICE_WORKER_CLIENT).toContain(`{scope:"${BASE_PATH}/"}`);
  });

  it('does nothing at all where there is no service worker', () => {
    // Every engine this ships to has one, but a page in an insecure context or a private
    // window without them must not throw on line one and take the frame guard's page with it.
    expect(SERVICE_WORKER_CLIENT).toContain('if(!("serviceWorker" in n))return;');
  });

  it('waits for load before registering, so nothing competes with the first paint', () => {
    expect(SERVICE_WORKER_CLIENT).toContain('w.addEventListener("load"');
  });

  it('reloads only when a person asked it to', () => {
    // `controllerchange` also fires on the very first install, when the worker claims the
    // page. Reloading there would bounce every first-time visitor for no reason, and it is
    // the classic version of this bug.
    expect(SERVICE_WORKER_CLIENT).toContain('if(!asked)return;');
  });
});

describe('the client and the worker agree on the one message that passes between them', () => {
  it('posts exactly the message the worker listens for', () => {
    const posted = /postMessage\("([A-Z_]+)"\)/.exec(SERVICE_WORKER_CLIENT)?.[1];
    const heard = /event\.data === '([A-Z_]+)'/.exec(WORKER)?.[1];
    expect(posted).toBe('SKIP_WAITING');
    expect(heard).toBe(posted);
  });

  it('never takes over on its own while a match could be running', () => {
    // The worker calls skipWaiting in exactly two places: the first install, where there is
    // nothing to interrupt, and the message above, where a person pressed Reload.
    const calls = [...workerCode.matchAll(/skipWaiting\(\)/g)];
    expect(calls).toHaveLength(2);
    expect(workerCode).toContain('if (!self.registration.active)');
  });
});

describe('the worker is a cache, not a client', () => {
  it('refuses to intercept anything cross-origin', () => {
    expect(workerCode).toMatch(/url\.origin !== self\.location\.origin/);
  });

  it('names no remote origin anywhere', () => {
    expect(/['"`]https?:\/\//.exec(blockStripped)).toBeNull();
  });

  it('only ever fetches the request the page already made', () => {
    const arguments_ = [...workerCode.matchAll(/\bfetch\s*\(([^)]*)\)/g)].map((m) => m[1]?.trim());
    expect(arguments_.length).toBeGreaterThan(0);
    expect([...new Set(arguments_)]).toEqual(['request']);
  });

  it('never serves itself from a cache, which is the one way to make a stale worker permanent', () => {
    expect(workerCode).toContain('/sw.js`) return');
  });
});

describe('the build step and the worker agree on what is substituted', () => {
  it.each([
    ['__DUELBOX_REVISION__', "'__DUELBOX_REVISION__'"],
    ['__DUELBOX_BASE__', "'__DUELBOX_BASE__'"],
    ['__DUELBOX_PRECACHE__', "'__DUELBOX_PRECACHE__'"],
  ])('%s is both written and replaced', (name, literal) => {
    expect(WORKER).toContain(literal);
    expect(EMIT).toContain(name);
  });

  it('leaves the worker inert rather than broken when the substitution has not run', () => {
    // `pnpm dev` serves `public/sw.js` verbatim. Without this the worker would try to
    // precache the literal string `__DUELBOX_PRECACHE__` on every dev page load.
    expect(workerCode).toContain("!REVISION.startsWith('__')");
  });
});

describe('the stylesheet styles what the script actually creates', () => {
  it.each(['db-net-bar', 'db-net-do', 'db-offline', 'db-update', 'offlineReady'])(
    'the script uses %s',
    (token) => {
      expect(SERVICE_WORKER_CLIENT).toContain(token);
    },
  );

  it.each([
    '.db-net-bar',
    '.db-net-do',
    '#db-offline',
    '#db-update',
    "html[data-net='offline']",
    "[data-offline-ready='1']",
    "[data-offline-ready='0']",
  ])('the stylesheet styles %s', (selector) => {
    expect(CSS).toContain(selector);
  });

  it('says what a catalogue entry is in words, not only by dimming it', () => {
    // Rule 7. A greyscale screen and a low-vision reader both get nothing from opacity.
    expect(CSS).toContain("content: 'Saved on this device'");
    expect(CSS).toContain("content: 'Needs a connection'");
  });
});
