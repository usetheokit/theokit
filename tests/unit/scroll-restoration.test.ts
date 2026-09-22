/**
 * Restoring the offset of the element the app actually scrolls (usetheokit/theokit#421).
 *
 * ## What was measured
 *
 * The generated root mounts react-router's `<ScrollRestoration>`, which restores `window.scrollY`.
 * The layout this framework SCAFFOLDS scrolls an inner `<main>`, so the document never scrolls and
 * there is no offset to save. Measured in Chrome: `main.scrollTop` 2400 → navigate → back →
 * `main.scrollTop` 0.
 *
 * ## Why an explicit marker rather than detection
 *
 * Nobody auto-detects the scroll container, and for a reason: a page can have several scrollable
 * elements and guessing picks the wrong one silently. TanStack Router requires an explicit element
 * key for exactly this; Next.js and react-router restore the document only. A declared attribute is
 * both the state of the art and this framework's own idiom — the same shape as its reserved route
 * filenames.
 *
 * ## What these assertions cover, and what they cannot
 *
 * All the decisions: which key an offset is stored under, when it is written, when it is read back,
 * and what happens to an element that is absent on return. The React effect that calls them needs a
 * DOM this repository does not set up (`vitest.config.ts` records the absence), so the shell is kept
 * branch-free and the SEQUENCING is driven directly here instead.
 */
import { describe, expect, it } from 'vitest'

import {
  createScrollRestorer,
  type ScrollStore,
  type ScrollTarget,
} from '../../packages/theo/src/router/scroll-restoration.js'

function memoryStore(): ScrollStore & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>()
  return {
    entries,
    get: (key) => entries.get(key) ?? null,
    set: (key, value) => {
      entries.set(key, value)
    },
  }
}

function target(id: string, scrollTop: number): ScrollTarget {
  return { id, scrollTop }
}

describe('an offset is saved per location and per element', () => {
  it('test_leaving_a_location_stores_the_offset_of_every_marked_element', () => {
    const store = memoryStore()
    const restorer = createScrollRestorer(store)

    restorer.save('loc-1', [target('main', 2400), target('sidebar', 120)])

    // Two elements on one page is the case that makes detection unusable and a key necessary.
    expect(store.entries.size).toBe(1)
    expect(JSON.parse(store.entries.values().next().value ?? '{}')).toEqual({
      main: 2400,
      sidebar: 120,
    })
  })

  it('test_returning_to_a_location_restores_each_element_by_its_own_id', () => {
    const store = memoryStore()
    const restorer = createScrollRestorer(store)
    restorer.save('loc-1', [target('main', 2400), target('sidebar', 120)])

    const main = target('main', 0)
    const sidebar = target('sidebar', 0)
    restorer.restore('loc-1', [main, sidebar])

    expect(main.scrollTop).toBe(2400)
    expect(sidebar.scrollTop).toBe(120)
  })

  it('test_a_location_never_visited_leaves_the_element_where_it_is', () => {
    const restorer = createScrollRestorer(memoryStore())
    const main = target('main', 0)

    restorer.restore('never-seen', [main])

    // A forward navigation must land at the top the app rendered, not be nudged by a stale read.
    expect(main.scrollTop).toBe(0)
  })

  it('test_an_element_absent_on_return_is_skipped_rather_than_failing_the_others', () => {
    const store = memoryStore()
    const restorer = createScrollRestorer(store)
    restorer.save('loc-1', [target('main', 900), target('sidebar', 50)])

    // The route came back without its sidebar — a legitimate layout change between visits.
    const main = target('main', 0)
    restorer.restore('loc-1', [main])

    expect(main.scrollTop).toBe(900)
  })

  it('test_a_second_visit_overwrites_the_first_rather_than_accumulating', () => {
    const store = memoryStore()
    const restorer = createScrollRestorer(store)

    restorer.save('loc-1', [target('main', 2400)])
    restorer.save('loc-1', [target('main', 10)])

    const main = target('main', 0)
    restorer.restore('loc-1', [main])
    expect(main.scrollTop).toBe(10)
  })
})

