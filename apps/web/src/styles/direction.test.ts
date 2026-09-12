import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The shell mirrors for a right-to-left reader through logical properties alone (#222).
 *
 * A stylesheet that says `margin-left` has decided which side of the *device* a margin is
 * on; one that says `margin-inline-start` has said which end of the *sentence*, and the
 * browser puts it on the right for Arabic. Every physical directional property in the shell
 * was converted in one pass, and this test is what keeps the next `padding-left` — the
 * spelling every editor autocompletes first — from bringing an un-mirrored corner back.
 *
 * ## What is allowed to stay physical, and how it says so
 *
 * Some sides really are sides of the device. A gutter padded away from a notch is about the
 * cutout, which does not move when the menus change language; a seat is the half of the
 * phone one of the two players is holding; the play surface is the same object on both
 * sides of the device and on both devices of a remote match (rule 9). None of that follows
 * the reading direction, and none of it is a whitelist entry here. A physical declaration
 * stays physical by carrying, **on its own line**, a comment of the exact shape
 *
 *     padding-left: …; /\* physical: <why this is a side of the device> *\/
 *
 * and the reason is part of the syntax: a marker with nothing after the colon is not one. A
 * marker on a line that has no physical declaration fails too, so the word cannot be
 * sprinkled ahead of a rewrite to keep the guard quiet. The convention, the list of what
 * never mirrors and why, and the icon table are in docs/rtl.md.
 *
 * ## What the scanner reads
 *
 * Every `.css` under `apps/web/src`, and the inline `style={{…}}` objects and `dir`
 * attributes in every `.tsx`, because a `marginLeft` in a style object is the same decision
 * in a different file. It looks at property names (`left`, `margin-right`,
 * `border-top-left-radius`, `direction`…), at the four keyword properties whose *value*
 * picks a side (`text-align: right`, `float: left`…), at four-value shorthands whose second
 * and fourth values differ (`margin: 0 0 0 auto` is `margin-left: auto` in disguise), at
 * `border-radius` where the left corners differ from the right, at a `translateX` that is
 * not multiplied by `--db-inline-sign` (CSS has no logical translate, so travel along the
 * line is signed by that token, which `[dir='rtl']` in tokens.css turns to -1), and at a
 * `scaleX(-1)` that is not under a `[dir='rtl']` selector, since a flip that does not
 * depend on the reading direction is a flip for some other reason and wants saying.
 * Comments are blanked before any of that, with their newlines kept so a report's line
 * number is the file's line number.
 *
 * ## The controls
 *
 * CLAUDE.md's twelfth entry is the reason for the second half of this file: a scanner that
 * matched nothing would pass the whole tree, and the only way to know it matches is to hand
 * it something it must report. So the scanner runs over a fixture with a plant on a known
 * line and must name that line; over the same plant with a marker and must not; over prose
 * in a comment that spells `margin-left:` and must ignore it; and over `tokens.css`, where
 * it must find the `[dir='rtl']` block and the three tokens it turns round. The marker path
 * is exercised on real input too — the count of markers in the tree is held to a number,
 * so that number is also the number of decisions somebody has written a reason for.
 *
 * ## Watched failing
 *
 * With `margin-inline-start: auto` in `SiteHeader.module.css` put back to `margin-left: auto`
 * the tree check named `components/SiteHeader.module.css:69`, and with the marker on the
 * play surface's `direction: ltr` line deleted it named that line instead. The stale-marker
 * check was watched with the marker moved one line up onto `padding-bottom`. The island
 * check was watched with `--db-inline-sign: 1` removed from the `[dir='ltr']` block, and the
 * `dir` check with the attribute removed from `PlaySurface.tsx`.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));

function filesUnder(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path, extension));
    else if (entry.name.endsWith(extension)) found.push(path);
  }
  return found.sort();
}

/** A physical declaration the reader has excused, with a reason. Whole comment, own line. */
const MARKER = /\/\*\s*physical:\s*(?:[^*]|\*(?!\/))*\w(?:[^*]|\*(?!\/))*\*\//g;

