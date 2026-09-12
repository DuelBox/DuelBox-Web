/**
 * `duelbox/no-untranslated-text` — a user-facing string that does not go through the i18n
 * lookup fails lint (#220, shipped with #219's framework as a ratchet).
 *
 * ## What it reports
 *
 *   1. **Bare text in JSX** — a `JSXText` node containing a letter. `<h1>Settings</h1>` is a
 *      string a translator can never reach; `<h1><T id="Settings" /></h1>` is one they can.
 *      Text with no letter in it — punctuation, a number, an emoji, the whitespace between two
 *      elements — is not copy and is left alone.
 *   2. **A literal in a user-facing attribute** — `aria-label`, `aria-description`,
 *      `aria-roledescription`, `aria-valuetext`, `title`, `placeholder` and `alt`, when the
 *      value is a string literal or a template literal with a letter in it. These are the
 *      attributes a screen reader speaks or a tooltip shows; `className`, `href`, `id` and the
 *      rest carry no words a person reads. `alt=""` — the decorative-image idiom — has no letter
 *      and passes.
 *   3. **Nothing inside `<noscript>`.** A scripting-off visitor cannot switch locale, the
 *      catalogue never loads for them, and `t()` would return the English id anyway. Marking
 *      up that block for translation would be marking it up for nothing, and the site's
 *      `<noscript>` copy is deliberately English (`docs/i18n.md`).
 *
 * What it does *not* see, and knows it does not: a string that reaches JSX through a variable,
 * a constant or a function return. `{FRAMED_NOTICE_TEXT}` is an expression, not text, and the
 * rule cannot follow it. That is the gap `docs/i18n.md` names for #220's pass to close by
 * reading, and it is why this rule is a ratchet on the shape of the JSX rather than a proof
 * that a file is translated.
 *
 * ## Why it is an allowlist of files today
 *
 * `eslint.config.js` applies it as an error to `I18N_CLEAN`, the explicit list of files whose
 * copy has been fully converted. Every other `.tsx` file is full of literals that #220 has not
 * reached and a repository-wide error would be a red build for weeks. A file is added to the
 * list in the commit that converts it, so what the list guarantees is that a converted file
 * stays converted. #220 grows the list to every `.tsx` and then replaces it with a glob, at
 * which point this stops being a ratchet and becomes the rule.
 *
 * ## Why it is a file under `scripts/` and not a package
 *
 * One rule, a hundred lines, used by one config. A local plugin object in the flat config is
 * the shape ESLint 9 documents for exactly this, and it means the rule is tested by the same
 * vitest run as everything else (`apps/web/src/lib/i18n/lint-rule.test.ts` runs `Linter` on
 * fixtures and watches it fail) rather than by a package's own harness nobody runs.
 */

/** The attributes whose value a person is shown or read. */
const ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
]);

/** Any letter in any script. A string with none is not copy. */
const LETTER = /\p{L}/u;

/** How much of the offending text a failure message shows. */
const EXCERPT = 60;

function isNoscript(node) {
  const name = node.openingElement.name;
  return name.type === 'JSXIdentifier' && name.name === 'noscript';
}

/**
 * The text of an attribute value if it is a string or template literal, else `null`.
 *
 * A template literal's text is its quasis joined — the fixed parts a translator would have
 * to translate — so `` `${n}%` `` reads as `%`, which has no letter and passes, and
 * `` `Seat ${n}` `` reads as `Seat ` and is reported.
 */
function literalText(value) {
  if (value === null || value === undefined) return null;
  if (value.type === 'Literal') return typeof value.value === 'string' ? value.value : null;
  if (value.type !== 'JSXExpressionContainer') return null;
  const expression = value.expression;
  if (expression.type === 'Literal') {
    return typeof expression.value === 'string' ? expression.value : null;
  }
  if (expression.type === 'TemplateLiteral') {
    return expression.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('');
  }
  return null;
}

const excerpt = (text) => {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > EXCERPT ? `${trimmed.slice(0, EXCERPT)}…` : trimmed;
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'User-facing text must go through t() or <T id="…" /> so a locale can translate it',
    },
    schema: [],
    messages: {
      text: 'Bare text in JSX: "{{text}}". Render it as <T id="…" /> (or t() in a client component) so a locale can translate it (#220).',
      attribute:
        '{{name}} is read to the visitor and its value is a literal: "{{text}}". Pass t(messages, "…") instead (#220).',
    },
  },
  create(context) {
    let noscript = 0;
    return {
      JSXElement(node) {
        if (isNoscript(node)) noscript += 1;
      },
      'JSXElement:exit'(node) {
        if (isNoscript(node)) noscript -= 1;
      },
      JSXText(node) {
        if (noscript > 0 || !LETTER.test(node.value)) return;
        context.report({ node, messageId: 'text', data: { text: excerpt(node.value) } });
      },
      JSXAttribute(node) {
        if (noscript > 0 || node.name.type !== 'JSXIdentifier') return;
        const name = node.name.name;
        if (!ATTRIBUTES.has(name)) return;
        const text = literalText(node.value);
        if (text === null || !LETTER.test(text)) return;
        context.report({ node, messageId: 'attribute', data: { name, text: excerpt(text) } });
      },
    };
  },
};
