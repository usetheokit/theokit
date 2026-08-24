import { useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router'

import {
  createScrollRestorer,
  SCROLL_CONTAINER_ATTRIBUTE,
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

  useLayoutEffect(() => {
    const restorer = createScrollRestorer(sessionScrollStore())
    const leaving = previousKey.current
    if (leaving !== undefined) restorer.save(leaving, scrollTargets())
    previousKey.current = location.key
    restorer.restore(location.key, scrollTargets())

    // Also on unload: a reload or a close never runs the next effect, so without this the last
    // page's offset is the one that is never recorded.
    const onHide = (): void => {
      createScrollRestorer(sessionScrollStore()).save(location.key, scrollTargets())
    }
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
    }
  }, [location.key])

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
