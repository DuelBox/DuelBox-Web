/**
 * Player-supplied text, made safe to store, render, and send to another device.
 *
 * A player name is the only free text this product will ever accept, and it is the most
 * realistic attack surface it has: it is chosen by one person, stored, sent over a peer
 * connection, and rendered on a stranger's device. Every one of those is a boundary.
 *
 * The policy is deliberately strict. This is a name on a scoreboard, not a message, so
 * the safe answer is to permit a small well-understood set and reject everything else
 * rather than to enumerate what to strip. Blocklists are how sanitisers get bypassed:
 * every trick that ever defeated one worked by finding something the list did not name.
 *
 * React escapes what it renders, so this is not the only thing between a name and an
 * injection. It is what stops a name being weaponised somewhere React is not — a canvas
 * label, a document title, a URL, a log line, or another player's client running a
 * different version of this code.
 */

/** Long enough for a real name, short enough not to break a scoreboard. */
export const MAX_NAME_LENGTH = 16;

/**
 * The most input this will look at, in UTF-16 units, before it stops caring (#2387).
 *
 * Every pass below runs over the **whole** string — six `replace`s, an NFC normalisation
 * and two spreads — and only then is the result cut to {@link MAX_NAME_LENGTH}. That is
 * linear rather than catastrophic (the patterns are flat character classes with no nested
 * quantifiers, so there is no ReDoS here), but linear on unbounded input is still
 * unbounded work: two million combining marks measured **390 ms**, on the thread that
 * draws the page.
 *
 * Input arrives from a peer's payload, a stale `localStorage` entry or a hand-edited URL,
 * so its length is not ours to assume. Sixteen times the longest name anyone may keep is
 * a generous ceiling for something that is meant to be a name.
 *
 * The trade, stated because it is a real behaviour change: an input whose first 256 units
 * are all disallowed and which then contains a valid name now yields nothing, where before
 * it yielded the name. That input is hostile by construction, and 'truncated' is reported
 * either way, so a UI that explains itself still has something to say.
 */
export const MAX_INPUT_LENGTH = MAX_NAME_LENGTH * 16;

export interface SanitiseResult {
  /** Safe to store, render and transmit. Empty when nothing survived. */
  readonly text: string;
  /** Why the input changed, for a UI that would rather explain than silently eat it. */
  readonly reasons: readonly SanitiseReason[];
}

export type SanitiseReason =
  | 'trimmed-whitespace'
  | 'collapsed-whitespace'
  | 'removed-control-characters'
  | 'removed-bidi-override'
  | 'removed-disallowed-characters'
  | 'truncated'
  | 'empty';

/**
 * Characters that reorder or hide text without being visible themselves.
 *
 * This is how a name that reads as one thing renders as another: a right-to-left
 * override can make `evil.exe` display as `exe.live`, and a zero-width joiner can hide a
 * word break entirely. They are invisible, so no reviewer catches them by looking.
 *
 * Written as escapes rather than as literals precisely because they are invisible — a
 * literal here would be unreviewable in the file it lives in.
 */
