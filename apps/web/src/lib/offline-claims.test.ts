import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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
 * **The fact.** Is the offline claim *backed*? Computed rather than asserted — from the
 * worker script, the step that finishes it, the build that runs that step and the root
 * layout that mounts the registration — so that it goes on being true on the day somebody
 * builds one and on the day somebody half-builds one.
 *
 * **The rule.** The prose agrees with the fact, whichever way the fact goes. With nothing
 * behind it, no file may claim the site works offline. With a worker behind it, no file may
 * still deny that it does. Those are the two halves below, because the failure this
 * repository keeps finding is not a wrong sentence, it is a sentence nothing reads:
 * correcting the claim in one place and leaving the denial in another moves the lie rather
 * than fixing it.
 *
 * One claim survives both halves — *a loaded page needs no network* — and it survives
 * because it is not prose. `e2e/offline.spec.ts` aborts every request after load and plays
 * a bot match through, so the third test keeps the README making that claim and keeps that
 * spec cutting the network. A claim whose proof has been deleted is a promise again.
 *
 * ## Why the fact is four questions now, and not "is there a file called sw.js"
 *
 * This is the part of the file that was rewritten, and it was rewritten because the cheap
 * version of the question was measured being wrong about this very branch.
 *
 * The first version asked three things — does anything under `apps/web/src` mention
 * `navigator.serviceWorker`, is there a `sw.js` in `public/`, is a PWA plugin in a
 * `package.json` — and any one of them was enough. On the branch that built the worker, all
 * three were true within the hour: `apps/web/public/sw.js` existed, the emit script existed,
 * and `components/ServiceWorkerBridge.tsx` existed and registered one. So this file
 * swapped its halves over, declared the worker shipped, and spent its failure listing twelve
 * honest sentences in `CLAUDE.md`, the privacy page and the landing copy as denials to
 * rewrite.
 *
 * **Nothing was registering anything.** `app/layout.tsx` did not import `ServiceWorkerBridge`
 * and did not render it. The component was a file on disk with no caller: every one of those
 * twelve sentences was still true, the README's new paragraph promising a cold start with no
 * connection was not, and the one guard in the repository whose whole job is to notice that
 * mismatch was pointing the wrong way and demanding the true sentences be deleted. A guard
 * that fails on the honest half of a half-built feature is worse than no guard, because the
 * cheapest way to make it green is to delete the truth.
 *
 * So the fact is now the four things that have to hold for a visitor to actually get a
 * worker, and a claim is allowed only when all four do:
 *
 * 1. **The worker exists and is a worker.** `apps/web/public/sw.js`, listening for `install`
 *    and for `fetch`. An empty file with the right name caches nothing.
 * 2. **The step that finishes it exists, and finishes it.** `scripts/emit-service-worker.mjs`,
 *    and every `__PLACEHOLDER__` the worker ships with is a placeholder that script names.
 *    A worker whose `PRECACHE` is still the literal string `'__PRECACHE__'` installs, claims
 *    the page, holds one bogus entry and is offline-capable in no sense at all.
 * 3. **The build runs that step.** `package.json`'s `build` script, because a generator
 *    nothing calls is a generator that did not run.
 * 4. **The registration is mounted.** The interesting one, and the one that rots: the import
 *    graph out of `app/layout.tsx` has to *reach* the module that registers, and something in
 *    that graph has to *render* it. Reachability alone is not enough — an import with no
 *    `<Bridge />` under it is the same unmounted component with a lint rule's blessing.
 *
 * The root layout is the entry point rather than any page because that is the module every
 * one of the 223 exported routes pulls in, and `e2e/offline.spec.ts` waits for
 * `navigator.serviceWorker.controller` on `/`, on `/games/` and on `/play/<slug>/`. A
 * registration mounted anywhere narrower would be a registration most of the site does not
 * get.
 *
 * ## What this deliberately will not accept
 *
 * A worker generated by a plugin — `next-pwa`, `serwist`, `vite-plugin-pwa` — fails all four
 * questions, and the first version of this file accepted the mere presence of one in a
 * `package.json` as proof. That was a hole rather than a generosity: adding a dependency line
 * unlocked every offline claim in the repository without a byte of worker being served. If
 * this project ever adopts one, this file has to be taught the new mechanism by hand. That is
 * a conversation worth having and it is cheap; a dependency string that silently satisfies a
 * product claim is neither.
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
 * it was tracked until the worker landed. The 109 share images are generated into
 * `public/og/` before every build and gitignored, so on a fresh checkout the directory can
 * still be missing — and CI runs `pnpm test` *before* `pnpm build`, so this file scanned it
 * in the one place it was guaranteed to be missing. It passed on every development machine,
 * where a build had already created it, and failed on the first CI run with `ENOENT: scandir`.
 *
 * A missing directory is also the honest answer to the question being asked: a service
 * worker that is not on disk is a service worker that does not exist, which is exactly what
 * the caller wants to know. Nothing below reads `apps/web/out` for the same reason turned up
 * a level — the export does not exist when this suite runs, so a check that needed it would
 * be a check that could only pass by accident.
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
 * is also the filter the registration search walks with, so the first `Foo.test.tsx` in this
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

