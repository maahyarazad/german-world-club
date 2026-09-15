import siteConfig from '../config/site.js'

/**
 * The Experts Circle mark: an "EC" monogram ringed by twelve points, for the
 * circle of experts the network gathers.
 *
 * PLACEHOLDER IDENTITY — the repository contains no official Experts Circle
 * logo. If the club has one, it replaces the contents of this file and nothing
 * else. Drawn inline so it scales cleanly, inherits `currentColor`, and costs
 * no extra network request.
 */
function BrandMark({ size = 72, className = '', title }) {
  const label = title ?? `${siteConfig.brandName} — ${siteConfig.parentOrg}`

  // Twelve evenly spaced points around the ring.
  const points = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2
    return {
      cx: 40 + Math.cos(angle) * 33,
      cy: 40 + Math.sin(angle) * 33,
      r: i % 3 === 0 ? 1.9 : 1.1,
    }
  })

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      role="img"
      aria-label={label}
      className={className}
      fill="none"
    >
      <circle cx="40" cy="40" r="38" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
      <circle cx="40" cy="40" r="27" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.25" />

      {points.map((p, i) => (
        <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill="currentColor" fillOpacity="0.75" />
      ))}

      <text
        x="40"
        y="40"
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        fontFamily="ui-serif, Georgia, 'Times New Roman', serif"
        fontSize="23"
        fontWeight="500"
        letterSpacing="0.5"
      >
        EC
      </text>
    </svg>
  )
}

export default BrandMark
