/**
 * The mark in the header: two seat discs and the product's name.
 *
 * The name is **not** translated and is the one literal in this file (#220). A brand is a
 * name rather than a word — `docs/i18n.md` keeps game names untranslated for the same
 * reason and `scripts/check-game-names.mjs` enforces it for those — and this one is also
 * the accessible name of the link to the home page, which `e2e/smoke.spec.ts` and the
 * header's own `aria-label` both spell in English. It is in the root layout as well, so a
 * `<T>` here would be serialised into all 108 play-route payloads to say the same word
 * back. The lint rule is switched off for that one line rather than for the file, so a
 * second literal added here still fails.
 */
export function Wordmark() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--db-space-2)',
        fontFamily: 'var(--db-font-display)',
        fontSize: '1.35rem',
        fontWeight: 600,
        letterSpacing: '-0.01em',
      }}
    >
      <svg width="28" height="28" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <rect width="40" height="40" rx="11" fill="var(--db-brand)" />
        <circle cx="14.5" cy="20" r="6.5" fill="var(--db-p1)" />
        <circle cx="25.5" cy="20" r="6.5" fill="var(--db-p2)" />
      </svg>
      {/* eslint-disable duelbox/no-untranslated-text -- the brand name, see above. */}
      DuelBox
      {/* eslint-enable duelbox/no-untranslated-text */}
    </span>
  );
}