/**
 * The past tense, which is the one thing a denial can be and still be true.
 *
 * `DENIALS` reads for a shape of words and cannot read a tense, so "there **was** no service
 * worker" matched exactly as "there **is** no service worker" did. That put this guard in
 * contradiction with its own failure message, which asks for history to keep "the past tense
 * it was always owed, not deletion" — and then failed three sentences that had done precisely
 * that. Two of them were the records of the correction that built the worker, in the files
 * that document it; deleting them for a green run would have destroyed the account of why the
 * worker exists in order to satisfy a test about the worker existing.
 *
 * **The tense has to be bound to the denial, not merely present in the sentence.** The first
 * version of this looked for a past-tense word anywhere in the sentence, and its own negative
 * case caught it out: "The answer we gave **was** that there **is** no service worker" is a
 * live denial with a past-tense verb in it, and it was excused. So the marker is the word
 * immediately governing the denial — `was no service worker`, `contained no offline cache` —
 * and nothing further away counts.
 *
 * Narrow on purpose. Everything it does not recognise fails closed, which is a sentence
 * somebody has to look at rather than a claim nobody checks.
 */
const PAST_TENSE = /\b(?:was|were|had|contained|held|used to (?:be|have)|never had)\s*$/i;

/** How far back to look for the verb governing a denial. One clause, not one paragraph. */
const GOVERNS = 26;

/**
 * Is every denial in this sentence about the past?
 *
 * Every, not any: a sentence carrying a historical note *and* a live denial is still telling
 * the reader something false, and the historical half must not excuse the other one.
 */
function deniesInPresent(sentence: string): boolean {
  for (const pattern of DENIALS) {
    const scan = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
    let hit: RegExpExecArray | null;
    while ((hit = scan.exec(sentence)) !== null) {
      const before = sentence.slice(Math.max(0, hit.index - GOVERNS), hit.index);
      if (!PAST_TENSE.test(before)) return true;
    }
  }
  return false;
}

const matches = (patterns: readonly RegExp[], text: string): boolean =>
  patterns.some((pattern) => pattern.test(text));

const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/);

/** A span of prose claims something a service worker has to be there to keep. */
const claimsOffline = (text: string): boolean =>
  (matches(RELATIVE, text) && !matches(HEDGES, text)) ||
  sentences(text).some((sentence) => matches(ABSOLUTE, sentence) && !matches(HEDGES, sentence));

/**
 * A span of prose tells the reader, *now*, that there is no offline support.
 *
 * Sentence by sentence, so a span mixing a historical note with a live denial is caught on
 * the live one. A sentence that denies and is about the past is history, and history is what
 * this repository keeps rather than tidies away — see {@link HISTORY}.
 */
const deniesOffline = (text: string): boolean => sentences(text).some(deniesInPresent);

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
 * One of the four things that have to be true before this repository may claim to work with
 * no connection.
 *
 * `detail` is the whole value of the type. A boolean would tell somebody the claim is
 * unbacked; this tells them which of the four is missing and, where it can, the file to open.
 * The header of this file explains why there are four rather than one.
 */
interface Backing {
  readonly what: string;
  readonly held: boolean;
  readonly detail: string;
}

const WORKER_SCRIPT = 'the worker script';
const EMIT_STEP = 'the step that finishes the worker';
const BUILD_RUNS_EMIT = 'the build running that step';
const MOUNTED = 'the registration being mounted';

/**
 * What a file that registers a worker looks like: it names the API, and it calls `register`.
 *
 * Both halves, and the second one was added after watching the failure message without it.
 * Naming the API alone is what the first version of this file asked, and two shipped files in
 * `apps/web/src` name it without registering anything: `lib/offline-state.ts` quotes
 * `navigator.serviceWorker` in a docstring explaining why the DOM types lie about it, and
 * `lib/offline-ready.ts` *reads* `navigator.serviceWorker.controller` to decide whether a game
 * is held on this device. With a mention as the whole test, the message reporting an unmounted
 * bridge ran to nine imports and buried the one line naming `app/layout.tsx` under eight
 * about `offline-state.ts` — a failure nobody reads to the end is a failure that gets re-run
 * rather than fixed.
 *
 * The call is matched as a bare `.register(` rather than as `navigator.serviceWorker.register(`
 * because that is not the shape the bridge uses: it assigns the container to a local and calls
 * `container.register(...)` on the line after. Two loose halves that must both hold is what
 * separates the file that starts a worker from the two that merely know one exists.
 */
