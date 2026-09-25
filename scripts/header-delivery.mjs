/**
 * How each generated header actually reaches a browser — and, on this host, whether it
 * reaches one at all.
 *
 * ## Why this file exists
 *
 * `security-headers.mjs` says what the origin *should* send. `emit-host-config.mjs` renders
 * it into `_headers`, `vercel.json` and a server block. `check-headers.mjs` reads the
 * emitted artefact back and fails the build if a name/value pair went missing — verified by
 * deleting HSTS and watching it fail.
 *
 * Every one of those is green, and on the host this repository actually deploys to, **not
 * one of those headers reaches a single visitor.** The site publishes to GitHub Pages
 * (`.github/workflows/deploy.yml`), which serves no custom response headers at all:
 * `_headers` is a Cloudflare Pages / Netlify file and `vercel.json` is Vercel's, and Pages
 * reads neither. So the whole set is generated, CI-checked, and discarded by the host.
 *
 * That is this repository's signature failure — **a guard that is green about the wrong
 * thing** — and it is the sixth time it has been found. `check-headers.mjs` proves the
 * *file* is right. It cannot prove anybody reads the file. The assertion worth having is
 * the inverse of the one that exists: not "the artefact contains HSTS" but "on this host,
 * HSTS reaches nobody."
 *
 * Until now that truth lived in one prose comment at the top of `deploy.yml`, which nothing
 * executes and nothing checks. This module makes it data: every generated header carries a
 * classification of *how it can be delivered*, every host carries whether it serves response
 * headers, and `check-headers.mjs` fails the build when a header is added to the generated
 * set without being classified. Add a header, and the build tells you to say how it travels.
 *
 * ## The three delivery channels
 *
 * - `header` — a response header and nothing else. No meta equivalent exists, and inventing
 *   one is worse than having none: `<meta http-equiv="Strict-Transport-Security">` is
 *   ignored by every browser, and a tag that looks like protection and is not is how a
 *   scanner report gets waved away.
 * - `header+meta` — also expressible in the markup, so it survives a host that serves no
 *   headers. Two of the nine qualify, and both are already delivered that way.
 * - `header+guard` — no meta equivalent, but the *property* it protects can be partly
 *   recovered in application code. Exactly one qualifies (`X-Frame-Options`), and the word
 *   "partly" is doing real work; see the note on the entry.
 */

import { SECURITY_HEADERS } from './security-headers.mjs';

/**
 * The full set the build generates: the fixed headers plus the CSP, which is assembled
 * separately and therefore is not a key of `SECURITY_HEADERS`.
 *
 * Read from the source rather than listed, so adding a header here is impossible to forget
 * — it turns up unclassified and the build says so.
 */
export const GENERATED_HEADERS = Object.freeze([
  ...Object.keys(SECURITY_HEADERS),
  'Content-Security-Policy',
]);

/**
 * One entry per generated header. `channel` is the only field a check reads; the rest is
 * for the human who has to decide what to do about a red build.
 */
