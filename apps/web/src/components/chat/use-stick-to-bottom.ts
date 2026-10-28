'use client'

import { useEffect, useRef } from 'react'

/**
 * Follows the conversation: whenever `contentKey` changes (a message, streamed text, a chip, cards that
 * load after the turn), scroll to the bottom, unless the employee scrolled up to read something.
 * Opening a decision panel does not change the key, so it never fights the panel's own scroll.
 */
export function useStickToBottom<S extends HTMLElement>(contentKey: string, forcePin: boolean) {
  const scroller = useRef<S>(null)
  const pinned = useRef(true)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // A new turn always brings the view back to the bottom.
  useEffect(() => {
    if (forcePin) pinned.current = true
  }, [forcePin])

  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [contentKey])

  return scroller
}