const MENTIONS_THE_WORKER_API = /navigator\.serviceWorker|ServiceWorkerRegistration/;
const CALLS_REGISTER = /\.register\s*\(/;

const registersAWorker = (source: string): boolean =>
  MENTIONS_THE_WORKER_API.test(source) && CALLS_REGISTER.test(source);

/** A worker script, by the two names a static export would serve one under. */
const IS_WORKER_FILE = /^(?:sw|service-worker)\.[cm]?js$/;

/**
 * The listeners that separate a worker from a file with the right name.
 *
 * `install` is what fills the cache and `fetch` is what serves out of it; a script with
 * neither can register, activate, control every page on the site and change nothing about
 * what happens when the connection goes. `sw.js` names four listeners in its own contract
 * and promises never to grow a fifth, so this is the pair worth holding and not a list of
 * everything it happens to have.
 */
const WORKER_LISTENS_FOR: readonly string[] = ['install', 'fetch'];

/**
 * A token the worker ships with and the emit step is supposed to replace.
 *
 * Derived from the worker rather than listed here, so a fourth placeholder added to `sw.js`
 * is a placeholder this asks about on the next run. That is the whole point: the failure it
 * guards against is a worker and an emitter that agree on two names out of three, which
 * produces a worker that installs, claims the page and precaches the literal string
 * `'__PRECACHE__'`.
 */
const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;

/** Import specifiers, in both the static and the dynamic form. */
const SPECIFIER = /(?:from|import)\s*\(?\s*'([^']+)'/g;

/**
 * A whole static import, so the *bindings* can be read and not just the module.
 *
 * `[^;]` rather than `[\s\S]` is what stops a side-effect import — `import './globals.css';`,
 * which the root layout ends on — from swallowing the span up to the next `from '` and
 * reporting one import statement made of two.
 */
const IMPORT_STATEMENT = /import\s+([^;]*?)\s+from\s+'([^']+)'/g;

/**
 * Resolve an import the way the app's own tsconfig does, or refuse to guess.
 *
 * The shape is `lib/landing.test.ts`'s, down to the throw, and for its reason: a specifier
 * this cannot resolve is a subtree it stops walking, and a walk that quietly stops is how a
 * guard passes while the thing it guards is missing. `webDir` is a parameter rather than the
 * module-level constant so the fixtures at the bottom can run the same resolver over a tree
 * built for the occasion.
 */
function resolveImport(webDir: string, from: string, specifier: string): string | null {
  if (specifier.endsWith('.css')) return null;
  let base: string;
  if (specifier.startsWith('@/')) base = join(webDir, 'src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = join(dirname(from), specifier);
  // A package: `react`, `next/link`, `@duelbox/engine`. Not ours to walk.
  else return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    base.replace(/\.js$/, '.ts'),
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`offline-claims.test.ts cannot resolve "${specifier}" from ${from}`);
}

/** Every module reachable from an entry point, by static or dynamic import. */
function graphFrom(webDir: string, entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const path = queue.pop();
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const resolved = resolveImport(webDir, path, specifier);
      if (resolved !== null) queue.push(resolved);
    }
  }
  return [...seen];
}

/**
 * The local names an import clause brings into a file.
 *
 * Type-only imports are dropped, because a type cannot be rendered and a file that imports
 * only the type of a bridge is not mounting one. `import * as ns` is dropped too and that is
 * a known blind spot rather than an oversight: nothing in `apps/web` renders a component
 * through a namespace, and pretending to handle `ns.Bridge` here would be a line nobody has
 * ever seen run. If that day comes this returns nothing, the mount test fails, and the
 * failure says the import was never rendered — wrong in its reason, right in its verdict,
 * and pointing at the file to fix.
 */
function bindingsOf(clause: string): string[] {
  if (/^\s*type\b/.test(clause)) return [];
  const names: string[] = [];
  const braced = /\{([^}]*)\}/.exec(clause);
  const bare = clause
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/,/g, ' ')
    .trim();
  if (bare !== '' && !bare.startsWith('*')) names.push(bare);
  for (const part of (braced?.[1] ?? '').split(',')) {
    const trimmed = part.trim();
    // `{ type LandingSection }` is dropped rather than stripped, for the same reason
    // `import type` is: an inline type specifier brings in a type, and a type is not a
    // component. Stripping the keyword and keeping the name would report a file that imports
    // a props interface as a file that could be rendering the bridge.
    if (trimmed === '' || /^type\s/.test(trimmed)) continue;
    const renamed = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(trimmed);
    names.push(renamed?.[1] ?? trimmed);
  }
  return names.filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

/**
 * Is this binding actually in the markup the file returns?
 *
 * Two forms, because this shell uses two. `<Bridge` is a component being rendered.
 * `__html:` is the other one the root layout already relies on — the theme script and the
 * frame guard are both strings imported from elsewhere and injected with
 * `dangerouslySetInnerHTML`, and a registration written that way rather than as a client
 * component would be a reasonable thing to do under a shell budget with five hundred bytes
 * in it. Neither form is satisfied by an import sitting unused at the top of a file, which is
 * the whole reason this function exists rather than reachability being the end of it.
 */
