/**
 * Restoring the scroll offset of the element the application actually scrolls (#421).
 *
 * ## The gap this closes
 *
 * The generated root mounts react-router's `<ScrollRestoration>`, which restores `window.scrollY`.
 * The layout this framework SCAFFOLDS scrolls an inner `<main>`, so the document never scrolls,
 * there is no offset to save, and the restoration that is mounted and running restores nothing.
 * Measured in Chrome: `main.scrollTop` 2400 → navigate → back → `main.scrollTop` 0.
 *
 * The documentation was corrected to state the condition rather than the promise. This is the other
 * half — making the promise true for the app the framework itself generates, rather than reshaping
 * that app to fit the limitation.
 *
 * ## Why an explicit marker and not detection
 *
 * A page can have several scrollable elements, and picking one by walking the DOM for
 * `overflow: auto` guesses — silently, and differently as a layout changes. Nobody does it: Next.js
 * and react-router restore the document only, and TanStack Router requires an explicit key per
 * element. A declared attribute is the state of the art here AND this framework's own idiom, the
 * same shape as its reserved route filenames.
 *
 * ## Why the DOM is injected
 *
 * Everything below decides something — which key an offset lands under, when it is read back, what
 * happens to an element that is gone on return — and none of it needs a browser to decide it. The
 * React shell that queries the elements and calls these on navigation is kept branch-free for the
 * same reason: this repository sets up no DOM test environment (`vitest.config.ts` says so), so the
 * part that cannot be covered is the part with nothing in it.
 */

/** One element whose offset is being tracked. Structural, so a test needs no DOM. */
export interface ScrollTarget {
  /** The value of the element's marker attribute — what distinguishes it from its siblings. */
  readonly id: string
  scrollTop: number
}

/** Where offsets survive a navigation. `sessionStorage` in a browser. */
export interface ScrollStore {
  get(key: string): string | null
  set(key: string, value: string): void
}

/**
 * The attribute an application puts on an element it scrolls.
 *
 * Its VALUE is the id, so two scrollers on one page stay distinguishable — which is precisely what
 * a detected single container cannot offer.
 */
export const SCROLL_CONTAINER_ATTRIBUTE = 'data-theo-scroll'

/** Namespaced, because `sessionStorage` belongs to the whole origin and not to this framework. */
function storageKey(locationKey: string): string {
  return `theokit:scroll:${locationKey}`
}

export interface ScrollRestorer {
  /** Record where each target sits, before leaving `locationKey`. */
  save(locationKey: string, targets: Iterable<ScrollTarget>): void
  /** Put each target back where it was, after `locationKey` has rendered. */
  restore(locationKey: string, targets: Iterable<ScrollTarget>): void
}

export function createScrollRestorer(store: ScrollStore): ScrollRestorer {
  return {
    save(locationKey, targets) {
      const offsets: Record<string, number> = {}
      for (const target of targets) offsets[target.id] = target.scrollTop
      try {
        store.set(storageKey(locationKey), JSON.stringify(offsets))
      } catch {
        // Safari in private mode and a full quota both throw here. Losing a scroll offset is a
        // smaller harm than failing the navigation that was trying to save it.
      }
    },

    restore(locationKey, targets) {
      const offsets = readOffsets(store, locationKey)
      if (offsets === undefined) return
      for (const target of targets) {
        const offset = offsets[target.id]
        // A number check and not a truthiness check: 0 is a real offset, and an element that is
        // missing from a previous visit must be left where the app rendered it.
        if (typeof offset === 'number') target.scrollTop = offset
      }
    },
  }
}

function readOffsets(store: ScrollStore, locationKey: string): Record<string, unknown> | undefined {
  const raw = store.get(storageKey(locationKey))
  if (raw === null) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    // `sessionStorage` is shared with the whole origin. Throwing because something else wrote a
    // colliding key would break a navigation for a reason that has nothing to do with this app.
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}
