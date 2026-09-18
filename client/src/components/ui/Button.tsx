/**
 * The three buttons the mockups use, and no fourth.
 *
 * `accent` is the gold one ("Neues Angebot", "Menschliche Unterstützung"). It
 * exists because the design document permits gold as an *action* accent — and
 * it is the only gold fill in the system. Note the label is ink, not white:
 * #D49626 carries white at 2.4:1 and would fail AA. On ink it is 7.0:1.
 *
 * There is no `danger` variant. A destructive action in this console is a
 * secondary button behind a confirmation (FR-020), not a red button that
 * invites the click it is warning about.
 */
const VARIANTS = {
  primary: 'bg-navy text-text-on-dark hover:bg-navy-2',
  accent: 'bg-accent text-ink hover:brightness-95',
  secondary: 'bg-surface text-text border border-hairline hover:bg-ground',
  quiet: 'bg-transparent text-navy hover:bg-ground',
}

export function Button({
  variant = 'primary',
  type = 'button',
  disabled = false,
  children,
  className = '',
  ...rest
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-card px-4 py-2.5 text-[13px] font-semibold
        transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy
        disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant] ?? VARIANTS.primary} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export default Button