function usedInMarkup(source: string, name: string): boolean {
  return (
    new RegExp(String.raw`<${name}\b`).test(source) ||
    new RegExp(String.raw`__html:[^}]*\b${name}\b`).test(source)
  );
}

/** Every `sw.js` or `service-worker.js` this export would serve. */
function workerScripts(webDir: string): string[] {
  return walk(join(webDir, 'public'), (path) => IS_WORKER_FILE.test(basename(path)));
}

function backedByAWorkerScript(rootDir: string, webDir: string): Backing {
  const scripts = workerScripts(webDir);
  if (scripts.length === 0) {
    return {
      what: WORKER_SCRIPT,
      held: false,
      detail: 'apps/web/public holds no sw.js, so nothing is served to register',
    };
  }
  const real = scripts.filter((path) => {
    const source = readFileSync(path, 'utf8');
    return WORKER_LISTENS_FOR.every((event) =>
      new RegExp(String.raw`addEventListener\(\s*'${event}'`).test(source),
    );
  });
  const first = real[0];
  if (first === undefined) {
    return {
      what: WORKER_SCRIPT,
      held: false,
      detail:
        `${scripts.map((path) => relative(rootDir, path)).join(', ')} exists but never listens` +
        ` for ${WORKER_LISTENS_FOR.join(' and ')}, so it caches nothing and serves nothing`,
    };
  }
  return {
    what: WORKER_SCRIPT,
    held: true,
    detail: `${relative(rootDir, first)} listens for ${WORKER_LISTENS_FOR.join(' and ')}`,
  };
}

function backedByAnEmitStep(rootDir: string, webDir: string): Backing {
  const emit = join(rootDir, 'scripts', 'emit-service-worker.mjs');
  if (!existsSync(emit)) {
    return {
      what: EMIT_STEP,
      held: false,
      detail:
        'scripts/emit-service-worker.mjs does not exist, so the worker ships with the' +
        ' placeholders it was written with',
    };
  }
  const emitter = readFileSync(emit, 'utf8');
  const placeholders = new Set<string>();
  for (const path of workerScripts(webDir)) {
    for (const token of readFileSync(path, 'utf8').matchAll(PLACEHOLDER))
      placeholders.add(token[0]);
  }
  const unfilled = [...placeholders].filter((token) => !emitter.includes(token));
  if (unfilled.length > 0) {
    return {
      what: EMIT_STEP,
      held: false,
      detail:
        `scripts/emit-service-worker.mjs never mentions ${unfilled.join(', ')}, which the` +
        ' worker ships with — whatever it is meant to become, it stays that literal string',
    };
  }
  return {
    what: EMIT_STEP,
    held: true,
    detail: `scripts/emit-service-worker.mjs fills ${[...placeholders].join(', ') || 'nothing'}`,
  };
}

function backedByTheBuild(rootDir: string): Backing {
  const manifest = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const scripts = manifest.scripts ?? {};
  const step = scripts['emit:service-worker'] ?? '';
  const build = scripts.build ?? '';
  if (!step.includes('emit-service-worker.mjs')) {
    return {
      what: BUILD_RUNS_EMIT,
      held: false,
      detail: 'package.json has no "emit:service-worker" script running that file',
    };
  }
  if (!build.includes('emit:service-worker')) {
    return {
      what: BUILD_RUNS_EMIT,
      held: false,
      detail:
        'package.json\'s "build" script never runs "emit:service-worker", so the generator' +
        ' exists and nothing calls it',
    };
  }
  return { what: BUILD_RUNS_EMIT, held: true, detail: '"build" runs "emit:service-worker"' };
}

/**
 * The check this file was rewritten for: is anything actually registering the worker?
 *
 * Three failures, reported apart because the fix for each is a different edit. Nothing
 * registers at all. Something registers and the root layout's import graph never reaches it —
 * a component on disk with no caller, which is the state this branch was in for an hour while
 * this file was busy declaring the feature shipped. Something is reached and imported and
 * never appears in any markup, which is the same defect with the import written.
 */