describe('a corrupt or foreign entry does not break navigation', () => {
  it('test_unparseable_stored_state_is_ignored', () => {
    const store = memoryStore()
    store.set('theokit:scroll:loc-1', 'not json')
    const main = target('main', 0)

    createScrollRestorer(store).restore('loc-1', [main])

    // `sessionStorage` is shared with the whole origin. Throwing here would break a navigation
    // because something else wrote to a key that happens to collide.
    expect(main.scrollTop).toBe(0)
  })

  it('test_a_non_numeric_offset_is_ignored', () => {
    const store = memoryStore()
    store.set('theokit:scroll:loc-1', JSON.stringify({ main: 'top' }))
    const main = target('main', 0)

    createScrollRestorer(store).restore('loc-1', [main])

    expect(main.scrollTop).toBe(0)
  })
})

describe('a storage that refuses to write does not break navigation', () => {
  it('test_a_throwing_store_is_swallowed_on_save', () => {
    const throwing: ScrollStore = {
      get: () => null,
      set: () => {
        // Safari in private mode, and a full quota, both do this.
        throw new Error('QuotaExceededError')
      },
    }

    expect(() => createScrollRestorer(throwing).save('loc-1', [target('main', 1)])).not.toThrow()
  })
})

/**
 * B-037 / usetheokit/theokit#421 — what is persisted must be where the user WAS, not where the
 * incoming route starts.
 *
 * Measured 2026-09-22 against `theokit@0.70.1` scaffolded from npm with `.ssr(true)`, driving a
 * real Chrome: a container scrolled to 2400, a client-side navigation, `history.back()`, and the
 * offset reads 0. Read straight out of `sessionStorage` on leaving:
 *
 *     {"theokit:scroll:default":"{\"main\":0}"}
 *
 * It stored 0. Nothing was lost in transit — the wrong number was written. `ElementScrollRestoration`
 * saves the outgoing key's offsets from inside a `useLayoutEffect`, and React runs that AFTER
 * committing the incoming route's DOM, so `scrollTop` is already the new page's.
 *
 * The fix belongs HERE and not in the shell. This module holds the decisions precisely so they can
 * be tested without a DOM (`vitest.config.ts` declares `environment: 'node'`), and "which snapshot
 * gets persisted" is a decision. A shell that reads the DOM at the right moment would put a branch
 * that matters back into the file whose whole design is to have none.
 */
describe('what gets persisted is where the user was (B-037)', () => {
  function memoryStore(): ScrollStore & { readonly written: Record<string, string> } {
    const written: Record<string, string> = {}
    return {
      written,
      get: (k) => written[k] ?? null,
      set: (k, v) => {
        written[k] = v
      },
    }
  }

  const target = (id: string, scrollTop: number): ScrollTarget => ({ id, scrollTop })

  it('test_save_persists_the_recorded_offset_not_the_live_one', () => {
    const store = memoryStore()
    const restorer = createScrollRestorer(store)

    // The user scrolled to 2400 while /tall was on screen.
    restorer.record('k-tall', [target('main', 2400)])

    // React commits /'s DOM, and only THEN runs the effect that saves. The live element is the new
    // route's, sitting at 0 — which is exactly what the browser measurement observed.
    restorer.save('k-tall', [target('main', 0)])

    expect(
      JSON.parse(store.written['theokit:scroll:k-tall'] ?? '{}'),
      'the live 0 was persisted over the recorded 2400 — this is the defect',
    ).toEqual({ main: 2400 })
  })

  it('test_a_later_record_supersedes_an_earlier_one', () => {
    const store = memoryStore()
    const restorer = createScrollRestorer(store)
    restorer.record('k', [target('main', 100)])
    restorer.record('k', [target('main', 900)])
    restorer.save('k', [target('main', 0)])
    expect(JSON.parse(store.written['theokit:scroll:k'] ?? '{}')).toEqual({ main: 900 })
  })

  it('test_with_nothing_recorded_save_still_reads_the_targets', () => {
    // Must SURVIVE. `pagehide` fires with no preceding scroll on a page nobody touched, and a
    // save that silently wrote nothing would lose the offset of a route restored from a previous
    // visit and never scrolled again.
    const store = memoryStore()
    const restorer = createScrollRestorer(store)
    restorer.save('k', [target('main', 640)])
    expect(JSON.parse(store.written['theokit:scroll:k'] ?? '{}')).toEqual({ main: 640 })
  })

  it('test_recording_one_key_does_not_leak_into_another', () => {
    const store = memoryStore()
    const restorer = createScrollRestorer(store)
    restorer.record('k-tall', [target('main', 2400)])
    restorer.save('k-other', [target('main', 15)])
    expect(
      JSON.parse(store.written['theokit:scroll:k-other'] ?? '{}'),
      'a snapshot taken on one route was persisted under another',
    ).toEqual({ main: 15 })
  })
})
