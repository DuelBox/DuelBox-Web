/**
 * Which languages exist, what a stored or requested one resolves to, and the two attributes a
 * locale stamps on the document (#219, and the `dir` half of #222).
 *
 * Deliberately free of any message text: this module is the registry and the validation, and
 * every non-default locale's strings live in an async chunk under `catalogues/` that only a
 * player who picks that locale ever downloads. Keeping the two apart is what makes "only the
 * active locale downloads" a property of the layout rather than a promise — see `load.ts`,
 * and `i18n.test.ts` for the guard that fails if anything but `load.ts` names a catalogue, or
 * names one outside an `import()`.
 *
 * ## No automatic detection, on purpose
 *
 * Nothing here reads `navigator.language`, and nothing should. `docs/privacy-policy.md` states
 * as a checked row that this product does not look at it, and a language is a strong enough
 * hint about a person that reading it silently is a different promise from the one the privacy
 * page makes. The locale is an explicit choice: the control on `/settings/`, or a `?lang=` on
 * a link somebody chose to follow.
 *
 * ## Read by a build script as well as by code
 *
 * `scripts/check-size.mjs` reads the `LOCALES` literal below with a regular expression — one
 * key per line, each followed by `{` — the way it reads `registry.ts` for the game chunks, so
 * that the build can insist on exactly one emitted chunk per non-default locale and fail if
 * one is missing, doubled, or folded into the shell. Keep the shape: a quoted or bare code,
 * a colon, an object, one locale per line.
 */

/** Which way a locale's text runs, and therefore which way the shell is laid out. */
export type TextDirection = 'ltr' | 'rtl';

/** What the registry says about one locale. */
export interface LocaleInfo {
  /**
   * The name shown in the language control, written in the language it names. That is the
   * convention a language menu follows: somebody looking for their language cannot read the
   * name of it in a language they do not have. A pseudo-locale is named for what it is.
   */
  readonly name: string;
  /**
   * Stamped on `<html dir>` along with `lang`. A right-to-left locale mirrors the whole shell
   * through the browser's own bidi layout — flex rows, text alignment, logical paddings —
   * which is exactly what #222 needs to see in order to fix what does not mirror well.
   */
  readonly dir: TextDirection;
}

/**
 * The locale every visitor gets unless they ask for another one.
 *
 * It is special in one way that matters to the budget: English is the source language, so it
 * has no catalogue at all — every lookup falls through to the English id the call site already
 * carries (see `messages.ts`). There is no chunk for it, and `loadCatalogue` short-circuits
 * before it would import anything. A visitor who never touches the control pays nothing at all
 * for this framework beyond the lookup.
 */
export const DEFAULT_LOCALE = 'en';

/**
 * Every locale offered.
 *
 * Two of the three are **pseudo-locales, not translations**, and neither must ever be presented
 * as one. `en-XA` is the accented, padded rendering of the English source that i18n work is
 * conventionally proved against; `ar-XB` is the same English with each word forced to render
 * right-to-left, in a locale whose `dir` is `rtl`, so the shell's mirrored layout can be looked
 * at before any real right-to-left language exists here. They are here because a framework with
 * one locale in it proves nothing — nothing lazy-loads, nothing switches, nothing mirrors — and
 * because inventing a machine translation would pre-empt #221, whose acceptance criterion is
 * review by somebody who speaks the language: a locale nobody has read is a locale that reads as
 * broken to the people it claims to serve, and a pseudo-locale cannot be mistaken for one.
 *
 * `en-XA`'s padding is what #223 measures layouts against; `ar-XB`'s direction is what #222
 * fixes layouts against. Both are generated from the extracted English by `pseudo.ts`, so they
 * are complete by construction and a string still in plain English on either is a literal #220
 * has not reached. Real locales arrive with #221; when they do, this table, the `catalogues/`
 * directory and the map in `load.ts` all have to agree, and `i18n.test.ts` fails if they do not.
 *
 * `ar-XB` is named in plain English rather than mirrored, and that is a usability decision: the
 * name's job is to be found again by somebody who has just watched the whole site flip and wants
 * the way back, and a mirrored option label in a `<select>` is the one thing in that state that
 * must stay readable.
 */
export const LOCALES = {
  en: { name: 'English', dir: 'ltr' },
  'en-XA': { name: 'Éñglïšh (pseudo)', dir: 'ltr' },
  'ar-XB': { name: 'Right-to-left (pseudo)', dir: 'rtl' },
} as const satisfies Readonly<Record<string, LocaleInfo>>;

/** A language this build knows how to render. */
export type LocaleCode = keyof typeof LOCALES;

/** Every code in {@link LOCALES}, in the order the control offers them. */
export const LOCALE_CODES = Object.keys(LOCALES) as readonly LocaleCode[];

/** Whether some value out of storage, a URL or another build is a locale this one has. */
export function isLocale(value: unknown): value is LocaleCode {
  return typeof value === 'string' && (LOCALE_CODES as readonly string[]).includes(value);
}

/**
 * A locale code from whatever was actually stored or asked for.
 *
 * Anything unrecognised becomes the default rather than being kept: a code from a build that
 * shipped a locale this one does not have would otherwise leave the reader holding a string it
 * cannot load a catalogue for, and the switcher offering a value it cannot honour. The same rule
 * `settings.ts` applies to `theme` and `seatPalette`, for the same reason.
 */
export function resolveLocale(raw: unknown): LocaleCode {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

/**
 * The locale a `?lang=` on the URL asks for, or `null` if it asks for nothing usable.
 *
 * Pure and string-in, so it can be tested without a browser. An unknown code is `null` rather
 * than the default, because "asked for a language this build does not have" and "did not ask"
 * have to be told apart from a *valid* request by the caller: only the last should overwrite a
 * choice the player already made.
 *
 * The query is read and never written back. The site is a static export with a canonical URL
 * per page; rewriting the address bar to carry a locale would put a second URL under every one
 * of them for a crawler to find, which is a routing decision for #220 rather than a side effect
 * of a language control. `provider.tsx` is the one reader.
 */
export function localeFromSearch(search: string): LocaleCode | null {
  const requested = new URLSearchParams(search).get('lang');
  return requested !== null && isLocale(requested) ? requested : null;
}

/**
 * Puts a locale into effect on the document by setting `lang` and `dir` on `<html>`.
 *
 * The two things a locale changes outside React. `lang` is what a screen reader picks a voice
 * and a pronunciation dictionary from and what a browser hyphenates by, so text swapped into
 * another language under a stale `lang="en"` is read aloud wrongly even though it looks right.
 * `dir` is what the browser lays the page out by, and it is stamped on every call rather than
 * only for a right-to-left locale so that switching *back* from one puts the shell the right way
 * round again.
 *
 * A no-op where there is no document — the static render on the build machine, and the unit
 * suite — so a caller need not guard, exactly as `applyTheme` does not. The default locale sets
 * `lang="en"` rather than removing the attribute, because unlike `data-theme` this one is in the
 * server-rendered markup (`layout.tsx`) and removing it would leave the page with no language.
 *
 * The inline script in `layout.tsx` makes the same two stamps before the first paint from the
 * stored settings, so a right-to-left choice never flashes left-to-right; it cannot import this
 * module and carries its own copy of the codes, which `i18n.test.ts` holds to this registry.
 * The other half of that promise is the provider's: it calls this only once the stored settings
 * have been read, because calling it with the default first would undo the script's stamp for
 * one frame — `provider.tsx` records the measurement.
 */
export function applyLocale(locale: LocaleCode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('lang', locale);
  root.setAttribute('dir', LOCALES[locale].dir);
}
