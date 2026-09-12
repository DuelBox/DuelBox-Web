import { CATALOGUE } from '../apps/web/src/data/catalogue.generated';
import {
  FONT_ATTRIBUTIONS,
  RUNTIME_DEPENDENCIES,
} from '../apps/web/src/app/attribution/attribution-data.generated';
import { LOCALES } from '../apps/web/src/lib/i18n/locales';
import { SEAT_CHARACTERS, SEAT_KEYS } from '../apps/web/src/lib/seats';

/**
 * What `pseudo-sweep.spec.ts` may find in plain letters on a pseudo-localised screen (#220).
 *
 * Every string the site translates renders inside `⟦ ⟧` under `?lang=en-XA`, so a run of
 * letters outside the brackets is one of two things: a literal the extractor never saw, which
 * is the defect the sweep exists to catch, or a string `docs/i18n.md` says is deliberately not
 * translated. This is the list of the second kind, each entry with the reason it is here, and
 * the reason is the part that matters: an entry without one is a way to make the sweep pass.
 *
 * Entries are read from the same data the pages render — the catalogue, the registry, the
 * attribution record — rather than retyped, so a game added tomorrow is allowed by the same
 * rule that allows the hundred and eight today, and a licence the attribution page stops
 * naming stops being allowed with it.
 */
export interface Allowed {
  /** The exact text, matched as a whole word: `Bo` does not excuse `Bot`. */
  readonly text: string;
  readonly reason: string;
}

export const PSEUDO_ALLOWLIST: readonly Allowed[] = [
  ...CATALOGUE.map((game) => ({
    text: game.name,
    reason: 'a game name: check-game-names.mjs holds it against the reference app (rule 1)',
  })),
  ...Object.values(LOCALES).map((locale) => ({
    text: locale.name,
    reason: 'a language names itself in the menu, so somebody can find their own',
  })),
  { text: 'DuelBox', reason: 'the brand' },
  ...SEAT_KEYS.flatMap((keys) => [keys.move, keys.action]).map((cap) => ({
    text: cap,
    reason: 'a key cap on the controls table: what is printed on the key',
  })),
  { text: 'Esc', reason: 'a key cap in the how-to-play prose, like the table above it' },
  ...Object.values(SEAT_CHARACTERS).map((name) => ({
    text: name,
    reason: 'a seat character is a name, and a chosen player name replaces it',
  })),
  ...RUNTIME_DEPENDENCIES.flatMap((dependency) => [
    { text: dependency.name, reason: 'a package name on /attribution/' },
    { text: dependency.licence, reason: 'a licence identifier on /attribution/' },
  ]),
  ...FONT_ATTRIBUTIONS.flatMap((font) => [
    { text: font.family, reason: 'a font family name on /attribution/' },
    { text: font.licence, reason: 'a licence name on /attribution/' },
    { text: font.author, reason: 'an author name on /attribution/' },
  ]),
  { text: 'duelbox', reason: 'the storage-key prefix /privacy/ quotes in <code>' },
  // The five landmark names. Each is an attribute in a server component — an attribute cannot
  // hold an element, so <T> cannot reach it, and t() needs a client boundary — and four of the
  // five are in the root layout, where a boundary is paid in all 108 play payloads (docs/i18n.md,
  // "deliberately not translated"). Read by assistive technology only.
  { text: 'DuelBox home', reason: "the brand link's accessible name in the root layout's header" },
  { text: 'Main', reason: "the header nav's landmark name, in the root layout" },
  { text: 'Footer', reason: "the footer nav's landmark name, in the root layout" },
  { text: 'Game categories', reason: "the footer hubs nav's landmark name, in the root layout" },
  { text: 'Breadcrumb', reason: "the crumb nav's landmark name on a game page and a hub page" },
  {
    text: 'src/styles/fonts/OFL.txt',
    reason: 'a path into this repository, quoted on /attribution/',
  },
];

/** Shapes rather than strings: things the letters of no list could enumerate. */
export const PSEUDO_ALLOWED_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly reason: string;
}[] = [
  { pattern: /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/u, reason: 'an email address' },
  { pattern: /^\p{Lu}$/u, reason: 'a single capital letter is a key cap (the key boxes)' },
];
