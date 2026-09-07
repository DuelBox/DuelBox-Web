import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * "Offline-capable" was on the front page of the repository, and nothing could fail.
 *
 * README.md said it in its fourth line and CLAUDE.md in its fifth. The privacy page said
 * it too, until #2513 corrected that one page — and the test written at the time,
 * `privacy-claims.test.ts`, was pointed at the page it had just corrected. It computed
 * the right fact, that no service worker exists, and then held it against the one file
 * that had already stopped lying, while the same sentence went on being printed two
 * directories up on the two files a reader opens first. The first run of this file found
 * seven unqualified claims across six files, none of which that guard could reach: a guard
 * aimed at one file cannot hold a claim the whole repository is making.
 *
 * That is the eighth entry in CLAUDE.md's tally, and this is what closes it. It knows one
 * fact and holds one rule against it.
 *
 * **The fact.** Is there a service worker? Computed rather than asserted — from the app's
 * sources, its public directory and its dependencies — so that it goes on being true on
 * the day somebody builds one.
 *
 * **The rule.** The prose agrees with the fact, whichever way the fact goes. With no
 * worker, no file may claim the site works offline. With a worker, no file may still deny
 * that it does. Those are the two halves below and exactly one of them runs, because the
 * failure this repository keeps finding is not a wrong sentence, it is a sentence nothing
 * reads: correcting the claim in one place and leaving the denial in another moves the lie
 * rather than fixing it.
 *
 * One claim survives both halves — *a loaded page needs no network* — and it survives
 * because it is not prose. `e2e/offline.spec.ts` aborts every request after load and plays
 * a bot match through, so the third test keeps the README making that claim and keeps that
 * spec cutting the network. A claim whose proof has been deleted is a promise again.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const web = join(root, 'apps', 'web');

/** One line of prose, as a reader would find it: a file, a line number and the words. */
interface Line {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * A span of prose read as one thing, and the lines it was assembled from.
 *
 * Both are needed. Whether a claim is qualified is a question about the span — the
 * qualification is routinely a line or two away — but a failure has to name the line the
 * words are actually on, or it sends the reader to the top of a JSX section and leaves
 * them looking.
 */
interface Unit {
  text: string;
  readonly lines: Line[];
}

/**
 * Every file under a directory, and an absent directory is no files rather than a throw.
 *
 * `apps/web/public` is the reason for the tolerance, and it is not hypothetical: nothing in
 * it is tracked. The 109 share images are generated into `public/og/` before every build and
 * gitignored, so on a fresh checkout the directory does not exist at all — and CI runs
 * `pnpm test` *before* `pnpm build`, so this file scanned it in the one place it was
 * guaranteed to be missing. It passed on every development machine, where a build had
 * already created it, and failed on the first CI run with `ENOENT: scandir`.
 *
 * A missing directory is also the honest answer to the question being asked: a service
 * worker that is not on disk is a service worker that does not exist, which is exactly what
 * the caller wants to know.
 */
function walk(dir: string, keep: (path: string) => boolean, found: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, keep, found);
    else if (keep(path)) found.push(path);
  }
  return found;
}

/**
 * A file whose words describe the product, rather than test it.
 *
 * Both test extensions, not just `.test.ts`. This read `!path.endsWith('.test.ts')` and it
 * is also the filter `serviceWorkerEvidence` walks with, so the first `Foo.test.tsx` in this
 * tree — a component test stubbing `navigator.serviceWorker` to assert we register none —
 * would have counted as a worker existing. The two halves below would then have swapped
 * over, and CI would have failed listing every honest sentence in the repository as a
 * denial to rewrite, on a change that added a test. `app/metadata-claims.test.ts` and
 * `security/csp-origins.test.ts` already exclude both; these were the outliers.
 */
const isProseSource = (path: string): boolean =>
  /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path);

/**
 * Every file that describes this product to somebody reading it.
 *
 * Walked rather than listed, because the claim moved from the privacy page to the README
 * once already and a list would have had to be remembered. Three surfaces: the repository's
 * own top-level documents, everything under `docs/`, and every page and component of the
 * site itself — comments included, since a comment that says something untrue about the
 * product is as wrong as a paragraph that does, and two of the honest sentences about this
 * are comments.
 *
 * Two boundaries, both drawn after reading what is on the other side of them.
 *
 * `BACKLOG.md` is excluded, with `data/platform_issues.yaml` behind it. They are lists of
 * issues that are open by definition — "Offline and installability (7)" is a heading naming
 * work not done — and requiring a backlog title to hedge would be a guard against the
 * backlog describing the future.
 *
 * `packages/` and `e2e/` are excluded because their prose is about the code, not about the
 * product. `packages/engine/src/transport.ts` says its seam is "exercised by tests with no
 * network, no DOM, and no signalling", which is true of the tests and says nothing to a
 * player; a guard reaching that far would spend its failures arguing with sentences that
 * were never claims. Checked rather than assumed: on the day this was written those two
 * trees held one such sentence and no claims at all.
 */