export const DELIVERY = Object.freeze({
  /**
   * No meta equivalent, and the loss is real but bounded here: GitHub Pages serves
   * `*.github.io` over HTTPS only and that whole domain is in the browsers' HSTS preload
   * list already, so a Pages-hosted site gets the *effect* of HSTS from the parent domain
   * rather than from us. A custom domain on Pages would not, and that is the day this
   * matters.
   */
  'Strict-Transport-Security': {
    channel: 'header',
    note: 'no meta equivalent; on *.github.io the preloaded parent domain covers it, a custom domain would not',
  },

  /**
   * `<meta http-equiv="X-Content-Type-Options">` does nothing — the directive is defined
   * for the response header only. MIME sniffing is therefore live on this host.
   */
  'X-Content-Type-Options': {
    channel: 'header',
    note: 'no meta equivalent; MIME sniffing is unconstrained on a host that drops it',
  },

  /**
   * The one fixed header with a real, browser-supported meta form. `<meta name="referrer">`
   * takes the same token set as the header, so the value is taken straight from
   * `SECURITY_HEADERS` rather than written a second time.
   */
  'Referrer-Policy': {
    channel: 'header+meta',
    metaTag: (value) => `<meta name="referrer" content="${value}">`,
    note: 'delivered in every page by emit-host-config.mjs, so it survives a header-less host',
  },

  /**
   * Proposed as `<meta http-equiv="Permissions-Policy">` and never shipped by any engine.
   * Every capability this policy denies is therefore available to anything that gets into
   * the page — which is what the CSP is for, and why the CSP is the one that had to survive.
   */
  'Permissions-Policy': {
    channel: 'header',
    note: 'no meta equivalent was ever implemented; capability denial is lost on a header-less host',
  },

  /** Cross-origin isolation is negotiated in the response, never in the document. */
  'Cross-Origin-Opener-Policy': {
    channel: 'header',
    note: 'no meta equivalent; window.opener severance and SharedArrayBuffer both need the header',
  },
  'Cross-Origin-Resource-Policy': {
    channel: 'header',
    note: 'no meta equivalent; this one governs how *other* origins may load our resources',
  },
  'Cross-Origin-Embedder-Policy': {
    channel: 'header',
    note: 'no meta equivalent; cross-origin isolation is unavailable without it',
  },

  /**
   * No meta equivalent — `<meta http-equiv="X-Frame-Options">` has never been honoured by
   * any browser — and neither has CSP `frame-ancestors`, which a meta policy cannot express
   * either. So on a header-less host *nothing declarative* stops this site being framed.
   *
   * `FRAME_GUARD` in `apps/web/src/app/frame-guard.ts` recovers part of it, and only part.
   * What it buys: a page that is framed hides itself before it paints, so there is nothing
   * for an attacker's overlay to sit on top of and nothing for a victim to click. What it
   * does not buy: it is script, so it is gone the moment scripting is off in the frame
   * (`<iframe sandbox>` without `allow-scripts`) — which is precisely the iframe an attacker
   * controls. It is a mitigation, not the header, and #2367's threat model should read it
   * that way.
   */
  'X-Frame-Options': {
    channel: 'header+guard',
    guard: 'FRAME_GUARD in apps/web/src/app/frame-guard.ts',
    note: 'no meta equivalent, and CSP frame-ancestors has none either; the guard is script-dependent and partial',
  },

  /**
   * The exception that already works. `emit-host-config.mjs` writes the hashed policy into
   * every page as `<meta http-equiv="Content-Security-Policy">`, so the strongest part of
   * the policy travels with the file and needs no host configuration at all.
   *
   * Partial, and the missing pieces are named rather than glossed: `frame-ancestors` cannot
   * be expressed in a meta tag (see `X-Frame-Options` above), and `upgrade-insecure-requests`
   * is deliberately kept out of the page because it broke every plain-HTTP origin on WebKit
   * — both live in the header CSP, which this host also discards.
   */
  'Content-Security-Policy': {
    channel: 'header+meta',
    metaTag: (value) => `<meta http-equiv="Content-Security-Policy" content="${value}">`,
    partial: ['frame-ancestors', 'upgrade-insecure-requests'],
    note: 'the hashed policy travels in every page; the two header-only directives do not',
  },
});

/**
 * What each host does with the generated files.
 *
 * `servesResponseHeaders` is the only bit that changes an answer. The rest is here so the
 * report can say *why* a header is discarded rather than just that it is.
 */
export const HOSTS = Object.freeze({
  'github-pages': {
    label: 'GitHub Pages',
    servesResponseHeaders: false,
    reads: [],
    note: 'serves no custom response headers at all; _headers and vercel.json are both ignored',
  },
  'cloudflare-pages': {
    label: 'Cloudflare Pages',
    servesResponseHeaders: true,
    reads: ['_headers'],
    note: 'reads _headers natively, capped at 100 rules; ours emits one',
  },
  netlify: {
    label: 'Netlify',
    servesResponseHeaders: true,
    reads: ['_headers'],
    note: 'reads the same _headers file, unchanged',
  },
  vercel: {
    label: 'Vercel',
    servesResponseHeaders: true,
    reads: ['vercel.json'],
    note: 'reads vercel.json',
  },
});

/** Where `.github/workflows/deploy.yml` publishes today. */
export const DEPLOY_TARGET = 'github-pages';

/**
 * How `check-headers.mjs` recognises the frame guard in an exported page.
 *
 * A prefix rather than the whole script, because this file is Node's and the guard is
 * `apps/web/src/app/frame-guard.ts`, which Node will not import. It cannot drift silently:
 * `apps/web/src/security/header-delivery.test.ts` asserts the real `FRAME_GUARD` still
 * starts with it, and that test runs on every push.
 *
 * `check-headers.mjs` looks for this **immediately after a literal `<script>`**, and that
 * detail was found the way everything in this repository is found — by deleting the guard
 * from a page and watching the check stay green. Next serialises the whole React tree into
 * the RSC flight payload, so the guard's source appears a second time in every page as a
 * JSON-escaped string inside `self.__next_f.push(...)`. A bare substring search finds that
 * copy, which does not execute, and would have reported a defence that had been deleted as
 * present on all 221 pages.
 */
export const FRAME_GUARD_MARKER = '(function(){var w=window;if(w.top===w.self)';

/**
 * Which host a deploy workflow actually publishes to, read out of the workflow itself.
 *
 * The point is that `DEPLOY_TARGET` above cannot quietly go stale. Move the deploy and this
 * disagrees with the constant, the check goes red, and whoever moved it is told to
 * re-classify rather than discovering months later that the warnings were about a host the
 * site left.
 *
 * Returns `null` for a workflow this does not recognise, which is also a failure — an
 * unrecognised deploy is exactly the case where nobody knows which headers are served.
 */
export function detectDeployTarget(workflow) {
  // Comments first. This workflow's own header comment names Cloudflare, Netlify and
  // `vercel.json` while explaining why none of them is the host, and a detector that read
  // prose would answer "vercel" the moment the Pages step was deleted — which is precisely
  // the edit it exists to catch.
  const steps = workflow
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
    .toLowerCase();
  if (steps.includes('actions/deploy-pages')) return 'github-pages';
  if (steps.includes('wrangler') || steps.includes('cloudflare/pages-action'))
    return 'cloudflare-pages';
  if (steps.includes('netlify')) return 'netlify';
  if (steps.includes('vercel')) return 'vercel';
  return null;
}

