'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Keeps a scroll container pinned to the bottom while its content grows (streamed text, chips, cards
 * that load after the turn), unless the employee scrolled up to read something.
 */
export function useStickToBottom<S extends HTMLElement, C extends HTMLElement>() {
  const scroller = useRef<S>(null)
  const content = useRef<C>(null)
  const pinned = useRef(true)

  useEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight
    })
    el.addEventListener('scroll', onScroll, { passive: true })
    observer.observe(inner)
    el.scrollTop = el.scrollHeight
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [])

  /** After the employee sends something, follow the conversation again. */
  const pin = useCallback(() => {
    pinned.current = true
  }, [])
  return { scroller, content, pin }
}