function proseFiles(): string[] {
  const top = readdirSync(root)
    .filter((name) => name.endsWith('.md') && name !== 'BACKLOG.md')
    .map((name) => join(root, name));
  return [
    ...top,
    ...walk(join(root, 'docs'), (path) => path.endsWith('.md')),
    ...walk(join(web, 'src'), isProseSource),
  ].sort();
}

/**
 * Split a file into the units a claim is made in.
 *
 * A unit is a paragraph, a list item, a table row or a heading — the span a reader takes
 * in at once — because this repository wraps its prose at a hundred columns and a claim
 * and its qualification routinely land on different lines. Sentences alone would cut in
 * the wrong place: the privacy page quotes the old wrong claim as the opening of a bullet
 * and corrects it in the sentence after, and that bullet is honest. So the span is what a
 * relative claim is read in, and `ABSOLUTE` below re-cuts it into sentences for the two or
 * three phrasings that no neighbouring sentence can rescue.
 *
 * Fenced code blocks are dropped and inline code spans are blanked before anything is
 * matched. `e2e/offline.spec.ts` is a filename in six places; a guard that read filenames
 * as claims would have taught everyone to route around it.
 */
function units(file: string, source: string): Unit[] {
  const isSource = /\.tsx?$/.test(file);
  const found: Unit[] = [];
  let current: Unit | null = null;
  let fenced = false;
  for (const [index, raw] of source.split('\n').entries()) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      current = null;
      continue;
    }
    if (fenced) continue;
    let text = raw.replace(/`[^`]*`/g, ' ');
    // Comment and blockquote markers come off so that a JSDoc bullet reads as a bullet.
    // Only in TypeScript: a leading `*` in Markdown is a list marker, and stripping it
    // would glue the item onto whatever came before it.
    text = isSource
      ? text.replace(/^\s*(?:\{?\/\*+|\*\/\}?|\*|\/\/)\s?/, '').replace(/\s*\*\/\}?\s*$/, '')
      : text.replace(/^\s*>\s?/, '');
    text = text.trim();
    if (text === '') {
      current = null;
      continue;
    }
    const at: Line = { file, line: index + 1, text };
    if (current === null || /^(?:[-*+]\s|\d+\.\s|\||#{1,6}\s)/.test(text)) {
      current = { text, lines: [at] };
      found.push(current);
    } else {
      current.text += ` ${text}`;
      current.lines.push(at);
    }
  }
  return found;
}

/**
 * The ways this repository has claimed to work without a network, in two kinds.
 *
 * Every phrasing here is one that was actually used, in a file that shipped, which is the
 * only defensible way to write a list like this. It cannot catch a claim phrased in a way
 * nobody has thought of yet. What it can do is make the phrasings that have been used
 * unrepeatable, and fail loudly enough that a new one gets added to it.
 *
 * **Absolute.** A headline. "Offline-capable" is read on its own, off the top of a README,
 * and no sentence three lines down rescues it — so a hedge only counts inside the same
 * sentence. That distinction is not tidiness: with paragraphs as the unit, putting
 * "offline-capable" back into the README's corrected paragraph passed this guard, because
 * the honest sentences beside it were carrying the hedge. Watching that pass is how the
 * split came to be here.
 *
 * **Relative.** A description of when something holds — "needs no network", "with the
 * network off". These are true or false depending on the clause next to them, they are
 * routinely qualified a line away because this repository wraps at a hundred columns, and
 * the whole paragraph is the fair unit to read them in.
 */
const ABSOLUTE: readonly RegExp[] = [
  /\boffline[-\s]capable\b/i,
  /\bworks?\s+offline\b/i,
  /\boffline[-\s]first\b/i,
  /\boffline\s+play\b/i,
  /\bplays?\s+offline\b/i,
];

const RELATIVE: readonly RegExp[] = [
  /\boffline\s+cache\b/i,
  /\bnetwork\s+off\b/i,
  /\bwith\s+no\s+(?:connection|network|internet)\b/i,
  /\bwithout\s+(?:an?\s+|any\s+)?(?:connection|network|internet)\b/i,
  /\bneeds?\s+no\s+(?:connection|network|internet)\b/i,
  /\bno\s+(?:connection|network|internet)\s+(?:required|needed|at all)\b/i,
];

const CLAIMS: readonly RegExp[] = [...ABSOLUTE, ...RELATIVE];

/**
 * What turns one of those from a claim into a description.
 *
 * Five qualify: the page is already loaded, the mechanism does not exist, the cache does
 * not exist, the two claims are being distinguished rather than merged, or the thing is
 * named as not built. Each is checkable against the code, which is what makes it a hedge
 * rather than a softener, and the list stays short because every addition to it is a new
 * way to pass.
 *
 * The sixth is not a qualification but a use-and-mention rule, and it was earned the same
 * afternoon this file was written. `lib/landing.ts` arrived in the working tree carrying
 * "the offline claim #2445 took out of the hero and the 'with no connection at all' line
 * #2513 took out of the privacy page" — a sentence about two claims that were *deleted*,
 * which this failed as though it were making them. A file recording that a claim was
 * removed is the opposite of a file making it, and telling somebody to reword that is the
 * behaviour that teaches a team to route around a guard.
 */
const HEDGES: readonly RegExp[] = [
  /\bonce\b[^.]{0,40}\b(?:loaded|open)\b/i,
  /\bno\s+service\s+worker\b/i,
  /\bno\s+offline\s+cache\b/i,
  /\bnot\s+the\s+same\s+as\b/i,
  /\bnot\b[^.]{0,40}\byet\b/i,
  /\b(?:took|taken)\s+out\b|\bused\s+to\s+(?:read|say|claim)\b|\bno\s+longer\s+(?:says?|claims?)\b/i,
];

/**
 * The sentences that would become untrue the moment a service worker shipped.
 *
 * The other direction of the same rule. #2513 corrected the privacy page and left the
 * README claiming the opposite; this is what stops the reverse — a worker landing while
 * half the site still tells the reader a reload needs a connection.
 *
 * It will also list the sentences that merely *narrate* the absence, in this file's own
 * header and in CLAUDE.md's tally, and that is deliberate rather than tolerated: nothing
 * here can tell a live denial from a remembered one, and every one of them is in the
 * present tense today. On the day a worker ships they all need a second look, and the
 * ones that turn out to be history need the tense they were always owed.
 */
const DENIALS: readonly RegExp[] = [
  /\bno\s+service\s+worker\b/i,
  /\bno\s+offline\s+cache\b/i,
  /\bnot\s+the\s+same\s+as\s+working\s+offline\b/i,
  /\bdoes\s+need\s+(?:one|a\s+connection)\b/i,
];

const matches = (patterns: readonly RegExp[], text: string): boolean =>
  patterns.some((pattern) => pattern.test(text));

const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/);

/** A span of prose claims something no service worker is here to keep. */
const claimsOffline = (text: string): boolean =>
  (matches(RELATIVE, text) && !matches(HEDGES, text)) ||
  sentences(text).some((sentence) => matches(ABSOLUTE, sentence) && !matches(HEDGES, sentence));

/** A span of prose tells the reader there is no offline support. */
const deniesOffline = (text: string): boolean => matches(DENIALS, text);

/**
 * Every span of prose that offends, reported at the line the words are on rather than at
 * the top of the span they were read with.
 *
 * `locate` is only ever used to point: the decision has already been made about the span,
 * and this is the line inside it a reader should be sent to.
 */
function sites(offends: (text: string) => boolean, locate: readonly RegExp[]): Line[] {
  const found: Line[] = [];
  for (const path of proseFiles()) {
    const file = relative(root, path);
    for (const unit of units(file, readFileSync(path, 'utf8'))) {
      if (!offends(unit.text)) continue;
      // The words themselves usually sit on one line; when a wrap has split them, the
      // start of the span is the closest a reader can be sent.
      const at = unit.lines.find((line) => matches(locate, line.text)) ?? unit.lines[0];
      if (at !== undefined) found.push(at);
    }
  }
  return found;
}

const describeLine = ({ file, line, text }: Line): string =>
  `${file}:${String(line)} — ${text.length > 120 ? `${text.slice(0, 117)}...` : text}`;

/**
 * Is there a service worker? Three ways of having one, because there are three ways of
 * getting one: registering it from the app, shipping the worker file itself in the export,
 * or installing a plugin that does both.
 */
const REGISTERS_A_WORKER = /navigator\.serviceWorker|ServiceWorkerRegistration/;

function serviceWorkerEvidence(): string[] {
  const found: string[] = [];
  for (const path of walk(join(web, 'src'), isProseSource)) {
    if (REGISTERS_A_WORKER.test(readFileSync(path, 'utf8'))) {
      found.push(`${relative(root, path)} registers one`);
    }
  }
  for (const path of walk(join(web, 'public'), () => true)) {
    if (/^(?:sw|service-worker)\.[cm]?js$/.test(basename(path))) {
      found.push(`${relative(root, path)} is a worker in the export`);
    }
  }
  for (const manifest of [join(root, 'package.json'), join(web, 'package.json')]) {
    const dependency = /"(workbox[^"]*|next-pwa|serwist|@serwist\/[^"]+|vite-plugin-pwa)":/.exec(
      readFileSync(manifest, 'utf8'),
    );
    if (dependency !== null) {
      found.push(`${relative(root, manifest)} depends on ${dependency[1] ?? '?'}`);
    }
  }
  return found;
}

/** Does the spec still do the thing that makes the surviving claim a fact? */
const cutsTheNetwork = (spec: string): boolean =>
  /page\.route\(\s*'\*\*\/\*'/.test(spec) && /route\.abort\(\)/.test(spec);

const worker = serviceWorkerEvidence();

describe('the offline claim, and the service worker there is not', () => {
  it.skipIf(worker.length > 0)('is not made anywhere, because nothing could keep it', () => {
    expect(
      sites(claimsOffline, CLAIMS).map(describeLine),
      'this claims the site works with no network. There is no service worker, so a page' +
        ' that has not already been loaded cannot be opened without one (#2445). Say what is' +
        ' true — a loaded page needs nothing — or build the worker and update the prose that' +
        ' denies it, which the other half of this file lists for you.',
    ).toEqual([]);
  });

  it.runIf(worker.length > 0)('is now made everywhere it was denied', () => {
    expect(
      sites(deniesOffline, DENIALS).map(describeLine),
      `a service worker exists — ${worker.join('; ')} — and these still tell the reader it` +
        ' does not. Rewrite them, and say in each what the worker does and does not cache.',
    ).toEqual([]);
  });

  it('knows what a service worker looks like, so its silence is worth something', () => {
    // Which half runs is decided by a search, and a search for a string nothing has ever
    // contained comes back empty for ever. So the registration pattern is shown the line
    // it exists to find. CLAUDE.md counts seven guards nobody watched fail; this is the
    // cheapest possible way of not adding the eighth in the file that records the eighth.
    expect(REGISTERS_A_WORKER.test("navigator.serviceWorker.register('./sw.js')")).toBe(true);
    expect(REGISTERS_A_WORKER.test('const registration = null;')).toBe(false);
    // And that it is only ever shown shipped files. A test is where a mention of the API
    // that is not a registration lives, so a test read as product source is the other way
    // this decides wrongly — the expensive way, because it flips the halves rather than
    // silencing them.
    expect(isProseSource(join(web, 'src', 'app', 'page.tsx'))).toBe(true);
    expect(isProseSource(join(web, 'src', 'lib', 'offline-claims.test.ts'))).toBe(false);
    expect(isProseSource(join(web, 'src', 'components', 'Install.test.tsx'))).toBe(false);
  });
});

describe('the claim that survives, and the spec that proves it', () => {
  it('is still made by the README, in the form the e2e suite can prove', () => {
    const inReadme = sites((text) => matches(CLAIMS, text), CLAIMS).filter(
      ({ file }) => file === 'README.md',
    );
    expect(
      inReadme.map(describeLine),
      'README.md no longer says anything about the network. Going quiet is not the fix:' +
        ' the true claim — a loaded page needs no network — is the product, and it is the' +
        ' one thing here a test actually proves.',
    ).not.toEqual([]);
  });

  it('rests on a spec that still cuts the network', () => {
    const spec = readFileSync(join(root, 'e2e', 'offline.spec.ts'), 'utf8');
    expect(
      cutsTheNetwork(spec),
      'e2e/offline.spec.ts no longer aborts every request, so nothing proves a loaded page' +
        ' needs no network and the README is back to promising it',
    ).toBe(true);
    // A search for something every file contains passes for ever, so the detector is shown
    // a spec that loads a page and does nothing else. CLAUDE.md counts seven guards that
    // were never watched failing; this is the cheapest possible way not to be the eighth.
    expect(cutsTheNetwork("await page.goto('/play/tic-tac-toe/');")).toBe(false);
  });
});