const INVISIBLE_OR_BIDI = /[\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu;

/**
 * C0 and C1 control characters. A newline in a name is a log-forging primitive.
 *
 * `no-control-regex` is correct to flag this in general — a control character in a
 * pattern is nearly always a mistake or a copy-paste accident. Here it is the subject:
 * the whole purpose of this expression is to find them so they can be removed.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/gu;

/**
 * What a name may contain: letters, marks and digits in any script, plus the small set
 * of punctuation people genuinely have in their names.
 *
 * `\p{L}` and `\p{N}` rather than `A-Za-z`, because a player whose name is written in
 * Japanese or Cyrillic has as much right to it as one called Smith.
 *
 * `\p{M}` matters more than it looks. Combining marks are not letters, and without them
 * a filter mangles rather than rejects: सुनीता came out as सनत, with every vowel sign
 * stripped, because in Devanagari — and Arabic, Thai, Hebrew and many others — the marks
 * carry the vowels. A name filter that silently deletes half of someone's name is worse
 * than one that refuses it, because nobody can see what went wrong.
 */
const ALLOWED = /[^\p{L}\p{M}\p{N} '\-_.]/gu;

/**
 * Make a player-supplied name safe.
 *
 * Never throws and never returns null: a caller rendering a scoreboard needs a string.
 * Input that survives nothing returns empty text with an `empty` reason, and the caller
 * decides whether that means "reject this" or "use the default seat name".
 */
export function sanitisePlayerName(input: unknown): SanitiseResult {
  const reasons: SanitiseReason[] = [];

  // Anything at all can arrive here: a peer's payload, a stale localStorage entry, a
  // hand-edited URL. A non-string is not an error, it is simply nothing.
  if (typeof input !== 'string') return { text: '', reasons: ['empty'] };

  let text = input;

  // Bounded before any pattern is applied, which is the whole of #2387's third action item.
  // Cheapest possible check, and it must come first: every pass below is linear in the
  // length of what it is handed.
  if (text.length > MAX_INPUT_LENGTH) {
    text = text.slice(0, MAX_INPUT_LENGTH);
    reasons.push('truncated');
  }

  const withoutControl = text.replace(CONTROL, '');
  if (withoutControl !== text) reasons.push('removed-control-characters');
  text = withoutControl;

  const withoutBidi = text.replace(INVISIBLE_OR_BIDI, '');
  if (withoutBidi !== text) reasons.push('removed-bidi-override');
  text = withoutBidi;

  // Normalised before filtering, or a composed and a decomposed form of the same name
  // are different strings — and one may pass the filter while the other does not, which
  // is a bypass rather than a curiosity.
  text = text.normalize('NFC');

  const allowed = text.replace(ALLOWED, '');
  if (allowed !== text) reasons.push('removed-disallowed-characters');
  text = allowed;

  const collapsed = text.replace(/\s{2,}/g, ' ');
  if (collapsed !== text) reasons.push('collapsed-whitespace');
  text = collapsed;

  const trimmed = text.trim();
  if (trimmed !== text) reasons.push('trimmed-whitespace');
  text = trimmed;

  if ([...text].length > MAX_NAME_LENGTH) {
    // Sliced by code point rather than by UTF-16 unit: cutting mid-surrogate leaves a
    // lone half that is not valid text and renders as a replacement character.
    text = [...text].slice(0, MAX_NAME_LENGTH).join('');
    // Guarded so an over-long input that is also over the *name* limit reports the one
    // reason once rather than twice — the list is for a UI to explain itself with, and
    // "truncated, truncated" explains nothing.
    if (!reasons.includes('truncated')) reasons.push('truncated');
  }

  if (text.length === 0) reasons.push('empty');

  return { text, reasons };
}

/** Whether `input` survives sanitising unchanged. For validating before accepting. */
export function isValidPlayerName(input: unknown): boolean {
  if (typeof input !== 'string' || input.length === 0) return false;
  return sanitisePlayerName(input).text === input;
}

/* ------------------------------------------------------------- shareable output ---- */

/**
 * Words a name may not carry into anything that leaves the device (#161, #164).
 *
 * ## Where this applies, and where it deliberately does not
 *
 * A player may call themselves what they like on their own screen: the settings page does not
 * consult this, and neither does the scoreboard. #161 asks for a filter "before any shareable
 * output", and that is exactly where it sits — the share card (#164) is the one artefact this
 * product produces that is meant to be handed to somebody who was not in the room, and a name
 * on it that would get the card taken down is a card nobody can share. So the card substitutes
 * the seat's own character name for a blocked one and says nothing else.
 *
 * ## What "blocked" means, precisely
 *
 * A **whole token** match, never a substring. Every blocklist that ever ate a real name did it
 * by substring — Scunthorpe, Penistone, Cockburn, Assange, Dickens — and the cure is to compare
 * words, not characters. A name is split into runs of letters and digits, each run is folded
 * (case, diacritics, the digits and symbols people use as letters), and each folded run is
 * looked up. `Scunthorpe` is one token and it is not on the list.
 *
 * Two evasions are folded rather than listed: leetspeak (`sh1t`, `f4ggot`) and a letter
 * repeated for emphasis (`fuuuck`). Both fold *toward* the list — runs of three or more of one
 * letter collapse to one, so that `ass` stays `ass` and a name with a natural double letter is
 * untouched. Separators inside a word (`f_u_c_k`, `f.u.c.k`) are handled by looking up the
 * whole name with separators removed as well as its tokens: that is still a whole-string
 * comparison, so it cannot reintroduce the substring problem.
 *
 * ## What is on the list, and why it is short
 *
 * Slurs and the handful of words that make a screenshot unpostable. Deliberately not `dick`,
 * `cock`, `ass` or `hell`: each is somebody's surname or an ordinary word, and a filter that
 * refuses Mr Dickens's card to catch a schoolboy's joke has its priorities backwards. The list
 * is English because the product is; a name in another script is checked by the same rule
 * against the same list, which is to say it is not checked, and that is stated rather than
 * pretended otherwise.
 */
const BLOCKED_WORDS: ReadonlySet<string> = new Set([
  'fuck',
  'fucker',
  'fuckers',
  'fucking',
  'fucked',
  'motherfucker',
  'shit',
  'shite',
  'shitty',
  'bullshit',
  'cunt',
  'cunts',
  'bitch',
  'bitches',
  'asshole',
  'assholes',
  'twat',
  'twats',
  'wanker',
  'wankers',
  'whore',
  'whores',
  'slut',
  'sluts',
  'pussy',
  'nigger',
  'niggers',
  'nigga',
  'niggas',
  'faggot',
  'faggots',
  'fag',
  'fags',
  'retard',
  'retards',
  'retarded',
  'kike',
  'kikes',
  'spic',
  'spics',
  'chink',
  'chinks',
  'paki',
  'pakis',
  'tranny',
  'trannies',
  'rapist',
  'rapists',
]);

/** Digits and symbols people use as letters, folded to the letter they stand for. */
const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'l',
};

/** Case, diacritics, leetspeak and emphasis folded away; only letters and digits remain. */
function fold(text: string): string {
  const lowered = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  let out = '';
  for (const char of lowered) {
    const mapped = LEET[char] ?? char;
    if (/[\p{L}\p{N}]/u.test(mapped)) out += mapped;
  }
  // Three or more of one letter collapse to one, so `fuuuck` folds toward the list and `ass`
  // (two) does not fold away from it.
  return out.replace(/(.)\1{2,}/gu, '$1');
}

/**
 * Whether `name` carries a word that may not appear on anything shareable.
 *
 * Never throws; a non-string is not a name and is not blocked. See the note above for what
 * counts as a match, and `player-text.test.ts` for the names this must never refuse.
 */
export function containsBlockedWord(name: unknown): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  // Bounded for the same reason `sanitisePlayerName` is: this runs on text that came from
  // storage or a peer, and the cost has to be linear in something we chose.
  const text = name.length > MAX_INPUT_LENGTH ? name.slice(0, MAX_INPUT_LENGTH) : name;
  const tokens = text.split(/[^\p{L}\p{N}@$!|]+/u).filter((token) => token.length > 0);
  for (const token of tokens) {
    if (BLOCKED_WORDS.has(fold(token))) return true;
  }
  // The whole name with its separators removed, so `f_u_c_k` and `f.u.c.k` are one word —
  // still a whole-string lookup, so a real name that merely contains one is not caught.
  return tokens.length > 1 && BLOCKED_WORDS.has(fold(tokens.join('')));
}
