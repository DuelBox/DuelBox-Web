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
      DuelBox
    </span>
  );
}