/**
 * Everything wrong with the classification itself, in messages somebody can act on.
 *
 * Both directions matter. A generated header with no entry is the failure this module was
 * written for. An entry naming a header the build no longer generates is the slower version
 * of the same problem: a classification that describes a set nobody emits is prose again.
 */
export function classificationProblems() {
  return problemsFor(GENERATED_HEADERS, DELIVERY);
}

/**
 * The same rule, over any pair of sets.
 *
 * Split out so a test can hand it a generated set with one extra header and watch it go red,
 * rather than the check only ever being run against the arrangement that already passes. A
 * guard nobody has seen fail is a guard nobody has seen.
 */
export function problemsFor(generated, delivery) {
  const problems = [];
  for (const name of generated) {
    const entry = delivery[name];
    if (entry === undefined) {
      problems.push(
        `${name} is generated but not classified in scripts/header-delivery.mjs — say how it ` +
          "reaches a browser ('header', 'header+meta' or 'header+guard') and what is lost when " +
          'the host drops it',
      );
      continue;
    }
    if (!['header', 'header+meta', 'header+guard'].includes(entry.channel)) {
      problems.push(`${name} has an unknown delivery channel: ${String(entry.channel)}`);
    }
    if (entry.channel === 'header+meta' && typeof entry.metaTag !== 'function') {
      problems.push(`${name} claims a meta equivalent but supplies no metaTag()`);
    }
  }
  for (const name of Object.keys(delivery)) {
    if (![...generated].includes(name)) {
      problems.push(
        `${name} is classified in scripts/header-delivery.mjs but is no longer generated — ` +
          'delete the entry, or put the header back',
      );
    }
  }
  return problems;
}

/**
 * The tags that carry a header's value into the markup, so a header-less host still
 * delivers it.
 *
 * Built from `SECURITY_HEADERS` at call time. There is exactly one copy of every value in
 * this repository, and it is in `security-headers.mjs`; a meta tag that had its own copy
 * would drift the first time somebody changed the header and not the tag, which is the
 * failure `emit-host-config.mjs` exists to prevent between three host formats and is no
 * more acceptable between a header and a tag.
 *
 * The CSP is excluded: its value is per-page and is assembled by `emit-host-config.mjs`,
 * which injects that tag itself.
 */
export function metaEquivalents() {
  const tags = [];
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    const entry = DELIVERY[name];
    if (entry?.channel !== 'header+meta' || typeof entry.metaTag !== 'function') continue;
    tags.push({ header: name, value, tag: entry.metaTag(value) });
  }
  return tags;
}

/**
 * Which generated headers this host serves, and which it throws away.
 *
 * On a host that serves response headers the answer is boring: all of them, as emitted. The
 * interesting case is the host we are actually on.
 */
export function deliveryReport(target = DEPLOY_TARGET) {
  const host = HOSTS[target];
  if (host === undefined) throw new Error(`unknown deploy target: ${target}`);

  const served = [];
  const discarded = [];
  for (const name of GENERATED_HEADERS) {
    const entry = DELIVERY[name] ?? { channel: 'header', note: 'unclassified' };
    if (host.servesResponseHeaders) {
      served.push({ name, how: 'response header', ...entry });
      continue;
    }
    if (entry.channel === 'header+meta') {
      served.push({ name, how: 'meta tag in every page', ...entry });
    } else {
      discarded.push({ name, how: 'nothing — this host does not send it', ...entry });
    }
  }
  return { target, host, served, discarded };
}

/**
 * The report in plain words, for the build log.
 *
 * Printed on every build rather than only on failure. A number nobody sees is the same as a
 * number nobody computed, and the whole point of this module is that the gap stops being
 * something you have to go and read a workflow comment to learn.
 */
export function formatDeliveryReport(target = DEPLOY_TARGET) {
  const { host, served, discarded } = deliveryReport(target);
  const lines = [
    `header delivery on ${host.label} — ${host.note}`,
    '',
    `  reaches a visitor (${String(served.length)}):`,
    ...served.map((item) => `    ✓ ${item.name.padEnd(30)} ${item.how}`),
  ];
  if (discarded.length > 0) {
    lines.push(
      '',
      `  reaches nobody (${String(discarded.length)}) — generated, CI-checked, dropped by the host:`,
      ...discarded.map(
        (item) =>
          `    ✗ ${item.name.padEnd(30)} ${item.guard === undefined ? item.note : item.note + `; partly mitigated by ${item.guard}`}`,
      ),
    );
  }
  const partial = served.filter((item) => item.partial !== undefined);
  for (const item of partial) {
    lines.push(
      '',
      `  ${item.name} is delivered in part only: ${item.partial.join(', ')} cannot be.`,
    );
  }
  return lines.join('\n');
}
