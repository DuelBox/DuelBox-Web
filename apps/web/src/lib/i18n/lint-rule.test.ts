import { Linter, type Rule } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import rule from '../../../../../scripts/eslint-rules/no-untranslated-text.mjs';

/**
 * `duelbox/no-untranslated-text`, run by ESLint's own `Linter` on fixtures (#220).
 *
 * The rule is applied by `eslint.config.js` to the files in `I18N_CLEAN`, all of which are
 * clean — so `pnpm lint` passing says nothing about whether the rule can fail. This file is
 * where it fails: a bare literal, an attribute literal and a template literal each produce a
 * report, and the things it must let through — a `t()` call, a `<T>`, an expression, a
 * decorative `alt=""`, anything inside `<noscript>` — produce none. The same parser the real
 * lint uses, so a fixture is parsed as the product's `.tsx` would be.
 *
 * The seven attributes are listed *here*, not imported from the rule. The first draft proved
 * three of them (`aria-label`, `placeholder`, `alt`) and its only `title=` fixture sat inside
 * `<noscript>` expecting nothing, so `title`, `aria-description`, `aria-roledescription` and
 * `aria-valuetext` could each be dropped from the rule — or misspelt — with every test green;
 * a review did exactly that with `title` and watched four tests pass. A list the rule does not
 * own, with one positive fixture per entry, fails on either change, and it is the list the
 * rule's header and `docs/i18n.md` promise.
 */

const plugin = { rules: { 'no-untranslated-text': rule as Rule.RuleModule } };

/** The attributes the rule's header promises, each of which must produce a report on its own. */
const ATTRIBUTES = [
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
] as const;
const linter = new Linter();

function lint(code: string): string[] {
  return linter
    .verify(
      code,
      [
        {
          files: ['**/*.tsx'],
          plugins: { duelbox: plugin },
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          rules: { 'duelbox/no-untranslated-text': 'error' },
        },
      ],
      'fixture.tsx',
    )
    .map((message) => message.message);
}

describe('no-untranslated-text', () => {
  it('reports bare text in JSX', () => {
    const messages = lint('const a = <h1>Settings</h1>;');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Bare text in JSX: "Settings"');
  });

  it.each(ATTRIBUTES)('reports a string literal in %s, and names the attribute', (name) => {
    expect(lint(`const a = <x ${name}="Words" />;`)).toEqual([
      expect.stringContaining(`${name} is read to the visitor and its value is a literal: "Words"`),
    ]);
  });

  it('reports a literal in a user-facing attribute, string or template', () => {
    expect(lint('const a = <button aria-label="Mute sound" />;')).toEqual([
      expect.stringContaining(
        'aria-label is read to the visitor and its value is a literal: "Mute sound"',
      ),
    ]);
    expect(lint('const a = <input placeholder={`Seat ${n}`} />;')).toEqual([
      expect.stringContaining('placeholder'),
    ]);
    expect(lint("const a = <img alt={'A board'} />;")).toEqual([expect.stringContaining('alt')]);
  });

  it('passes a t() call, a <T>, an expression and text with no letters in it', () => {
    expect(
      lint(
        'const a = <button aria-label={t(messages, "Mute sound")}><T id="Mute sound" /></button>;',
      ),
    ).toEqual([]);
    expect(lint('const a = <p>{label}</p>;')).toEqual([]);
    expect(lint('const a = <span aria-hidden="true">🔊</span>;')).toEqual([]);
    expect(lint('const a = <p>{n}%</p>;')).toEqual([]);
    expect(lint('const a = <input aria-valuetext={`${n}%`} />;')).toEqual([]);
    expect(lint('const a = <img alt="" />;')).toEqual([]);
    // Attributes nobody reads are none of this rule's business.
    expect(lint('const a = <a className="db-skip" href="#main" id="x" />;')).toEqual([]);
  });

  it('exempts everything inside <noscript>, and nothing outside it', () => {
    expect(
      lint('const a = <noscript><p title="Turn on scripting">Needs scripting.</p></noscript>;'),
    ).toEqual([]);
    expect(lint('const a = <div><noscript>Off</noscript><p>On</p></div>;')).toEqual([
      expect.stringContaining('"On"'),
    ]);
  });
});