/** Blank every block comment to spaces, keeping its newlines so offsets still map to lines. */
function blankComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Split a value on top-level whitespace, so `max(a, b) 4px` is two values and not three. */
function values(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value.trim()) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (/\s/.test(char) && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

const PHYSICAL_PROPERTY =
  /^(?:left|right|margin-(?:left|right)|padding-(?:left|right)|border-(?:left|right)(?:-(?:width|style|color))?|border-(?:top|bottom)-(?:left|right)-radius|scroll-(?:margin|padding)-(?:left|right)|direction)$/;
const SIDED_KEYWORD_PROPERTY =
  /^(?:text-align|float|clear|transform-origin|background-position|object-position|perspective-origin)$/;
const FOUR_SIDED_SHORTHAND =
  /^(?:margin|padding|inset|border-width|border-style|border-color|scroll-margin|scroll-padding)$/;
const SIDE_WORD = /\b(?:left|right)\b/;

/** Why a declaration is physical, or null when it is not. */
function physicalReason(property: string, value: string, selector: string): string | null {
  if (PHYSICAL_PROPERTY.test(property)) return 'names a side of the device';
  if (SIDED_KEYWORD_PROPERTY.test(property) && SIDE_WORD.test(value)) {
    return 'picks a side by keyword';
  }
  if (FOUR_SIDED_SHORTHAND.test(property)) {
    const parts = values(value);
    if (parts.length === 4 && parts[1] !== parts[3])
      return 'a four-value shorthand whose sides differ';
  }
  if (property === 'border-radius') {
    const corners = values(value.split('/')[0] ?? '');
    const [a, b, c] = corners;
    const asymmetric =
      (corners.length === 4 && (a !== b || c !== corners[3])) ||
      (corners.length === 3 && (a !== b || b !== c)) ||
      (corners.length === 2 && a !== b);
    if (asymmetric) return 'rounds the left corners differently from the right';
  }
  if (property === 'transform' || property === 'translate') {
    for (const travel of value.matchAll(/translate(?:X|3d)?\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)) {
      const x = (travel[1] ?? '').split(',')[0]?.trim() ?? '';
      if (/^0(?:px|rem|em|%)?$/.test(x)) continue;
      if (x.includes('var(--db-inline-sign)')) continue;
      return 'travels along the line without --db-inline-sign';
    }
    if (property === 'translate') {
      const x = values(value)[0] ?? '';
      if (!/^0(?:px|rem|em|%)?$/.test(x) && !x.includes('var(--db-inline-sign)')) {
        return 'travels along the line without --db-inline-sign';
      }
    }
    if (/scale(?:X\(\s*-1|\(\s*-1\s*[,)])/.test(value) && !/\[dir=['"]rtl['"]\]/.test(selector)) {
      return 'mirrors without depending on the reading direction';
    }
  }
  return null;
}

export interface Hit {
  readonly file: string;
  readonly line: number;
  readonly selector: string;
  readonly declaration: string;
  readonly why: string;
}

export interface Scan {
  /** Physical declarations with no marker on their line. Empty is the goal. */
  readonly hits: Hit[];
  /** Lines carrying a marker that excused a physical declaration. */
  readonly markers: number[];
  /** Lines carrying a marker with nothing physical to excuse. */
  readonly staleMarkers: number[];
  /** Every block whose selector is scoped to `[dir='rtl']`, with its declarations. */
  readonly rtlBlocks: { selector: string; declarations: Record<string, string> }[];
  /** Every block, keyed by its selector's last line, with its declarations. */
  readonly blocks: Map<string, Record<string, string>>;
  readonly declarations: number;
}

/** Scan one stylesheet's text. `file` is only used to label hits. */
export function scanCss(source: string, file: string): Scan {
  const markerLines = new Set<number>();
  for (const marker of source.matchAll(MARKER)) markerLines.add(lineAt(source, marker.index));
  const css = blankComments(source);

  const hits: Hit[] = [];
  const used = new Set<number>();
  const rtlBlocks: Scan['rtlBlocks'] = [];
  const blocks = new Map<string, Record<string, string>>();
  let declarations = 0;

  // Innermost blocks only: `[^{}]*` cannot cross a brace, so an `@media` wrapper is never a
  // match on its own and the rules inside it are visited one by one.
  for (const block of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = (block[1] ?? '').trim().split('\n').pop()?.trim() ?? '';
    const body = block[2] ?? '';
    const bodyStart = block.index + (block[1] ?? '').length + 1;
    const found: Record<string, string> = {};

    let cursor = 0;
    for (const raw of body.split(';')) {
      const start = bodyStart + cursor;
      cursor += raw.length + 1;
      const colon = raw.indexOf(':');
      if (colon === -1) continue;
      const property = raw.slice(0, colon).trim().toLowerCase();
      const value = raw.slice(colon + 1).trim();
      if (!property) continue;
      declarations += 1;
      found[property] = value;
      const why = physicalReason(property, value, selector);
      if (why === null) continue;
      const line = lineAt(css, start + raw.indexOf(property));
      // A declaration may wrap (a four-value padding of `max()` calls does), and its marker
      // then sits after the `;` on the last line: any line the declaration spans will do.
      const last = lineAt(css, start + raw.length);
      const marker = [...markerLines].find((m) => m >= line && m <= last);
      if (marker !== undefined) used.add(marker);
      else hits.push({ file, line, selector, declaration: `${property}: ${value}`, why });
    }

    // Merged, because one selector can appear twice — `.surface` at rest and inside a media
    // query — and a lookup by selector wants everything it declares.
    blocks.set(selector, { ...(blocks.get(selector) ?? {}), ...found });
    if (/\[dir=['"]rtl['"]\]/.test(selector)) rtlBlocks.push({ selector, declarations: found });
  }

  const markers = [...markerLines].sort((a, b) => a - b);
  return {
    hits,
    markers: markers.filter((line) => used.has(line)),
    staleMarkers: markers.filter((line) => !used.has(line)),
    rtlBlocks,
    blocks,
    declarations,
  };
}

const STYLE_KEY =
  /(?:^|[,{\s])(left|right|margin(?:Left|Right)|padding(?:Left|Right)|border(?:Left|Right)(?:Width|Style|Color)?|border(?:Top|Bottom)(?:Left|Right)Radius|textAlign|float|clear|direction|transform)\s*:\s*([^,}]+)/g;

/**
 * The same question asked of a component's inline styles and `dir` attributes.
 *
 * Only the `style={{…}}` objects are read, so a `left` in ordinary code is not a hit; inside
 * one, a key that names a side is a hit unless its line carries the marker. A `dir`
 * attribute is reported separately: it pins a whole subtree against the reading direction,
 * and the tree check below allows exactly one.
 */
export function scanTsx(
  source: string,
  file: string,
): { hits: Hit[]; dirAttributes: { file: string; line: number; text: string }[] } {
  const hits: Hit[] = [];
  const dirAttributes: { file: string; line: number; text: string }[] = [];
  const marked = (line: number) => /physical:\s*\w/.test(source.split('\n')[line - 1] ?? '');
  // Docstrings talk about `dir="ltr"`; only markup counts. `//` is only a comment when it
  // follows whitespace, so a `https://` inside a string survives.
  const code = blankComments(source).replace(/(^|\s)\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, ' '));

  for (const attribute of code.matchAll(/\bdir=(?:"[^"]*"|\{[^}]*\})/g)) {
    dirAttributes.push({ file, line: lineAt(source, attribute.index), text: attribute[0] });
  }

  for (const open of source.matchAll(/style=\{\{/g)) {
    let depth = 0;
    let end = open.index;
    for (let i = open.index + 'style='.length; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      if (source[i] === '}') depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
    const object = blankComments(source.slice(open.index, end)).replace(/\/\/[^\n]*/g, (c) =>
      ' '.repeat(c.length),
    );
    for (const key of object.matchAll(STYLE_KEY)) {
      const property = key[1] ?? '';
      const value = (key[2] ?? '').trim();
      const line = lineAt(source, open.index + key.index + key[0].indexOf(property));
      let why: string | null = null;
      if (/^(?:textAlign|float|clear)$/.test(property)) {
        if (/['"](?:left|right)['"]/.test(value)) why = 'picks a side by keyword';
      } else if (property === 'transform') {
        if (/translate(?:X|3d)?\(/.test(value) && !value.includes('--db-inline-sign')) {
          why = 'travels along the line without --db-inline-sign';
        }
      } else {
        why = 'names a side of the device';
      }
      if (why !== null && !marked(line)) {
        hits.push({
          file,
          line,
          selector: 'style={{…}}',
          declaration: `${property}: ${value}`,
          why,
        });
      }
    }
  }
  return { hits, dirAttributes };
}

const describeHits = (hits: Hit[]): string =>
  hits
    .map((h) => `${h.file}:${String(h.line)}  ${h.selector} { ${h.declaration} }  — ${h.why}`)
    .join('\n');

describe('the scanner, on input it must report', () => {
  const fixture = [
    '/* margin-left: 999px in prose, which is not a declaration */',
    '.a {',
    '  margin-inline-start: auto;',
    '  margin-left: 4px;',
    '  padding-right: 2px; /* physical: the notch is on this side of the phone */',
    '  text-align: start;',
    '  text-align: right;',
    '  margin: 0 0 0 auto;',
    '  padding: 0 1px 0 1px;',
    '  border-radius: 8px 0 0 8px;',
    '  border-radius: 8px 8px 0 0;',
    '  transform: translateX(1rem);',
    '  transform: translateX(calc(1rem * var(--db-inline-sign)));',
    '  transform: translate(-50%, -50%);',
    '  transform: translate(0, -50%);',
    '  transform: scaleX(-1);',
    '  color: red; /* physical: a marker with nothing to excuse */',
    '}',
    "[dir='rtl'] .b {",
    '  transform: scaleX(-1);',
    '  --db-inline-sign: -1;',
    '}',
    '@media (max-width: 40rem) {',
    '  .c {',
    '    float: left;',
    '  }',
    '}',
  ].join('\n');
  const scan = scanCss(fixture, 'fixture.css');

  it('names each plant by line, and nothing that is not one', () => {
    expect(scan.hits.map((h) => [h.line, h.declaration])).toEqual([
      [4, 'margin-left: 4px'],
      [7, 'text-align: right'],
      [8, 'margin: 0 0 0 auto'],
      [10, 'border-radius: 8px 0 0 8px'],
      [12, 'transform: translateX(1rem)'],
      [14, 'transform: translate(-50%, -50%)'],
      [16, 'transform: scaleX(-1)'],
      [25, 'float: left'],
    ]);
  });

  it('honours a marker on the line it is on, and only there', () => {
    expect(scan.markers).toEqual([5]);
    expect(scan.staleMarkers).toEqual([17]);
  });

  it('finds the [dir=rtl] block and what it declares', () => {
    expect(scan.rtlBlocks).toEqual([
      {
        selector: "[dir='rtl'] .b",
        declarations: { transform: 'scaleX(-1)', '--db-inline-sign': '-1' },
      },
    ]);
  });

  it('reads an inline style object and a dir attribute the same way', () => {
    const tsx = [
      '<div style={{ marginLeft: 4, textAlign: "center" }} />',
      '<div style={{ paddingInlineStart: 4 }} />',
      '<div style={{ right: 0 /* physical: seat two */, textAlign: "right" }} />',
      '<div dir="ltr" />',
      "const left = 'not a style';",
    ].join('\n');
    const result = scanTsx(tsx, 'Fixture.tsx');
    expect(result.hits.map((h) => [h.line, h.declaration])).toEqual([[1, 'marginLeft: 4']]);
    expect(result.dirAttributes).toEqual([{ file: 'Fixture.tsx', line: 4, text: 'dir="ltr"' }]);
  });
});

describe('the tokens, as the scanner sees them', () => {
  const tokens = scanCss(readFileSync(join(SRC, 'styles/tokens.css'), 'utf8'), 'tokens.css');
  const root = tokens.blocks.get(':root') ?? {};
  const rtl = tokens.rtlBlocks.find((b) => b.selector === "[dir='rtl']")?.declarations ?? {};

  it('declare the two inline safe-area edges and the sign, and turn all three round', () => {
    expect(root['--db-safe-inline-start']).toBe('var(--db-safe-left)');
    expect(root['--db-safe-inline-end']).toBe('var(--db-safe-right)');
    expect(root['--db-inline-sign']).toBe('1');
    expect(rtl).toEqual({
      '--db-safe-inline-start': 'var(--db-safe-right)',
      '--db-safe-inline-end': 'var(--db-safe-left)',
      '--db-inline-sign': '-1',
    });
  });

  it('keep the physical safe-area tokens for the symmetric gutters', () => {
    // The logical pair is defined *from* these, so they cannot go; and every gutter padded
    // on both sides still reads them directly, with a marker — see the tree check.
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      expect(root[`--db-safe-${edge}`]).toBe(`env(safe-area-inset-${edge}, 0px)`);
    }
  });
});

/**
 * Every marker in the tree today. Each one is a written reason that a side is a side of the
 * device, so the number going up is a decision — add the reason to docs/rtl.md's list — and
 * the number going down means a gutter or a seat has started following the sentence.
 */
const MARKERS_IN_THE_TREE = 21;

describe('the shell (#222)', () => {
  const stylesheets = filesUnder(SRC, '.css').map((file) => ({
    file: relative(SRC, file),
    ...scanCss(readFileSync(file, 'utf8'), relative(SRC, file)),
  }));
  const components = filesUnder(SRC, '.tsx').map((file) =>
    scanTsx(readFileSync(file, 'utf8'), relative(SRC, file)),
  );

  it('is read in full, so an empty report means an empty tree and not a broken walk', () => {
    expect(stylesheets.length, 'stylesheets under apps/web/src').toBeGreaterThan(40);
    expect(
      stylesheets.reduce((n, s) => n + s.declarations, 0),
      'declarations scanned',
    ).toBeGreaterThan(1500);
    expect(components.length, 'components under apps/web/src').toBeGreaterThan(40);
  });

  it('uses no physical directional property without saying why', () => {
    const hits = [...stylesheets.flatMap((s) => s.hits), ...components.flatMap((c) => c.hits)];
    expect(
      describeHits(hits),
      'each of these names a side of the device. Say which end of the line instead ' +
        '(margin-inline-start, inset-inline-end, text-align: start, translateX(… * ' +
        'var(--db-inline-sign))), or — if it really is a side of the device — add ' +
        '/* physical: <reason> */ on the same line and the reason to docs/rtl.md',
    ).toBe('');
  });

  it('has no marker on a line with nothing physical to excuse', () => {
    const stale = stylesheets.flatMap((s) =>
      s.staleMarkers.map((line) => `${s.file}:${String(line)}`),
    );
    expect(stale, 'a marker belongs on the declaration it excuses').toEqual([]);
  });

  it('has exactly the markers docs/rtl.md accounts for', () => {
    const markers = stylesheets.flatMap((s) => s.markers.map((l) => `${s.file}:${String(l)}`));
    expect(markers, markers.join('\n')).toHaveLength(MARKERS_IN_THE_TREE);
  });

  it('pins the play surface, and only the play surface, against the reading direction', () => {
    // Rule 9 (CLAUDE.md): the play area is the same object on both sides of the device and
    // on both devices of a match, so the surface is an `ltr` island inside a mirrored shell.
    // Both halves have to be present — `direction` for the box model, `dir` for the bidi
    // algorithm — and every token the `[dir='rtl']` block swaps has to be set back under
    // `[dir='ltr']`, or a control in the island sits at one edge while clearing the other
    // edge's cutout. (Set back in tokens.css rather than on `.surface` because
    // `safe-area.test.ts` reads every `var(--db-safe-*)` in that module against a `max(`.)
    const surface =
      stylesheets
        .find((s) => s.file === 'components/PlaySurface.module.css')
        ?.blocks.get('.surface') ?? {};
    expect(surface['direction']).toBe('ltr');

    const tokens = scanCss(readFileSync(join(SRC, 'styles/tokens.css'), 'utf8'), 'tokens.css');
    const root = tokens.blocks.get(':root') ?? {};
    const swapped = tokens.rtlBlocks.find((b) => b.selector === "[dir='rtl']")?.declarations ?? {};
    const restored = tokens.blocks.get("[dir='ltr']") ?? {};
    expect(Object.keys(swapped).length).toBeGreaterThan(0);
    for (const token of Object.keys(swapped)) {
      expect(swapped[token], `${token} really turns round`).not.toBe(root[token]);
      expect(restored[token], `${token} inside the ltr island`).toBe(root[token]);
    }
    expect(Object.keys(restored).sort()).toEqual(Object.keys(swapped).sort());

    const dirs = components.flatMap((c) => c.dirAttributes);
    expect(dirs.map((d) => `${d.file}:${String(d.line)} ${d.text}`)).toEqual([
      // The only `dir` in the tree. A second island wants its reason in docs/rtl.md first.
      `components/PlaySurface.tsx:${String(dirs[0]?.line ?? 0)} dir="ltr"`,
    ]);
    const source = readFileSync(join(SRC, 'components/PlaySurface.tsx'), 'utf8');
    const opening = /<div\s+className=\{styles\.surface\}[^>]*>/.exec(blankComments(source));
    expect(opening?.[0], 'the attribute is on the element that wears .surface').toContain(
      'dir="ltr"',
    );
  });
});
