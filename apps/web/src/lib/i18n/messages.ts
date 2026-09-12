/**
 * The lookup, the interpolation and the plural rule — everything a component needs to render a
 * string in the active locale, and nothing that knows how a locale is fetched (#219).
 *
 * ## The English string is the key
 *
 * `t(messages, 'Mute sound')` looks up the English sentence itself, and a catalogue is
 * `{ 'Mute sound': 'Silenciar' }`. There is no `sound.mute` id and no table mapping ids to
 * English, and that is a budget decision rather than a taste: the shell has under a kilobyte of
 * headroom (`size-budget.json`), and a dotted-key design ships every string twice — once in the
 * English table and once, as the id, at the call site — for a few kilobytes gzipped across the
 * site's copy. English-as-key moves a literal that was already in the chunk into a call and
 * costs the wrapper only. It also lets a *data* string travel through the same lookup: a game's
 * `rule` from `catalogue.generated.ts` or a category name is `t(messages, entry.rule)` with
 * nothing extracted by hand (`sources.ts` is where those sources are registered so the
 * extractor can see them), and it makes #220's lint rule mechanical — no bare JSX text, and the
 * user-facing attributes go through `t()` — because there is no id to invent.
 *
 * The cost of the choice is the one every English-keyed system pays: two English sentences that
 * happen to be identical but mean different things share one translation. When that bites, the
 * fix is to make the English differ, which is usually the better English anyway.
 *
 * ## Why it is pure
 *
 * The catalogue is passed in rather than read from a context here, so `t` is the same function
 * in a component, in a test and on the build machine, and so that the extractor
 * (`extract.ts`) can find every call by shape: a call to `t` whose second argument is a string
 * literal, or a conditional between literals. A missing key falls through to the English id, so
 * a half-translated screen shows the source language rather than a blank.
 */

/** One locale's strings, keyed by the English source string. */
export type Catalogue = Readonly<Record<string, string>>;

/** What a `{name}` in a message may be filled with. */
export type Values = Readonly<Record<string, string | number>>;

/**
 * The English `one` and `other` forms of a counted phrase, both with `{count}` in them.
 *
 * Keyed by English's own two categories so the source reads naturally at the call site. A
 * locale with more categories supplies the extra ones under a suffixed key — see {@link plural}.
 */
export interface PluralForms {
  readonly one: string;
  readonly other: string;
}

/**
 * `{name}` placeholders filled from `values`.
 *
 * A placeholder with no value is left as written rather than rendered as `undefined`, because a
 * translator's typo in a placeholder name should show up as a visible `{nmae}` on the pseudo
 * screen, not as a word missing from a sentence. `replace` with a callback handles the same
 * placeholder appearing twice, which a translation is free to do even when the English does not.
 */
function fill(text: string, values: Values): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}

/**
 * The active locale's string for an English id, with any `{placeholders}` filled in.
 *
 * `catalogue[id] ?? id`: the English source is its own fallback, so the default locale needs
 * no catalogue at all and an untranslated string in any other locale reads as English.
 */
export function t(catalogue: Catalogue, id: string, values?: Values): string {
  const text = catalogue[id] ?? id;
  return values === undefined ? text : fill(text, values);
}

/**
 * A counted phrase in the active locale, chosen by that locale's own plural rule.
 *
 * `Intl.PluralRules` is the one piece of `Intl` this framework uses, and it is used for the one
 * thing that cannot be done by hand: which of a language's categories a number falls into.
 * English has two, `one` and `other`, and the call site supplies both in English. A locale with
 * more — Arabic has six, Polish four — supplies the extra forms in its catalogue under the
 * English `other` form suffixed with the category: `'{count} games#few': '{count} gry'`. The
 * suffix is a convention rather than a schema so the catalogue stays a flat record of strings,
 * which is what keeps the chunk small and the extractor simple.
 *
 * The fallback chain, in order: the suffixed form for this category; the translation of the
 * English form for `one` or `other`; the English form itself. So a locale that has not supplied
 * its `few` yet shows its `other`, and a locale with no catalogue at all shows English — the same
 * degradation `t` has.
 */
export function plural(
  catalogue: Catalogue,
  locale: string,
  count: number,
  forms: PluralForms,
): string {
  const category = new Intl.PluralRules(locale).select(count);
  const base = category === 'one' ? forms.one : forms.other;
  const extra =
    category === 'one' || category === 'other' ? undefined : `${forms.other}#${category}`;
  const text = (extra === undefined ? undefined : catalogue[extra]) ?? catalogue[base] ?? base;
  return fill(text, { count });
}
