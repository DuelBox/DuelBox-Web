import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../data/catalogue.generated';

/**
 * What the site says it is, held against what it does.
 *
 * `app/layout.tsx` carries the `description`, the `og:description` and the `twitter`
 * description that all 223 exported pages inherit unless they set their own. That makes a
 * sentence in it the most-repeated sentence on the site and, until this file, the one
 * nothing could fail: it is metadata, so no visitor reads it on the page, no e2e spec
 * asserts it, and the two guards that do read prose are aimed elsewhere —
 * `privacy-claims.test.ts` at the privacy page, `offline-claims.test.ts` at the offline
 * claim in particular.
 *
 * It was wrong twice at once. It promised play "across two devices", which this build has
 * no route, transport or signalling for, and it counted "a hundred and seven" games two
 * lines under a title that says 108. The first of those was found only because #102
 * rewrote the landing page and took the identical claim out of the hero and out of a card
 * that offered it as one of three ways to play — the visible copy was corrected and the
 * `<meta>` tag underneath it was not, which left the page contradicting itself, and left
 * the same sentence standing on the catalogue page as well.
 *
 * So this is written the way `privacy-claims.test.ts` is written, and deliberately no
 * wider: it checks the two claims that were wrong and the two facts that make them
 * checkable. A test that set out to verify the product's marketing in general would
 * verify nothing.
 *
 * The two facts, both read from the tree rather than restated here:
 *
 *   - **How many games there are** — `CATALOGUE.length`, imported.
 *   - **Which modes a player can actually choose** — the `PlayMode` union in
 *     `lib/match-setup.ts`, read out of the source. That union is the whole of what the
 *     lobby offers; `PlaySurface` renders a button per member and nothing else. When a
 *     cross-device mode is genuinely built, its member lands there, and the two halves of
 *     the first test below swap over on their own.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const root = join(web, '..', '..', '..');

/**
 * Every source file under `apps/web/src` a visitor can be shown words from, tests aside.
 *
 * `catalogue.generated.ts` is deliberately in rather than out. It is generated, so a
 * failure in it is fixed in `data/catalog.yaml` and regenerated rather than edited — but
 * it also holds all 108 rule blurbs, which is more player-facing prose than the rest of
 * this tree put together, and exempting a file because it is inconvenient to fix is how a
 * scan comes to cover everything except where the words are.
 */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) found.push(path);
  }
  return found;
}

/**
 * The file with its explanatory comments removed.
 *
 * A claim reaches a visitor only if it is in something the page renders, and a comment
 * never is — which is also what keeps this test from firing on the comments that explain
 * the correction, in this file and in the three it guards. Block comments cover the
 * `{/* … *\/}` form JSX uses. A line comment is only recognised at the start of a line, so
 * that the `//` in a `https://` inside a string cannot swallow the rest of it.
 */
