import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import ts from 'typescript';
import { DEFAULT_LOCALE, LOCALE_CODES, type LocaleCode } from './locales';
import { pseudoAccent, pseudoMirror } from './pseudo';
import { dynamicMessages } from './sources';

/**
 * The message extractor: every English string the site can render, read out of the source by
 * shape, and the generated files derived from that list (#219, #220, #223).
 *
 * Runs on the build machine only — from `extract.test.ts`, which is both the guard and the
 * generator — and never in a browser, so the TypeScript compiler API and prettier are free to
 * be used here without touching a byte budget.
 *
 * ## What counts as a message
 *
 * A string is a message when it is the id of a lookup, and the lookups have exactly three
 * shapes, all of them found by walking the syntax tree rather than by regular expression:
 *
 *   - `t(<anything>, '…')` — the second argument a string literal, or a conditional between
 *     string literals (`muted ? '…' : '…'`), so a call that chooses between two labels
 *     contributes both;
 *   - `plural(…, { one: '…', other: '…' })` — the two English forms in the forms object;
 *   - `<T id="…" />` — the `id` attribute, as a string or as `{'…'}`.
 *
 * Only calls to the `t`, `plural` and `T` that were imported from `lib/i18n/messages` and
 * `lib/i18n/T` count. `lib/format.ts` has a `plural` of its own, `stripForbiddenKeys<T>` has
 * a type parameter called `T`, and a walk that matched on the name alone would have read both.
 * The import is resolved per file, aliases included, so `import { t as translate }` still works.
 *
 * A string that reaches a lookup through a variable — `t(messages, entry.rule)` — has no shape
 * to find and is registered in `sources.ts` instead; the two lists are concatenated below.
 * Anything else is deliberately invisible: a message that is not a literal at the call site and
 * not a registered source is not extracted, will render in plain English under both
 * pseudo-locales, and is exactly what those locales exist to make visible.
 *
 * ## What is generated from the list
 *
 * `messages.en.generated.json` — the sorted, de-duplicated msgids, which is what a translator
 * is handed and what `i18n.test.ts` holds every catalogue's keys against. And one catalogue
 * module per pseudo-locale, `catalogues/<code>.generated.ts`, each complete by construction:
 * every msgid run through that locale's transform in `pseudo.ts`. Both are committed, like
 * `data/catalogue.generated.ts`, and `extract.test.ts` fails when what is committed is not
 * what this would write now — so a converted string that was not followed by
 * `pnpm i18n:extract` is a red build rather than a gap in the pseudo screen.
 *
 * Prettier formats the output through its API with the repository's own config, so a generated
 * file passes `pnpm format:check` whether or not `.prettierignore` happens to exempt it (the
 * `.ts` files are exempt; the `.json` is not).
 */

const here = dirname(fileURLToPath(import.meta.url));

/** `apps/web/src`, the tree that is walked. */
export const WEB_SRC = join(here, '..', '..');

/** Where the generated catalogues go. */
export const CATALOGUE_DIR = join(here, 'catalogues');

/** The sorted msgid list, as a JSON array. */
export const MSGID_FILE = join(here, 'messages.en.generated.json');

/** The module specifiers a lookup has to be imported from, matched on their tail. */
const MESSAGES_MODULE = /(?:^|\/)i18n\/messages$/;
const T_MODULE = /(?:^|\/)i18n\/T$/;

/**
 * Whether a file under `apps/web/src` is one whose lookups count.
 *
 * Tests are not product copy, generated files are output rather than input, declaration files
 * carry no JSX, and this directory is the framework itself — its docstrings mention `t(…)` in
 * prose and its own test files call `t` on purpose.
 */
export function isExtractable(path: string): boolean {
  const name = path.slice(path.lastIndexOf(sep) + 1);
  if (!/\.tsx?$/.test(name)) return false;
  if (/\.(?:test|generated|d)\.tsx?$/.test(name)) return false;
  return !path.startsWith(here + sep) && path !== here;
}

/** Every extractable file under `dir`, in a stable order. */
export function extractableFiles(dir: string = WEB_SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...extractableFiles(path));
    else if (isExtractable(path)) found.push(path);
  }
  return found;
}

