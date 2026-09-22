import { useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

import {
  createScrollRestorer,
  SCROLL_CONTAINER_ATTRIBUTE,
  type ScrollRestorer,
  type ScrollStore,
  type ScrollTarget,
} from './scroll-restoration.js'

/**
 * Restore the scroll offset of elements the application marked as scrollers (#421).
 *
 * Mounted beside react-router's `<ScrollRestoration>`, not instead of it: that one owns the
 * DOCUMENT, correctly and with its own timing, and this one owns the elements it cannot see. An app
 * whose document scrolls keeps exactly the behaviour it had.
 *
 * ## What an application does
 *
 * ```tsx
 * <main data-theo-scroll="main" className="overflow-y-auto">…</main>
 * ```
 *
 * The attribute's VALUE is the id, so two scrollers on one page stay distinguishable.
 *
 * ## Why every decision is elsewhere
 *
 * This component queries, sequences, and nothing else — `scroll-restoration.ts` decides which key
 * an offset lands under, when it is read back, and what happens to an element that is gone on
 * return. That split is because this repository sets up no DOM test environment, so the part that
 * cannot be covered by a test is deliberately the part with no branches in it.
 *
 * `useLayoutEffect` and not `useEffect`: the offset must be applied before the browser paints, or
 * the user sees the top of the list and then a jump.
 */
export function ElementScrollRestoration(): null {
  const location = useLocation()
  const previousKey = useRef<string | undefined>(undefined)

  // ONE restorer for the component's whole life. It carries the snapshot taken on the last scroll,
  // and a fresh one per effect would throw that away — which is the whole point of #421's fix.
  //
  // `useState`'s initialiser rather than a lazily-filled ref: it runs exactly once and hands back a
  // value that is never `undefined`, so nothing downstream needs a branch to narrow it. This file's
  // own contract is that it holds no decisions — every one of them lives in `scroll-restoration.ts`
  // where a test can reach it — and a guard against a state that cannot occur is still a branch
  // nobody can cover.
  const [restorer] = useState<ScrollRestorer>(() => createScrollRestorer(sessionScrollStore()))

  // The key a snapshot lands under, read by a listener installed once. A ref rather than the
  // closure's location key, which would otherwise be the key at mount forever.
  const activeKey = useRef(location.key)
  activeKey.current = location.key

  // Snapshot on every scroll, while the route that owns the offset is still on screen.
  //
  // usetheokit/theokit#421 / B-037 — reading the offsets when the effect below runs reads them a
  // moment too late: React commits the incoming route's DOM first, so every element queried is the
  // new page's and sits at 0. Measured in Chrome against `theokit@0.70.1`, a container scrolled to
  // 2400 persisted as `{"main":0}` — nothing was lost in transit, the wrong number was written.
  //
  // Capture phase, because `scroll` does not bubble from an element: a listener on `document` sees
  // it only on the way down. Passive, because this never calls `preventDefault`, and saying so
  // keeps the browser from waiting to find out.
  useLayoutEffect(() => {
    const onScroll = (): void => {
      restorer.record(activeKey.current, scrollTargets())
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [restorer])

  useLayoutEffect(() => {
    const leaving = previousKey.current
    if (leaving !== undefined) restorer.save(leaving, scrollTargets())
    previousKey.current = location.key
    restorer.restore(location.key, scrollTargets())

    // Also on unload: a reload or a close never runs the next effect, so without this the last
    // page's offset is the one that is never recorded.
    const onHide = (): void => {
      restorer.save(location.key, scrollTargets())
    }
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
    }
  }, [location.key, restorer])

  return null
}

/**
 * Every element the application marked, as the restorer's structural target.
 *
 * A live projection rather than the element itself. An `Element` already has `scrollTop` AND an
 * `id`, so passing it straight through compiles — and its `id` is the HTML `id` attribute, not the
 * marker's value. The restorer would key every offset by the wrong string and silently restore
 * nothing, which is the same defect this component exists to remove. The accessors forward, so a
 * read is current and a write actually scrolls.
 */
function scrollTargets(): ScrollTarget[] {
  return [...document.querySelectorAll(`[${SCROLL_CONTAINER_ATTRIBUTE}]`)].flatMap((element) => {
    const id = element.getAttribute(SCROLL_CONTAINER_ATTRIBUTE)
    if (id === null || id === '') return []
    return [
      {
        id,
        get scrollTop(): number {
          return element.scrollTop
        },
        set scrollTop(value: number) {
          element.scrollTop = value
        },
      },
    ]
  })
}

/**
 * `sessionStorage`, or a store that forgets.
 *
 * A browser with storage disabled throws on ACCESS, not on write, so the guard has to be here. The
 * forgetful fallback means restoration stops working; it does not mean navigation stops working.
 */
function sessionScrollStore(): ScrollStore {
  try {
    const storage = window.sessionStorage
    return {
      get: (key) => storage.getItem(key),
      set: (key, value) => {
        storage.setItem(key, value)
      },
    }
  } catch {
    return { get: () => null, set: () => undefined }
  }
}