function rendered(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/**
 * The modes the lobby can actually offer, from the union that defines them.
 *
 * Read as a set of string-literal members rather than tested for one name, so that this
 * says "what is on offer" rather than "whether somebody wrote the word remote".
 */
function modesIn(source: string): Set<string> {
  const union = /export type PlayMode =([^;]+);/.exec(source);
  const body = union?.[1];
  if (body === undefined) {
    throw new Error(
      'lib/match-setup.ts no longer declares `export type PlayMode = …`, so this file can' +
        ' no longer tell what a player is offered. Point it at whatever replaced it.',
    );
  }
  const found = new Set<string>();
  for (const member of body.matchAll(/'([a-z-]+)'/g)) {
    if (member[1] !== undefined) found.add(member[1]);
  }
  return found;
}

/**
 * The reader itself, split from the file it reads so that both can be exercised.
 *
 * The self-check below used to compare two hard-coded lists to each other and could not fail;
 * with `modesIn` taking a string, the direction that decides whether this guard ever flips —
 * a union that *does* declare a remote member — can be handed to the real parser.
 */
function playModes(): Set<string> {
  return modesIn(readFileSync(join(web, 'lib', 'match-setup.ts'), 'utf8'));
}

/**
 * A mode that puts the two players on separate devices. `solo` and `bot` both fill the
 * second seat on the one device in front of you; neither is a second device.
 */
const REMOTE_MODES = ['remote', 'online', 'link', 'host', 'join', 'pair'];
const modes = playModes();
const hasRemotePlay = REMOTE_MODES.some((mode) => modes.has(mode));

/**
 * The phrasings this repository has actually used to promise a match across two devices.
 *
 * As with `offline-claims.test.ts`, this knows only the wordings that have been written
 * here — a new one gets through, and the answer when one is found is to add it, not to
 * assume the list was ever complete.
 *
 * The first version of this list did not catch the most prominent one it had ever used. The
 * hero's lede read "play from your own device against a friend anywhere", and the nearest
 * pattern demanded *on* your own device, so pasting the exact sentence #102 deleted back into
 * `app/page.tsx` left this green. A list of phrasings that misses the phrasing it was written
 * for is a list nobody has checked, which is why {@link DELETED} is now below it: every
 * sentence this batch removed is held against the patterns on every run.
 */
const CROSS_DEVICE = [
  /\bacross two (?:different )?devices\b/i,
  /\b(?:from|on) (?:your|their) own device\b/i,
  /\bagainst a friend anywhere\b/i,
  /\btwo devices,? anywhere\b/i,
  /\bplay (?:across|from) the (?:room|world)\b/i,
  /\bopen a link on the other device\b/i,
];

/**
 * The sentences that were on this site and are not any more, verbatim.
 *
 * Quoted from the copy #102 took out — the hero's lede, the second "way to play" card, and
 * the catalogue page's line — so that the patterns above are measured against the words they
 * exist to prevent rather than against a phrase invented to suit them. Anything added here
 * has to have been rendered somewhere, or this stops being evidence.
 */
const DELETED = [
  'Share one phone, or play from your own device against a friend anywhere.',
  'Two devices, anywhere',
  'Open a link on the other device and play across the room or the world.',
  'Every one plays with two people on one device, and most also play across two devices or against a bot.',
  'Share one screen, play across two devices, or take on a bot.',
];

/**
 * The sentences that say, correctly for today, that there is no such thing.
 *
 * Narrow on purpose, and the near miss is worth recording: "two people on one device" and
 * "does not have" both looked like denials and are not. Shared-screen play stays exactly
 * as true on the day a second device is supported — it is one of the modes, not a
 * consolation for the absence of another — and a guard that listed those twelve sites
 * would be telling whoever finally builds remote play to delete a dozen accurate
 * sentences. Only a phrase that is false the moment the mode exists belongs here.
 */
const DENIALS = [/\bno pairing route\b/i, /\bno signalling\b/i, /\bno cross-device play\b/i];

describe('the claim that a match can be played across two devices', () => {
  it.skipIf(hasRemotePlay)('is not made, because a player cannot choose it', () => {
    // The lobby offers `friend` and `bot`. There is no pairing route, no signalling and no
    // concrete transport in `apps/web` — `packages/engine/src/transport.ts` is a seam whose
    // own docstring says nothing in it knows what a network is, and the per-game "Wire up
    // cross-device remote play" issues are all open. So every phrasing below is a promise
    // of the one thing a visitor who followed it could not do.
    const claims: string[] = [];
    for (const path of sources(web)) {
      const text = rendered(readFileSync(path, 'utf8'));
      for (const pattern of CROSS_DEVICE) {
        const hit = pattern.exec(text);
        if (hit !== null) claims.push(`${relative(web, path)} — ${hit[0]}`);
      }
    }
    expect(
      claims,
      'this promises a match across two devices. `PlayMode` offers ' +
        `${[...modes].join(' and ')}, and nothing else reaches a player. Say what the build` +
        ' does, or build the mode and let the other half of this test rewrite the denials.',
    ).toEqual([]);
  });

  it.runIf(hasRemotePlay)('is no longer denied anywhere, now that it is real', () => {
    // The half that stops a fix from moving the lie rather than ending it. The comments and
    // copy that currently explain why there is no cross-device play become false on the day
    // there is, and they are the sentences a reader trusts most, because they read as
    // considered rather than as marketing.
    const denials: string[] = [];
    for (const path of sources(web)) {
      const text = readFileSync(path, 'utf8');
      for (const pattern of DENIALS) {
        const hit = pattern.exec(text);
        if (hit !== null) denials.push(`${relative(web, path)} — ${hit[0]}`);
      }
    }
    expect(denials, 'cross-device play exists now; these still say it does not').toEqual([]);
  });

  it('can tell the two states apart, so its silence is worth something', () => {
    // Which of the two above runs is decided by a search, and a search that has quietly
    // stopped matching would skip one and pass the other vacuously. Both directions, on the
    // real reader — which is the part this test did not do when it was written: it compared
    // REMOTE_MODES against a hard-coded set beside it, so it was true whatever
    // `lib/match-setup.ts` said and could never have failed.
    expect(modes.has('friend'), 'the mode union no longer parses').toBe(true);
    expect(modes.has('bot')).toBe(true);
    expect(modes.has('remote')).toBe(false);

    const withRemote = modesIn("export type PlayMode = 'friend' | 'bot' | 'remote';");
    expect(
      withRemote.has('remote'),
      'the reader cannot see a remote member when there is one',
    ).toBe(true);
    expect(REMOTE_MODES.some((mode) => withRemote.has(mode))).toBe(true);
    const withoutRemote = modesIn("export type PlayMode = 'friend' | 'bot';");
    expect(REMOTE_MODES.some((mode) => withoutRemote.has(mode))).toBe(false);
    expect(() => modesIn('export const PlayMode = 2;')).toThrow(/no longer declares/);
  });

  it('catches every sentence this repository has actually had to delete', () => {
    // The list of phrasings is only as good as the phrasings it was measured against, and it
    // was measured against none: the pattern nearest the hero's old lede demanded "on your
    // own device" where the lede said "from", so re-pasting the exact sentence #102 removed
    // would have left this file silent. Each string below was rendered on this site.
    const missed = DELETED.filter((sentence) => !CROSS_DEVICE.some((p) => p.test(sentence)));
    expect(
      missed,
      'these were on the site, were removed for promising a match across two devices, and' +
        ' this list would not notice them coming back:\n' +
        missed.join('\n'),
    ).toEqual([]);
    // And the other way: a sentence about the shared screen is not a cross-device claim, or
    // the guard would fire on the copy that replaced them.
    expect(
      CROSS_DEVICE.some((p) =>
        p.test('Share one phone or one laptop, two of you either side of the screen.'),
      ),
    ).toBe(false);
  });
});

/**
 * "A hundred and eight games", written out in words, next to a title that writes 108 in
 * digits. Two spellings of one fact, and the description had drifted a game behind.
 */
const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/** `a hundred and eight` → 108. Returns null for anything it cannot read. */
function spelledNumber(phrase: string): number | null {
  const words = phrase
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean);
  let total = 0;
  let seen = false;
  for (const word of words) {
    if (word === 'and') continue;
    if (word === 'hundred') {
      total = (total === 0 ? 1 : total) * 100;
      seen = true;
      continue;
    }
    const value = NUMBER_WORDS[word];
    if (value === undefined) return null;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}

describe('the number of games the site claims to have', () => {
  const layout = readFileSync(join(here, 'layout.tsx'), 'utf8');

  it('reads the same in the title, in digits', () => {
    const digits = /(\d+) games for two players/.exec(layout);
    expect(digits, 'the title no longer states a count this test can read').not.toBeNull();
    expect(Number(digits?.[1])).toBe(CATALOGUE.length);
  });

  it('and in the description, written out in words', () => {
    // The one that was wrong. A number spelled out is a number nothing recomputes, which is
    // exactly why it sat one behind the catalogue through however many games were added.
    const phrase = /'([a-z ]+?) games for two people/i.exec(layout);
    expect(
      phrase,
      'the description no longer opens with a count in words. If it now uses digits, or' +
        ' interpolates CATALOGUE.length, delete this test rather than weakening it.',
    ).not.toBeNull();
    expect(spelledNumber(phrase?.[1] ?? '')).toBe(CATALOGUE.length);
  });

  it('can read a wrong number as well as a right one', () => {
    // Without this the test above passes just as happily on a phrase it cannot parse at all.
    expect(spelledNumber('a hundred and seven')).toBe(107);
    expect(spelledNumber('a hundred and eight')).toBe(108);
    expect(spelledNumber('one hundred and twelve')).toBe(112);
    expect(spelledNumber('a shedload of')).toBeNull();
  });
});

/**
 * The same count, in the documents that state it in prose.
 *
 * CLAUDE.md's ninth entry ends "The count lives here" — and it lived in exactly one file,
 * `app/layout.tsx`, which is what the two tests above read. The batch that wrote that
 * sentence had four other statements of the number open in its own diff and corrected none
 * of them: `differentiation-brief.md` argued for the per-game pages while undercounting them,
 * and three more docs said 107 of games that are ours.
 *
 * **A count of every number in `docs/` was tried first and refused.** `research-status.md`
 * and `observed-rules.md` are full of correct 107s: 107 is the number of catalogue rows
 * marked `confidence: observed`, which is the reference-derived subset of our 108, and it
 * does not move when we add a game of our own. A guard that flagged those would be telling
 * somebody to write a wrong number, and it would be turned off within the week.
 *
 * So this holds phrasings rather than numbers, the way `CROSS_DEVICE` above and
 * `offline-claims.test.ts` both do: each pattern is a sentence shape that has been used in
 * this repository to count *our* catalogue, and a new one gets through until somebody adds
 * it. That is a real limit and it is smaller than it looks — the four stale sentences were
 * all of this shape, and the self-check below is fed every one of them.
 */
const OUR_COUNT: readonly RegExp[] = [
  /\b(\d+) indexable pages\b/i,
  /\bbrowsing (\d+) games\b/i,
  /\bscroll of (\d+) identical cards\b/i,
  /\b(\d+) imitations\b/i,
  /\beach of the (\d+)\b/i,
  /\bin all (\d+) games\b/i,
];

/** Every document that describes this product to a reader, top-level and under `docs/`. */
function documents(): string[] {
  const top = readdirSync(root)
    .filter((name) => name.endsWith('.md') && name !== 'BACKLOG.md')
    .map((name) => join(root, name));
  const docs = readdirSync(join(root, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(root, 'docs', name));
  return [...top, ...docs].sort();
}

/** One count of our catalogue, as a reader would find it: a place and the number stated. */
interface StatedCount {
  readonly where: string;
  readonly stated: number;
}

/** Every count of our catalogue a document states, with somewhere to send the reader. */
function statedCounts(text: string, file: string): StatedCount[] {
  const found: StatedCount[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    for (const pattern of OUR_COUNT) {
      const hit = pattern.exec(line);
      if (hit?.[1] === undefined) continue;
      found.push({
        where: `${file}:${String(index + 1)} — ${line.trim()}`,
        stated: Number(hit[1]),
      });
    }
  }
  return found;
}

describe('the number of games the documentation states', () => {
  it('is the number of games there are, wherever a document counts ours', () => {
    const wrong: StatedCount[] = [];
    for (const path of documents()) {
      const stated = statedCounts(readFileSync(path, 'utf8'), relative(root, path));
      wrong.push(...stated.filter((found) => found.stated !== CATALOGUE.length));
    }
    expect(
      wrong.map((found) => found.where),
      `the catalogue holds ${String(CATALOGUE.length)} games and these count something else:\n` +
        wrong.map((found) => found.where).join('\n'),
    ).toEqual([]);
  });

  it('reads the sentences that were stale, and leaves the ones that were right', () => {
    // The four that shipped wrong, verbatim, so the patterns are measured against the words
    // rather than against a phrase invented to fit them.
    const stale = [
      '- **Findable.** 107 indexable pages, one per game, each answering "how do you play X for',
      '**1. Browsing 107 games.** A flat scroll of 107 identical cards is a list, not a',
      '  than 107 imitations.',
      'what stops each of the 107 growing its own answer.',
      'another. Bolt the second on later and each of the 107 games grows its own private answer',
      'arrive a step late instead. So the shot stops being fired in all 107 games without a line',
    ];
    for (const line of stale) {
      const found = statedCounts(line, 'x.md');
      expect(
        found.map((entry) => entry.stated),
        line,
      ).not.toEqual([]);
      expect(
        found.every((entry) => entry.stated === 107),
        line,
      ).toBe(true);
    }
    // And the ones that count the reference-derived subset, which is 107 and stays 107.
    for (const line of [
      '**107 of the 107 reference-derived games have no `RESEARCH.md`.**',
      '**Coverage: 107 of 107 games — complete.**',
      '| — of those, `confidence: observed` (a reference-app game) | 107 |',
      '**Tier C — all 107 games, pre-game screen only.**',
    ]) {
      expect(statedCounts(line, 'x.md'), line).toEqual([]);
    }
  });
});

describe('the bot the catalogue page promises in the second seat', () => {
  it('is offered by every game the page is counting', () => {
    // The page used to say "most also play across two devices or against a bot", which
    // undersold the true half while promising the false one: every game in the catalogue
    // carries `bot`. If one ever arrives without it, "every one" has to become a count.
    const without = CATALOGUE.filter((game) => !game.modes.includes('bot')).map(
      (game) => game.slug,
    );
    expect(
      without,
      'app/games/page.tsx says every game takes a bot in the second seat; these do not',
    ).toEqual([]);
  });
});