/** A string literal's text, or `null` for any other expression. */
function literal(node: ts.Node): string | null {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

/** The literals an id expression can resolve to: one, or one per branch of a conditional. */
function literals(node: ts.Expression): string[] {
  if (ts.isParenthesizedExpression(node)) return literals(node.expression);
  if (ts.isConditionalExpression(node)) {
    return [...literals(node.whenTrue), ...literals(node.whenFalse)];
  }
  const text = literal(node);
  return text === null ? [] : [text];
}

/** The local names one file binds to `t`, `plural` and `T` through the i18n modules. */
function lookupNames(file: ts.SourceFile): { t: Set<string>; plural: Set<string>; T: Set<string> } {
  const names = { t: new Set<string>(), plural: new Set<string>(), T: new Set<string>() };
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const exported = (element.propertyName ?? element.name).text;
      const local = element.name.text;
      if (MESSAGES_MODULE.test(specifier) && (exported === 't' || exported === 'plural')) {
        names[exported].add(local);
      } else if (T_MODULE.test(specifier) && exported === 'T') {
        names.T.add(local);
      }
    }
  }
  return names;
}

/**
 * Every message id one source file contributes, in source order, duplicates included.
 *
 * `fileName` decides whether JSX is parsed — a `.tsx` extension — and is what a failure names.
 */
export function messagesIn(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const names = lookupNames(file);
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      const id = node.arguments[1];
      if (names.t.has(callee) && id !== undefined) found.push(...literals(id));
      if (names.plural.has(callee)) {
        for (const argument of node.arguments) {
          if (!ts.isObjectLiteralExpression(argument)) continue;
          for (const property of argument.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              (property.name.text === 'one' || property.name.text === 'other')
            ) {
              found.push(...literals(property.initializer));
            }
          }
        }
      }
    }
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      names.T.has(node.tagName.text)
    ) {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) continue;
        if (attribute.name.text !== 'id' || attribute.initializer === undefined) continue;
        const value = attribute.initializer;
        if (ts.isStringLiteral(value)) found.push(value.text);
        else if (ts.isJsxExpression(value) && value.expression !== undefined) {
          found.push(...literals(value.expression));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * Every message the site can render: the call sites under `root` plus the registered dynamic
 * sources, de-duplicated and sorted by code point so two runs cannot disagree on order.
 */
export function extractMessages(root: string = WEB_SRC): string[] {
  const found = new Set<string>(dynamicMessages());
  for (const path of extractableFiles(root)) {
    for (const id of messagesIn(readFileSync(path, 'utf8'), relative(root, path))) found.add(id);
  }
  return [...found].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The transform each generated locale applies to the English. A locale here is generated;
 * a locale in the registry that is not here is expected to arrive as a reviewed translation.
 */
export const PSEUDO: Readonly<Partial<Record<LocaleCode, (text: string) => string>>> = {
  'en-XA': pseudoAccent,
  'ar-XB': pseudoMirror,
};

/** The locales this generates a catalogue for: every registered one with a transform. */
export const GENERATED_LOCALES: readonly LocaleCode[] = LOCALE_CODES.filter(
  (code) => code !== DEFAULT_LOCALE && PSEUDO[code] !== undefined,
);

const HEADER =
  '// Generated by `pnpm i18n:extract` (apps/web/src/lib/i18n/extract.test.ts) from every\n' +
  '// message the site can render. Do not edit by hand: change the source, or the transform in\n' +
  '// pseudo.ts, and regenerate. extract.test.ts fails when this file is not what it would write.\n';

/** The unformatted source of one generated catalogue module. */
export function catalogueSource(locale: LocaleCode, msgids: readonly string[]): string {
  const transform = PSEUDO[locale];
  if (transform === undefined) throw new Error(`${locale} has no pseudo transform to generate`);
  const messages = Object.fromEntries(msgids.map((id) => [id, transform(id)]));
  // `as const` so `locale` is a literal type `load.ts` can accept, and so the object is exactly
  // what the minifier is shown: `locale:"<code>",messages:{…}` is the marker `check-size.mjs`
  // recognises a locale chunk by. Keep `locale` first.
  return (
    `${HEADER}\nconst catalogue = ${JSON.stringify({ locale, messages }, null, 2)} as const;\n\n` +
    'export default catalogue;\n'
  );
}

/** Where one generated catalogue lives. */
export function cataloguePath(locale: LocaleCode): string {
  return join(CATALOGUE_DIR, `${locale}.generated.ts`);
}

/**
 * Every generated file with its formatted content, keyed by absolute path: the msgid list and
 * one catalogue per generated locale. Formatted through prettier's API with the repository's
 * config so the committed bytes are the bytes `format:check` wants.
 */
export async function renderOutputs(msgids: readonly string[]): Promise<Map<string, string>> {
  const outputs = new Map<string, string>();
  const format = async (path: string, source: string): Promise<void> => {
    const config = (await prettier.resolveConfig(path)) ?? {};
    outputs.set(path, await prettier.format(source, { ...config, filepath: path }));
  };
  await format(MSGID_FILE, JSON.stringify(msgids));
  for (const locale of GENERATED_LOCALES) {
    await format(cataloguePath(locale), catalogueSource(locale, msgids));
  }
  return outputs;
}