function backedByAMountedRegistration(rootDir: string, webDir: string): Backing {
  const layout = join(webDir, 'src', 'app', 'layout.tsx');
  const where = relative(rootDir, layout);
  if (!existsSync(layout)) {
    return { what: MOUNTED, held: false, detail: `there is no root layout at ${where}` };
  }
  const registrars = walk(join(webDir, 'src'), isProseSource).filter((path) =>
    registersAWorker(readFileSync(path, 'utf8')),
  );
  if (registrars.length === 0) {
    return {
      what: MOUNTED,
      held: false,
      detail: 'nothing under apps/web/src registers a service worker',
    };
  }
  const graph = graphFrom(webDir, layout);
  const reached = registrars.filter((path) => graph.includes(path));
  if (reached.length === 0) {
    return {
      what: MOUNTED,
      held: false,
      detail:
        `${registrars.map((path) => relative(rootDir, path)).join(', ')} registers a worker,` +
        ` and nothing in ${where}'s import graph reaches it — a component with no caller` +
        ' registers nothing, on every route, with no symptom but the feature not existing',
    };
  }
  // A set, because a module is routinely imported from several places and the same "imported
  // and never rendered" line repeated six times is how the useful half of a message scrolls
  // off the top of a run log.
  const unrendered = new Set<string>();
  for (const importer of graph) {
    const source = readFileSync(importer, 'utf8');
    for (const statement of source.matchAll(IMPORT_STATEMENT)) {
      const clause = statement[1];
      const specifier = statement[2];
      if (clause === undefined || specifier === undefined) continue;
      const resolved = resolveImport(webDir, importer, specifier);
      if (resolved === null || !reached.includes(resolved)) continue;
      for (const name of bindingsOf(clause)) {
        if (usedInMarkup(source, name)) {
          return {
            what: MOUNTED,
            held: true,
            detail: `${relative(rootDir, importer)} renders ${name} from ${relative(rootDir, resolved)}`,
          };
        }
        unrendered.add(
          `${relative(rootDir, importer)} imports ${name} from ${relative(rootDir, resolved)}`,
        );
      }
    }
  }
  return {
    what: MOUNTED,
    held: false,
    detail:
      `${[...unrendered].join('; ') || `${where} reaches a registrar by no named import`} —` +
      ' imported and never rendered, which registers exactly as much as not importing it',
  };
}

/**
 * The four questions, asked of a tree. A claim is allowed only when all four say yes.
 *
 * The mount question is wrapped because it is the only one that can *throw*: `resolveImport`
 * refuses to guess at a specifier it cannot resolve, and this whole computation runs at module
 * scope so that `it.runIf` can be decided at collection time. An escaping throw would take the
 * file down before a single test ran, including the eight fixtures below that exist to say
 * what this file can and cannot detect — so the throw becomes a fourth kind of "not held".
 *
 * That verdict is a refusal to certify and the wording says so. It is not the same sentence as
 * "nothing is mounted", and it must not be read as one: what has happened is that the import
 * graph grew a shape this resolver has never seen, and until somebody teaches it that shape
 * nothing here is in a position to let a claim through. Erring towards the unbacked half is the
 * safe direction — it asks for a claim to be proved rather than assuming it — and the detail
 * names the specifier and the file, which is the whole of the fix.
 */
function serviceWorkerBacking(rootDir: string): Backing[] {
  const webDir = join(rootDir, 'apps', 'web');
  let mounted: Backing;
  try {
    mounted = backedByAMountedRegistration(rootDir, webDir);
  } catch (error) {
    mounted = {
      what: MOUNTED,
      held: false,
      detail:
        `this file could not read the import graph, so it cannot tell — ${String(error)}. That` +
        ' is a gap in offline-claims.test.ts rather than a verdict on the registration: teach' +
        ' resolveImport the shape, then read this line again',
    };
  }
  return [
    backedByAWorkerScript(rootDir, webDir),
    backedByAnEmitStep(rootDir, webDir),
    backedByTheBuild(rootDir),
    mounted,
  ];
}

