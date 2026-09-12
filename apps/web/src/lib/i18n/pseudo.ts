/**
 * The two pseudo-locale transforms: what `en-XA` and `ar-XB` do to an English string (#223,
 * #222, #219).
 *
 * Deterministic and pure, because their output is committed: `extract.test.ts` runs every
 * extracted English string through these and writes the result into
 * `catalogues/<code>.generated.ts`, and then, on every other run, asserts that what is on disk
 * is what it would write. A transform that varied between runs would fail that check on every
 * push. They are also small on purpose — they run on the build machine and in the unit suite,
 * never in a browser, so nothing here is measured against a byte budget.
 *
 * ## `en-XA` — accented and padded
 *
 * Every Latin letter is swapped for an accented form of itself, so the text stays readable by
 * somebody who knows the English and is unmistakably not English to anybody else; then it is
 * padded with middle dots to **half again its length**, and wrapped in `⟦ ⟧` so that a string
 * still in plain English on a pseudo-localised screen stands out as one the extractor never saw.
 * A control that overflows under this locale is the finding #223 exists to make.
 *
 * Half again, and not the 35% this first shipped with, because 35% is what a German or Finnish
 * rendering of an English control *typically* costs and #223 asks for the case the layout has to
 * survive rather than the typical one: **no truncation or overflow at 150% of the source
 * length**. So the padding is the acceptance criterion, measured the way the criterion reads —
 * `pseudoAccent(s).length >= s.length * 1.5` for every string, the wrapper and its space adding
 * three characters more on top of that rather than being counted towards it.
 *
 * The dots go after the words, never inside one. A padded word would be a word no engine can
 * break, which is a different failure from a long line — and one the site would have no way to
 * fix short of hyphenating real German.
 *
 * ## `ar-XB` — mirrored
 *
 * Each word is wrapped in U+202E RIGHT-TO-LEFT OVERRIDE … U+202C POP DIRECTIONAL FORMATTING, so
 * its letters render right-to-left while the words keep their order. Per word rather than per
 * string, and the difference was looked at rather than assumed: one override across a whole
 * sentence reverses the *order* of the words as well, so a `{count}` in the middle of a line
 * swaps sides with the noun it belongs to and a placeholder value ends up looking like a bug in
 * the interpolation rather than a property of the locale. Per word, the sentence reads as its
 * own mirror image word by word — which is the conventional shape, and the one whose failures
 * are all layout failures, which is what #222 is looking for.
 *
 * ## Placeholders survive both
 *
 * `{count}`, `{name}` and the like are passed through untouched, in both transforms, because
 * `t()` finds them by that exact spelling after the lookup. An accented `{çöûñt}` would be a
 * placeholder nothing fills — visible on the pseudo screen as exactly that, which is the failure
 * the placeholder test in `i18n.test.ts` watches for.
 */

/** Latin letters to an accented form that still reads as the original. */
const ACCENTS: Readonly<Record<string, string>> = {
  a: 'å',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'ï',
  j: 'ĵ',
  k: 'ķ',
  l: 'ł',
  m: 'ɱ',
  n: 'ñ',
  o: 'ö',
  p: 'þ',
  q: 'ɋ',
  r: 'ŕ',
  s: 'š',
  t: 'ŧ',
  u: 'û',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Å',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Ï',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ł',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ö',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ŧ',
  U: 'Û',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

/**
 * How much longer than the English a translation is planned for: half again (#223).
 *
 * The padding alone, so the transform's output is `1.5 × length` plus the wrapper.
 */
const EXPANSION = 0.5;

/** A `{placeholder}`, kept as a token of its own so neither transform touches it. */
const PLACEHOLDER = /(\{\w+\})/;

/** Written as escapes: both are invisible, and an editor that showed them would show nothing. */
const RLO = '\u202E';
const PDF = '\u202C';

/** `transform` over every stretch of `text` that is not a placeholder, placeholders kept. */
function outsidePlaceholders(text: string, transform: (segment: string) => string): string {
  return text
    .split(PLACEHOLDER)
    .map((segment, index) => (index % 2 === 1 ? segment : transform(segment)))
    .join('');
}

/** The `en-XA` rendering of an English string. */
export function pseudoAccent(text: string): string {
  const accented = outsidePlaceholders(text, (segment) =>
    segment.replace(/[A-Za-z]/g, (letter) => ACCENTS[letter] ?? letter),
  );
  const padding = '·'.repeat(Math.ceil(text.length * EXPANSION));
  return `⟦${accented} ${padding}⟧`;
}

/** The `ar-XB` rendering of an English string. */
export function pseudoMirror(text: string): string {
  return outsidePlaceholders(text, (segment) =>
    segment.replace(/\S+/g, (word) => `${RLO}${word}${PDF}`),
  );
}
