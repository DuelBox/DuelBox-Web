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
    reasons.push('truncated');
  }

  if (text.length === 0) reasons.push('empty');

  return { text, reasons };
}

/** Whether `input` survives sanitising unchanged. For validating before accepting. */
export function isValidPlayerName(input: unknown): boolean {
  if (typeof input !== 'string' || input.length === 0) return false;
  return sanitisePlayerName(input).text === input;
}
