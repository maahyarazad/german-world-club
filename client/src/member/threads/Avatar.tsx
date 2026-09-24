import type { ThreadAuthor } from '@gwc/contracts/threads'
import { smallestUrl } from './MediaGrid'

/** A round avatar, or the member's initial when there is none. Sized explicitly (§10.9). */
export function Avatar({ author, size = 40, alt }: { author: Pick<ThreadAuthor, 'displayName' | 'handle' | 'avatar'>; size?: number; alt: string }) {
  const initial = (author.displayName ?? author.handle ?? '?').trim().charAt(0).toUpperCase()
  if (author.avatar) {
    return (
      <img
        src={smallestUrl(author.avatar, size * 2)}
        alt={alt}
        width={size}
        height={size}
        className="shrink-0 rounded-full bg-ground object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-navy font-semibold text-text-on-dark"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initial}
    </span>
  )
}

export default Avatar
