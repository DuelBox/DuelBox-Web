import { describe, expect, it } from 'vitest';
import { CATALOGUE } from './catalogue.generated';
import { MANIFESTS } from './controls';

/**
 * The catalogue `rule` strings are the only prose in the product with no guard on it, and
 * they are the prose search engines read: `app/games/[slug]/page.tsx` uses the rule
 * verbatim as the page's `description`.
 *
 * They drifted a long way before anybody counted. Of the 107 rules audited in #2513:
 * **63 carried an exclamation mark** — 33 of them two or more — against **zero** across
 * all 214 manifest `controls` strings and every component in the shell; **47 named a
 * physical input**, several of them one the game does not have ("Swipe up to throw balls
 * into cups" for a game whose whole control scheme is two presses, "use the left stick"
 * for a game with a keyboard and a finger and nothing else); **8 spelled `color`** against
 * a shell that spells `colour`; two were folded YAML that shipped an embedded newline into
 * a meta description; and one read `First to 5 win!`.
 *
 * Every one of those is mechanical, and none of them was mechanically checked. This file
 * is the check. It is deliberately about the *shape* of the sentence rather than its
 * content — a rule saying the wrong thing about a game is caught by a person reading it,
 * but a rule shouting, or promising a joystick, is caught here or never.
 *
 * The rule that matters most cannot be automated and is written down instead: **describe
 * the mechanic in our own words rather than translating someone else's**. What can be
 * automated is the residue that translation leaves behind, which is what follows.
 */

/** Every catalogue rule, with the game's own manifest beside it. */
const ROWS = CATALOGUE.map((entry) => {
  const manifest = MANIFESTS.find((candidate) => candidate.id === entry.id);
  return {
    id: entry.id,
    name: entry.name,
    rule: entry.rule,
    /** Both control strings, lowercased, as one haystack. Empty when no game is built. */
    controls: manifest
      ? `${manifest.controls.keyboard} ${manifest.controls.pointer}`.toLowerCase()
      : '',
  };
});

/**
 * `\b` alone is not enough: "presses" must match "press" and "flicks" must match "flick",
 * or a guard on the singular is a guard on nothing. Anything longer than a plural or a
 * participle is a different word and is left alone.
 */
function mentions(haystack: string, word: string): boolean {
  return new RegExp(String.raw`\b${word}(?:s|es|ed|ing)?\b`, 'i').test(haystack);
}

