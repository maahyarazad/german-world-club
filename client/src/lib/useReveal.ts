import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Brings a page's outcome message into view (feature 041,
 * `specs/041-scroll-to-form-message/`).
 *
 * A save that succeeds shows its message at the top of the page, and a person
 * who pressed Save at the bottom of a long form never sees it. The page passes
 * the value it already holds for that message, and the ref this returns goes on
 * the message's element:
 *
 *   const messageRef = useReveal<HTMLDivElement>(message)
 *   …
 *   {message && <FormMessage ref={messageRef} tone={message.tone}>{message.text}</FormMessage>}
 *
 * Call it above any early `return <PageLoader />`, like every hook.
 *
 * What counts is the VALUE CHANGING to something truthy, not the message
 * mounting: Offer categories keeps its message on screen between two saves, so
 * a second save with the same text mounts nothing, but each `setMessage({...})`
 * is a new object. A page whose state is a boolean or a string must give a
 * value that changes on every outcome (Marketplace's `posted` and `saved` are
 * reset when the drawer opens, so each success is false to true).
 *
 * `block: 'nearest'` is "only if it is out of view": a message already fully
 * visible is not moved, one above the viewport is brought to its top edge and
 * one below to its bottom edge, with the least movement. The gap at the edge is
 * the message's own `scroll-my-6`.
 *
 * It runs one animation frame after the commit. In Marketplace the same commit
 * closes the drawer, and the drawer then returns focus to the New listing
 * button, which scrolls the page too; moving the message first would be
 * overtaken. A frame later, the message's move is the last one.
 *
 * It never moves focus (the message is `role="alert"`, so it is announced
 * already, and focus on the Save button is where the person is), never reads
 * the message's text or tone, and never touches the network.
 */
export function useReveal<T extends HTMLElement = HTMLElement>(outcome: unknown): RefObject<T | null> {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!outcome) return
    const frame = requestAnimationFrame(() => {
      // Read now, not when the effect was scheduled: the person's setting may
      // have changed, and `matchMedia` does not exist in jsdom (no animation
      // is the safe answer without it).
      const reduced =
        typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      // Optional call: jsdom has no `scrollIntoView`, as it has no `showModal`
      // (see Drawer), and without this every test that shows a message throws.
      ref.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [outcome])

  return ref
}