/** Does the spec still do the thing that makes the surviving claim a fact? */
const cutsTheNetwork = (spec: string): boolean =>
  /page\.route\(\s*'\*\*\/\*'/.test(spec) && /route\.abort\(\)/.test(spec);

const backing = serviceWorkerBacking(root);
const missing = backing.filter((entry) => !entry.held);
const backed = missing.length === 0;
const describeBacking = ({ what, detail }: Backing): string => `${what} — ${detail}`;

describe('the offline claim, and the service worker that has to be behind it', () => {
  /**
   * The claim is allowed if and only if it is backed, and this is the "only if".
   *
   * What it fails on is the *backing*, not the sentence, and that inversion is the lesson of
   * the hour this file spent pointing the wrong way. When the README promises a cold start
   * with no connection and the bridge is never mounted, the defect is the bridge; listing the
   * README as the offender would send somebody to delete a sentence that is about to become
   * true. So the missing backing is what has to reach `[]`, and the claims riding on it are
   * named in the message as the reason it matters.
   *
   * It runs whichever way the fact goes, unlike the half below, because there is no state of
   * the tree in which it is meaningless: with nothing built and nothing claimed it passes
   * having found nothing to hold, which is the honest verdict on a repository that is quiet
   * about a feature it does not have.
   */
  it('is made only where a working service worker backs it', () => {
    const claims = sites(claimsOffline, CLAIMS).map(describeLine);
    const unbacked = claims.length === 0 ? [] : missing.map(describeBacking);
    expect(
      unbacked,
      `${String(claims.length)} place(s) in this repository claim the site works with no` +
        ' network, and the worker behind that claim is incomplete. Finish the piece listed' +
        ' above, or say only what is true — a loaded page needs nothing — until it is' +
        ` finished. The claims resting on it:\n${claims.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * And this is the "if": once the worker is genuinely there, a file still denying it is
   * telling the reader something false about their own device.
   *
   * Skipped rather than inverted while the backing is incomplete, because every one of those
   * sentences is *true* until the fourth question says yes. That is not a formality — this
   * test ran on a half-built branch and demanded twelve accurate sentences be rewritten.
   */
  it.runIf(backed)('is now made everywhere it was denied', () => {
    expect(
      sites(deniesOffline, DENIALS).map(describeLine),
      `a service worker is now backed — ${backing.map(describeBacking).join('; ')} — and these` +
        ' still tell the reader it does not exist. Rewrite them, and say in each what the' +
        ' worker does and does not cache. A sentence that is history rather than a live denial' +
        ' needs the past tense it was always owed, not deletion.',
    ).toEqual([]);
  });
});

/**
 * The detectors, shown the lines they exist to find and the lines they must not.
 *
 * CLAUDE.md counts seven guards nobody watched fail and then the sentence that generalises
 * them: the one to distrust is the one in the docstring, not the one in the code. Everything
 * above decides which half of this file runs by searching a tree, and a search for a string
 * nothing has ever contained comes back empty for ever. So each predicate is given a positive
 * and a negative case, and the four-part fact is given a whole tree and then eight broken ones.
 */
describe('what this file knows a service worker looks like', () => {
  it('reads a denial in the present tense, and lets a record of the past stand', () => {
    // The four shapes it exists to catch, live.
    expect(deniesOffline('There is no service worker and no cache manifest.')).toBe(true);
    expect(deniesOffline('Coming back does need a connection.')).toBe(true);
    expect(deniesOffline('That is not the same as working offline.')).toBe(true);
    expect(deniesOffline('There is no offline cache yet.')).toBe(true);

    // The three sentences that were actually failing when this was added, all of them true,
    // all of them the record of the correction that built the worker. A guard that demands
    // these be rewritten is asking for the account of why the worker exists to be destroyed
    // in order to satisfy a test about the worker existing.
    expect(
      deniesOffline(
        'When this was written it was true of a page already open and only that:' +
          ' there was no service worker, so a reload with the network down failed.',
      ),
    ).toBe(false);
    expect(
      deniesOffline(
        'README.md line 4 and CLAUDE.md line 5 both called the product' +
          ' "offline-capable" while the repository contained no service worker of any kind.',
      ),
    ).toBe(false);
    expect(
      deniesOffline(
        'Was true for an already-loaded page and not for a cold load, because' +
          ' there was no service worker.',
      ),
    ).toBe(false);

    // And the shape the narrowing is for: a paragraph that opens with history and closes
    // with a live denial still fails, on the second sentence. This is why the excuse is
    // per-sentence rather than per-span, and it is the case that would silently rot if the
    // marker were allowed to reach across a full stop.
    expect(
      deniesOffline('There was no service worker until September. There is no offline cache.'),
    ).toBe(true);
    // A live denial wearing a past-tense word is not history. `was` alone must not excuse it.
    expect(deniesOffline('The answer we gave was that there is no service worker.')).toBe(true);
  });

  it('recognises a registration, and does not recognise a file that merely knows about one', () => {
    expect(registersAWorker("navigator.serviceWorker.register('./sw.js')")).toBe(true);
    // The shape the bridge actually uses: the container in a local, the call on the next line.
    expect(
      registersAWorker(
        'const container = navigator.serviceWorker;\n' + "void container.register('/sw.js');",
      ),
    ).toBe(true);
    expect(registersAWorker('const registration = null;')).toBe(false);
    // The two false positives actually measured in this tree, both of which made the mount
    // failure unreadable before the `.register(` half was added: a file that reads
    // `controller`, and a docstring quoting the property name. A reader is not a registrar.
    // The third is the other half of the conjunction, not measured but the reason it is a
    // conjunction: `.register(` alone would call every form library a service worker.
    expect(registersAWorker('if (navigator.serviceWorker.controller === null) return null;')).toBe(
      false,
    );
    expect(registersAWorker(' * `navigator.serviceWorker` is always there, which is a lie')).toBe(
      false,
    );
    expect(registersAWorker("void form.register('name');")).toBe(false);
    // A test is where a mention of the API that is not a registration lives, so a test read
    // as product source is the other way this decides wrongly — the expensive way, because it
    // flips the halves rather than silencing them.
    expect(isProseSource(join(web, 'src', 'app', 'page.tsx'))).toBe(true);
    expect(isProseSource(join(web, 'src', 'lib', 'offline-claims.test.ts'))).toBe(false);
    expect(isProseSource(join(web, 'src', 'components', 'Install.test.tsx'))).toBe(false);
  });

  it('separates the file that starts a worker from the files that only know about one', () => {
    // The other direction of the same question, and the one a literal cannot answer: run both
    // halves over the real `apps/web/src` and see whether the second half is doing any work.
    //
    // Not a list of filenames. Pinning the registrar to one path would fail the day somebody
    // sensibly moves the registration into a hook, and a test that fails when nothing is
    // broken is a test somebody deletes. What is asserted instead is the shape that made the
    // second half worth adding: something registers, and strictly more files than that name
    // the API — today `lib/offline-state.ts` in a docstring and `lib/offline-ready.ts` reading
    // `controller` to decide whether a game is held here. If that inequality ever collapses,
    // the discrimination has stopped discriminating and the failure message goes back to
    // burying the one line that names the layout.
    const sources = walk(join(web, 'src'), isProseSource).map((path) => ({
      at: relative(web, path),
      text: readFileSync(path, 'utf8'),
    }));
    const mentions = sources.filter((file) => MENTIONS_THE_WORKER_API.test(file.text));
    const registrars = mentions.filter((file) => CALLS_REGISTER.test(file.text));
    expect(registrars.map((file) => file.at)).toContain('src/components/ServiceWorkerBridge.tsx');
    expect(
      mentions.length,
      `${String(mentions.length)} files name the worker API and ${String(registrars.length)}` +
        ' register one; if those are the same set, this predicate has one half',
    ).toBeGreaterThan(registrars.length);
  });

  it('reads the bindings out of an import, and drops the ones that cannot be rendered', () => {
    expect(bindingsOf('{ ServiceWorkerBridge }')).toEqual(['ServiceWorkerBridge']);
    expect(bindingsOf('{ Bridge as Mounted }')).toEqual(['Mounted']);
    expect(bindingsOf('Default, { Named }')).toEqual(['Default', 'Named']);
    // A type cannot be rendered, and a namespace import is the blind spot the docstring owns.
    expect(bindingsOf('type { Metadata }')).toEqual([]);
    expect(bindingsOf('{ type LandingSection }')).toEqual([]);
    expect(bindingsOf('* as landing')).toEqual([]);
  });

  it('tells a rendered component from an imported one', () => {
    expect(usedInMarkup('return <ServiceWorkerBridge />;', 'ServiceWorkerBridge')).toBe(true);
    expect(
      usedInMarkup('return <ServiceWorkerBridge>x</ServiceWorkerBridge>;', 'ServiceWorkerBridge'),
    ).toBe(true);
    expect(
      usedInMarkup('<script dangerouslySetInnerHTML={{ __html: FRAME_GUARD }} />', 'FRAME_GUARD'),
    ).toBe(true);
    // The defect itself: imported, never rendered.
    expect(
      usedInMarkup("import { Bridge } from '@/components/Bridge';\nreturn null;", 'Bridge'),
    ).toBe(false);
    // And a name that merely contains another name is not that name.
    expect(usedInMarkup('return <ServiceWorkerBridgeStub />;', 'ServiceWorkerBridge')).toBe(false);
  });

  it('walks the real import graph out of the root layout, and stops where there is nothing', () => {
    const layout = join(web, 'src', 'app', 'layout.tsx');
    const graph = graphFrom(web, layout).map((path) => relative(web, path));
    // Not an assertion about the count. It is the assertion that the walk walked: the layout
    // reaches these by three different routes, and a walk that resolved nothing would satisfy
    // the mount check's negative branch having read one file.
    expect(graph).toContain('src/app/frame-guard.ts');
    expect(graph).toContain('src/components/SiteHeader.tsx');
    expect(graph).toContain('src/lib/site.ts');
    expect(graph.length).toBeGreaterThan(5);
    // The negative control, on the real tree: a leaf module reaches nothing, so the walker is
    // capable of returning a graph that would fail the mount check.
    expect(graphFrom(web, join(web, 'src', 'app', 'base-path.ts'))).toHaveLength(1);
  });
});

/**
 * The four-part fact, watched failing four ways.
 *
 * A tree with all four pieces in it is built in a temporary directory, and then four copies
 * of it are each broken in one place. This is the cheapest available version of the habit
 * CLAUDE.md names — run the thing that is supposed to execute the rule and watch it fail on
 * purpose — and it is permanent rather than something somebody once did by hand.
 *
 * A fixture rather than the repository itself for the obvious reason: the assertions have to
 * hold on a tree with no worker in it as well as on one with, and this file cannot delete
 * `apps/web/public/sw.js` to find out. Everything the fact reads is a file, so a directory
 * with five files in it is a complete subject.
 */
describe('the four things that have to be true, each watched failing', () => {
  const LAYOUT_MOUNTING =
    "import { Bridge } from '@/components/Bridge';\n" +
    'export default function RootLayout() {\n  return <Bridge />;\n}\n';
  const BRIDGE =
    "'use client';\nexport function Bridge() {\n" +
    "  void navigator.serviceWorker.register('/sw.js');\n  return null;\n}\n";
  const WORKER =
    "const PRECACHE = ['__PRECACHE__'];\nvoid PRECACHE;\n" +
    "self.addEventListener('install', () => {});\nself.addEventListener('fetch', () => {});\n";
  const EMITTER = "// substitutes '__PRECACHE__' into the worker\n";
  const MANIFEST = JSON.stringify({
    scripts: {
      build: 'next build && pnpm emit:host-config && pnpm emit:service-worker && pnpm size',
      'emit:service-worker': 'node scripts/emit-service-worker.mjs',
    },
  });

  /**
   * Build the whole tree, let the caller break one thing, and report what stopped holding.
   *
   * The mutation runs against a directory that is already complete and already passing, so a
   * case that reports a failure has reported the consequence of its own edit and nothing else.
   */
  function afterBreaking(damage: (dir: string) => void = () => undefined): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'duelbox-offline-claims-'));
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      mkdirSync(join(dir, 'apps', 'web', 'public'), { recursive: true });
      mkdirSync(join(dir, 'apps', 'web', 'src', 'app'), { recursive: true });
      mkdirSync(join(dir, 'apps', 'web', 'src', 'components'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), MANIFEST);
      writeFileSync(join(dir, 'scripts', 'emit-service-worker.mjs'), EMITTER);
      writeFileSync(join(dir, 'apps', 'web', 'public', 'sw.js'), WORKER);
      writeFileSync(join(dir, 'apps', 'web', 'src', 'components', 'Bridge.tsx'), BRIDGE);
      writeFileSync(join(dir, 'apps', 'web', 'src', 'app', 'layout.tsx'), LAYOUT_MOUNTING);
      damage(dir);
      return serviceWorkerBacking(dir)
        .filter((entry) => !entry.held)
        .map((entry) => entry.what);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('holds on a tree with a worker, an emitter, a build step and a mounted bridge', () => {
    // The control. Without this line the four cases below would pass on a fixture that was
    // broken to begin with, which is the way a negative test lies.
    expect(afterBreaking()).toEqual([]);
  });

  it('notices a worker script that is not there', () => {
    expect(afterBreaking((dir) => rmSync(join(dir, 'apps', 'web', 'public', 'sw.js')))).toEqual([
      WORKER_SCRIPT,
    ]);
  });

  it('notices a worker script that listens for nothing', () => {
    expect(
      afterBreaking((dir) =>
        writeFileSync(join(dir, 'apps', 'web', 'public', 'sw.js'), '// nothing yet\n'),
      ),
    ).toEqual([WORKER_SCRIPT]);
  });

  it('notices the emit step missing', () => {
    expect(afterBreaking((dir) => rmSync(join(dir, 'scripts', 'emit-service-worker.mjs')))).toEqual(
      [EMIT_STEP],
    );
  });

  it('notices an emit step that leaves a placeholder unfilled', () => {
    expect(
      afterBreaking((dir) =>
        writeFileSync(join(dir, 'scripts', 'emit-service-worker.mjs'), '// fills nothing\n'),
      ),
    ).toEqual([EMIT_STEP]);
  });

  it('notices a build that never runs the emit step', () => {
    expect(
      afterBreaking((dir) =>
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            scripts: {
              build: 'next build && pnpm size',
              'emit:service-worker': 'node scripts/emit-service-worker.mjs',
            },
          }),
        ),
      ),
    ).toEqual([BUILD_RUNS_EMIT]);
  });

  /**
   * The two that matter, and the reason this file was rewritten.
   *
   * Both of these trees contain a complete, correct, well-commented service worker, a
   * complete emitter, a build that runs it and a bridge that registers. Neither of them
   * registers anything for anybody, and the old version of this file called both of them a
   * shipped feature.
   */
  it('notices a bridge the root layout never imports', () => {
    expect(
      afterBreaking((dir) =>
        writeFileSync(
          join(dir, 'apps', 'web', 'src', 'app', 'layout.tsx'),
          'export default function RootLayout() {\n  return null;\n}\n',
        ),
      ),
    ).toEqual([MOUNTED]);
  });

  it('refuses to certify a graph it cannot walk, rather than taking the whole file down', () => {
    // The escape hatch, watched working. An import this resolver cannot follow leaves the
    // mount question unanswered, and an unanswered question is not a yes — but the other
    // three still report, and the seven cases above still run, which is the point of catching
    // it here rather than letting it escape from module scope.
    const missingImport = afterBreaking((dir) =>
      writeFileSync(
        join(dir, 'apps', 'web', 'src', 'app', 'layout.tsx'),
        "import { Bridge } from '@/components/Bridge';\n" +
          "import { Gone } from './a-file-that-is-not-there';\n" +
          'export default function RootLayout() {\n  return <Bridge />;\n}\n',
      ),
    );
    expect(missingImport).toEqual([MOUNTED]);
  });

  it('notices a bridge the root layout imports and never renders', () => {
    expect(
      afterBreaking((dir) =>
        writeFileSync(
          join(dir, 'apps', 'web', 'src', 'app', 'layout.tsx'),
          "import { Bridge } from '@/components/Bridge';\nvoid Bridge;\n" +
            'export default function RootLayout() {\n  return null;\n}\n',
        ),
      ),
    ).toEqual([MOUNTED]);
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
    // a spec that loads a page and does nothing else.
    expect(cutsTheNetwork("await page.goto('/play/tic-tac-toe/');")).toBe(false);
  });
});