describe('the catalogue rules are in our own voice', () => {
  it('has a rule for every game', () => {
    const empty = ROWS.filter((row) => row.rule.trim().length === 0).map((row) => row.id);
    expect(empty, `catalogue rows with no rule: ${empty.join(', ')}`).toEqual([]);
  });

  /**
   * The shell does not shout. Zero of the 214 manifest `controls` strings carry an
   * exclamation mark and neither does any component, so 63 of them in the catalogue were
   * not a house style — they were somebody else's, carried across with the sentence.
   */
  it('never shouts', () => {
    const shouting = ROWS.filter((row) => row.rule.includes('!')).map(
      (row) => `${row.id}: ${row.rule}`,
    );
    expect(
      shouting,
      `the shell has no exclamation marks anywhere; these rules do:\n${shouting.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * A meta description is one line of prose. The two rules that shipped as folded YAML
   * put a literal newline into a `<meta>` tag, and a stray quote in the same place is the
   * usual next symptom of the same mistake.
   */
  it('reads as one line of prose that can stand alone in a search result', () => {
    const wrong: string[] = [];
    for (const row of ROWS) {
      const rule = row.rule;
      if (rule !== rule.trim()) wrong.push(`${row.id}: padded with whitespace`);
      if (/[\n\r\t]/.test(rule)) wrong.push(`${row.id}: contains a line break`);
      if (/\s\s/.test(rule)) wrong.push(`${row.id}: contains a double space`);
      if (/^['"`]/.test(rule)) wrong.push(`${row.id}: starts with a stray quote`);
      if (!/^[A-Z]/.test(rule)) wrong.push(`${row.id}: does not start with a capital`);
      if (!/[.]$/.test(rule)) wrong.push(`${row.id}: does not end in a full stop`);
      // Long enough to say what the game is and what the player does; short enough that a
      // search engine shows most of it rather than cutting mid-clause.
      if (rule.length < 60) wrong.push(`${row.id}: ${String(rule.length)} chars, too short`);
      if (rule.length > 320) wrong.push(`${row.id}: ${String(rule.length)} chars, too long`);
    }
    expect(wrong, `these rules are not shaped like a meta description:\n${wrong.join('\n')}`).toEqual(
      [],
    );
  });

  /**
   * The shell is written in British English — `colour`, and the games are `Colour Wars`
   * and `Paint Fight`. Eight rules spelled `color`, which is the single most visible tell
   * that a sentence came from somewhere else.
   */
  it('spells the way the rest of the shell spells', () => {
    const AMERICAN: ReadonlyArray<readonly [string, string]> = [
      ['color', 'colour'],
      ['colors', 'colours'],
      ['colored', 'coloured'],
      ['coloring', 'colouring'],
      ['center', 'centre'],
      ['centers', 'centres'],
      ['centered', 'centred'],
      ['gray', 'grey'],
      ['defense', 'defence'],
      ['offense', 'offence'],
      ['favorite', 'favourite'],
      ['neighbor', 'neighbour'],
      ['armor', 'armour'],
      ['meter', 'metre'],
      ['meters', 'metres'],
      ['maneuver', 'manoeuvre'],
      ['traveled', 'travelled'],
      ['traveling', 'travelling'],
      ['canceled', 'cancelled'],
      ['jewelry', 'jewellery'],
    ];
    const wrong: string[] = [];
    for (const row of ROWS) {
      for (const [american, british] of AMERICAN) {
        if (new RegExp(String.raw`\b${american}\b`, 'i').test(row.rule)) {
          wrong.push(`${row.id}: "${american}" — the shell spells it "${british}"`);
        }
      }
    }
    expect(wrong, `American spellings in the catalogue:\n${wrong.join('\n')}`).toEqual([]);
  });

  /**
   * **No game in this collection has any of these.** Every one of the 214 manifest
   * `controls` strings was checked: not one names a stick, a pad, a gamepad, a mouse or a
   * swipe, because DuelBox is two people on one device with a keyboard and a finger.
   * A rule naming one is describing a different product — which is exactly how they got
   * here, and `packages/games/cup-pong/SPEC.md` and `traffic-jam/SPEC.md` both had to
   * write a paragraph explaining that the catalogue was describing an input they had not
   * built.
   */
  it('never names an instrument no game in the collection has', () => {
    /**
     * Patterns rather than bare words, because English gets in the way of both halves of
     * this: a knife "sticks" in the wood and nobody has offered anybody a controller, so
     * only the qualified forms count as naming one.
     */
    const NEVER: ReadonlyArray<readonly [RegExp, string]> = [
      [/\bjoy[\s-]?sticks?\b/i, 'joystick'],
      [/\b(?:left|right|analogue?|control|thumb)[\s-]?sticks?\b/i, 'a named stick'],
      [/\b(?:the|a|your|their)\s+sticks?\b/i, 'the stick'],
      [/\bd[\s-]?pads?\b/i, 'd-pad'],
      [/\bgame[\s-]?pads?\b/i, 'gamepad'],
      [/\bcontrollers?\b/i, 'a controller'],
      [/\bmouse\b/i, 'a mouse'],
      [/\bclick(?:s|ed|ing)?\b/i, 'a click'],
      [/\bswipe(?:s|d|ing)?\b/i, 'a swipe'],
      [/\bpinch(?:es|ed|ing)?\b/i, 'a pinch'],
      [/\btilt(?:s|ed|ing)?\b/i, 'a tilt'],
      [/\btrack[\s-]?pads?\b/i, 'a trackpad'],
      [/\btouch[\s-]?screens?\b/i, 'a touchscreen'],
      [/\btriggers?\b/i, 'a trigger'],
    ];
    const wrong: string[] = [];
    for (const row of ROWS) {
      for (const [pattern, what] of NEVER) {
        if (pattern.test(row.rule)) wrong.push(`${row.id}: names ${what} — no game has one`);
      }
    }
    expect(wrong, `rules promising an input that does not exist:\n${wrong.join('\n')}`).toEqual([]);
  });

  /**
   * The rest of the input vocabulary is real, but only in the games that built it. A tap
   * is right for Whack a Mole and wrong for Cup Pong, whose throw is two presses. So a
   * rule may use one of these words only when the game's **own** manifest uses it: the
   * manifest is where a game declares what it actually reads, and it is the string the
   * play page shows the player.
   *
   * `keyboard`-only phrasing is covered by the same rule, because a game with no pointer
   * idiom has an empty `pointer` string and therefore no gesture words at all.
   */
  it('names a gesture only when the game itself declares it', () => {
    // `hold` and `sweep` are deliberately absent. A rack "holds seven", a sky "holds
    // the same objects" and a blade is "sweeping", so gating them catches ordinary
    // English rather than a promise about an input. These five are only ever gestures.
    const GATED = ['tap', 'drag', 'press', 'flick', 'button'];
    const wrong: string[] = [];
    for (const row of ROWS) {
      for (const word of GATED) {
        if (mentions(row.rule, word) && !mentions(row.controls, word)) {
          wrong.push(`${row.id}: rule says "${word}", manifest controls do not — "${row.controls}"`);
        }
      }
    }
    expect(wrong, `rules describing a gesture the game does not read:\n${wrong.join('\n')}`).toEqual(
      [],
    );
  });

});
