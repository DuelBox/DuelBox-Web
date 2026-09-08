/**
 * Every generated header must say how it is delivered — and on this host, most of them are
 * not delivered at all.
 *
 * Issue #2481: `scripts/security-headers.mjs` generates nine headers, `emit-host-config.mjs`
 * writes them into `_headers`, `vercel.json` and a server block, and `check-headers.mjs`
 * fails the build if one goes missing. All of that works. And the site deploys to GitHub
 * Pages, which serves no custom response headers at all, so the entire set is generated,
 * CI-checked and thrown away. The existing guard is green about the wrong thing — it proves
 * the *file* is right, never that anybody reads it — which is the failure this repository
 * has now been bitten by six times.
 *
 * So these are the inverse assertions. Not "the artefact contains HSTS" but "on this host,
 * HSTS reaches nobody", written down where a build can fail on it.
 *
 * The one that earns its place over the others is the first: add a header to
 * `SECURITY_HEADERS` without classifying it and this goes red, so the gap can never quietly
 * grow. Everything after it pins the specific claims the docs, `deploy.yml` and the comments
 * on #2367 and #218 are now written against.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DELIVERY,
  DEPLOY_TARGET,
  FRAME_GUARD_MARKER,
  GENERATED_HEADERS,
  HOSTS,
  classificationProblems,
  deliveryReport,
  detectDeployTarget,
  formatDeliveryReport,
  metaEquivalents,
  problemsFor,
} from '../../../../scripts/header-delivery.mjs';
import { SECURITY_HEADERS } from '../../../../scripts/security-headers.mjs';
import { FRAMED_ATTRIBUTE, FRAME_GUARD } from '../app/frame-guard';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

interface Classification {
  channel: string;
  metaTag?: (value: string) => string;
  guard?: string;
  partial?: string[];
  note?: string;
}

/** The `.mjs` is untyped; this is the shape the checks below actually use. */
const delivery = DELIVERY as Readonly<Record<string, Classification | undefined>>;
const hosts = HOSTS as Readonly<
  Record<string, { label: string; servesResponseHeaders: boolean } | undefined>
>;
const names = GENERATED_HEADERS;

describe('every generated header is classified by how it is delivered', () => {
  it('has no unclassified header and no classification for a header nobody generates', () => {
    expect(classificationProblems()).toEqual([]);
  });

  it('covers the whole generated set, not a snapshot of it', () => {
    for (const name of Object.keys(SECURITY_HEADERS)) expect(names).toContain(name);
    // Assembled separately, so it is not a key of SECURITY_HEADERS and is the one a
    // hand-written list would forget.
    expect(names).toContain('Content-Security-Policy');
  });

  it('goes red when a header is added to the generated set without a classification', () => {
    // The red half, run on every push rather than demonstrated once by hand. A guard nobody
    // has seen fail is a guard nobody has seen — so this is exactly the change that must not
    // merge silently: a new header in `SECURITY_HEADERS`, nothing said about how it travels.
    const problems = problemsFor(['Origin-Agent-Cluster', ...names], delivery);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Origin-Agent-Cluster is generated but not classified');
    expect(problems[0]).toContain('header+guard');
  });

  it('goes red when a classification outlives the header it describes', () => {
    const problems = problemsFor(
      names.filter((name) => name !== 'Permissions-Policy'),
      delivery,
    );
    expect(problems).toEqual([expect.stringContaining('Permissions-Policy is classified')]);
  });

  it('goes red on a channel nobody has defined, rather than treating it as served', () => {
    const problems = problemsFor(['Made-Up'], { 'Made-Up': { channel: 'wishful' } });
    expect(problems).toEqual([expect.stringContaining('unknown delivery channel: wishful')]);
  });

  it('gives a meta tag to everything that claims one, and to nothing that does not', () => {
    for (const name of names) {
      const entry = delivery[name];
      expect(entry, name).toBeDefined();
      if (entry?.channel === 'header+meta') expect(typeof entry.metaTag).toBe('function');
      else expect(entry?.metaTag).toBeUndefined();
    }
  });
});

describe('what GitHub Pages actually serves', () => {
  it('serves no custom response headers, which is the whole problem', () => {
    expect(hosts[DEPLOY_TARGET]?.servesResponseHeaders).toBe(false);
  });

  it('discards HSTS, the isolation trio, nosniff, Permissions-Policy and X-Frame-Options', () => {
    const { discarded } = deliveryReport() as { discarded: { name: string }[] };
    expect(discarded.map((item) => item.name).sort()).toEqual([
      'Cross-Origin-Embedder-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
      'Permissions-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
    ]);
  });

  it('delivers only the CSP and the referrer policy, both in the markup', () => {
    const { served } = deliveryReport() as { served: { name: string; how: string }[] };
    expect(served.map((item) => item.name).sort()).toEqual([
      'Content-Security-Policy',
      'Referrer-Policy',
    ]);
    for (const item of served) expect(item.how).toBe('meta tag in every page');
  });

  it('serves everything on a host that reads _headers, which is the point of moving', () => {
    const { discarded, served } = deliveryReport('cloudflare-pages') as {
      discarded: unknown[];
      served: unknown[];
    };
    expect(discarded).toEqual([]);
    expect(served).toHaveLength(names.length);
  });

  it('says so in words a build log can carry', () => {
    const report = formatDeliveryReport();
    expect(report).toContain('GitHub Pages');
    expect(report).toContain('reaches nobody');
    expect(report).toContain('Strict-Transport-Security');
  });
});

