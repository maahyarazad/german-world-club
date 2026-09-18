/**
 * A status pill.
 *
 * `children` is required, and that is deliberate: the pill carries its meaning
 * in its word — freigegeben, in Prüfung, Rückfrage — and the tint is
 * reinforcement. A pill that meant "approved" only by being green would be
 * unreadable to anyone who cannot separate the tints from each other, and the
 * mockups always show the word.
 */
const TONES = {
  success: 'bg-tint-success text-tint-success-fg',
  pending: 'bg-tint-gold text-tint-gold-fg',
  danger: 'bg-tint-danger text-tint-danger-fg',
  info: 'bg-tint-info text-tint-info-fg',
  neutral: 'bg-ground text-text-muted',
}

export function StatusPill({ tone = 'neutral', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2.5 py-1 text-[12px] font-medium ${
        TONES[tone] ?? TONES.neutral
      } ${className}`}
    >
      {children}
    </span>
  )
}

export default StatusPill
