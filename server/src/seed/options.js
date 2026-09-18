/**
 * Flags for `seed:demo`.
 *
 * Volumes are adjustable without editing code (FR-021). The defaults are sized
 * for looking at rather than for load testing: hundreds of rows, enough to
 * paginate a list and to spread across every state the product models.
 */
export const DEFAULTS = Object.freeze({
  members: 200,
  staff: 12,
  merchants: 8,
  partners: 6,
  offers: 60,
  events: 25,
})

export function parseOptions(argv = process.argv.slice(2)) {
  const options = { ...DEFAULTS, random: false, quiet: false }

  for (const arg of argv) {
    if (arg === '--random') { options.random = true; continue }
    if (arg === '--quiet') { options.quiet = true; continue }

    const match = /^--([a-z]+)=(\d+)$/.exec(arg)
    if (match && Object.hasOwn(DEFAULTS, match[1])) {
      options[match[1]] = Number(match[2])
      continue
    }
    // An unrecognised flag is a typo, and silently ignoring it would produce a
    // run that did something other than what was asked without saying so.
    throw new Error(
      `unknown option ${JSON.stringify(arg)}\n` +
        `  volumes: ${Object.keys(DEFAULTS).map((k) => `--${k}=N`).join(' ')}\n` +
        '  flags:   --random --quiet',
    )
  }

  return options
}