describe('the declared deploy target cannot go stale', () => {
  it('agrees with what deploy.yml actually does', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
    expect(detectDeployTarget(workflow)).toBe(DEPLOY_TARGET);
  });

  it('recognises the hosts that would change the answer', () => {
    expect(detectDeployTarget('uses: cloudflare/wrangler-action@v3')).toBe('cloudflare-pages');
    expect(detectDeployTarget('run: npx netlify-cli deploy')).toBe('netlify');
    // An unrecognised deploy is a failure, not a default: it is exactly the case where
    // nobody knows which headers are served.
    expect(detectDeployTarget('run: rsync -a out/ example:/srv')).toBeNull();
  });

  it('reads the steps and not the comment that explains them', () => {
    // deploy.yml's own header comment names Cloudflare, Netlify and vercel.json while saying
    // that none of them is the host. A detector fooled by prose would report a host change
    // that had not happened, and — worse — miss one that had.
    expect(detectDeployTarget('# we do not use netlify or vercel.json\nrun: echo hi')).toBeNull();
  });
});

describe('the meta equivalents are the header values, not copies of them', () => {
  it('builds the referrer tag from the header the build generates', () => {
    const tags = metaEquivalents() as { header: string; value: string; tag: string }[];
    const referrer = tags.find((tag) => tag.header === 'Referrer-Policy');
    expect(referrer?.value).toBe(SECURITY_HEADERS['Referrer-Policy']);
    expect(referrer?.tag).toBe(
      `<meta name="referrer" content="${SECURITY_HEADERS['Referrer-Policy']}">`,
    );
  });

  it('invents no meta tag for a header that has none', () => {
    const tags = metaEquivalents() as { header: string }[];
    for (const header of [
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'Permissions-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Embedder-Policy',
      'Cross-Origin-Resource-Policy',
      'X-Frame-Options',
    ]) {
      expect(tags.map((tag) => tag.header)).not.toContain(header);
    }
  });
});

describe('the frame guard, which is all that stands in for a header nobody serves', () => {
  it('starts with the prefix check-headers.mjs looks for in every exported page', () => {
    // check-headers runs in Node and cannot import a `.ts`, so it matches a prefix — and it
    // matches it immediately after a literal `<script>`, because Next also serialises this
    // very string into each page's RSC flight payload, where it never executes. A looser
    // search reported the guard as present on every page after it had been deleted.
    expect(FRAME_GUARD.startsWith(FRAME_GUARD_MARKER)).toBe(true);
  });

  it('hides the document before paint rather than trying to navigate the top frame', () => {
    // Setting `top.location` from a cross-origin frame is blocked without a user gesture, so
    // a navigating frame-buster is the one that looks like a defence and is not.
    expect(FRAME_GUARD).not.toContain('top.location');
    // The hiding must be an `!important` rule in a stylesheet, not an inline style and not a
    // rewritten body: React re-renders the document on a hydration mismatch, and either of
    // those would be undone by it — the page would go dark and come back framed and live.
    expect(FRAME_GUARD).toContain('html{visibility:hidden!important}');
    expect(FRAME_GUARD).toContain('appendChild(s)');
  });

  it('does the whole refusal synchronously, with nothing deferred and nothing undone', () => {
    // The hiding must not wait for an event, a frame or a stylesheet. It used to build the
    // notice from a `DOMContentLoaded` listener, which is the one part of this React could
    // clobber on a hydration mismatch; the notice is markup in `layout.tsx` now and this
    // script is the decision alone (#2545). If a listener ever comes back, the rule above it
    // is what must still be unconditional.
    expect(FRAME_GUARD).not.toContain('addEventListener');
    expect(FRAME_GUARD).not.toContain('setTimeout');
    expect(FRAME_GUARD).not.toContain('remove()');
    expect(FRAME_GUARD).not.toContain('visibility=""');
  });

  it('stamps the attribute the stylesheet and the layout both key off', () => {
    // The only channel out of the before-paint script. Three files have to agree on it;
    // `app/frame-notice.test.ts` holds the other two against the same constant.
    expect(FRAMED_ATTRIBUTE).toBe('data-framed');
    expect(FRAME_GUARD).toContain(`setAttribute("${FRAMED_ATTRIBUTE}","")`);
  });

  it('stays small, because every byte of it is paid 108 times over (#2545)', () => {
    // Not a style preference. The root layout is serialised into the RSC payload of every
    // exported route and `next/link` prefetches the lot on a browse, so this string is the
    // most expensive place in the repository to write a byte: 708 -> 293 took 15 196 gzipped
    // bytes off what a browse speculates. The ceiling is loose enough that an edit for
    // clarity is not a failure and tight enough that building UI in here is; anything that
    // needs the room should go to `globals.css`, which is fetched once instead of 108 times.
    expect(FRAME_GUARD.length).toBeLessThan(350);
  });

  it('is claimed as a partial mitigation and never as the header', () => {
    const entry = delivery['X-Frame-Options'];
    expect(entry?.channel).toBe('header+guard');
    expect(entry?.guard).toContain('frame-guard.ts');
    const { discarded } = deliveryReport() as { discarded: { name: string }[] };
    // Still discarded. A mitigation in the page does not make the header served, and the
    // report must not let anyone read it that way.
    expect(discarded.map((item) => item.name)).toContain('X-Frame-Options');
  });
});
