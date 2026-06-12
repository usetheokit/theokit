/**
 * Server-Inserted HTML — late-stage HTML injection.
 *
 * Inspired by Next.js make-get-server-inserted-html.tsx (app-render/).
 * Stateful closure pattern that allows adding HTML chunks during SSR
 * (polyfills, traces, analytics) and flushing them once.
 *
 * Chunks are deduped by id — adding the same id twice replaces the content.
 * flush() returns all pending chunks and marks them as flushed so they
 * are not returned again on subsequent calls.
 */

/** Interface for managing server-inserted HTML chunks. */
export interface ServerInsertedHTML {
  /** Add an HTML chunk with a dedup key. Adding the same id replaces content. */
  add(id: string, html: string): void
  /** Return all pending (unflushed) chunks and mark them as flushed. */
  flush(): string[]
  /** Clear all state — both pending and flushed. */
  reset(): void
}

/**
 * Create a new ServerInsertedHTML manager.
 *
 * @example
 * ```typescript
 * const inserted = createServerInsertedHTML()
 * inserted.add('polyfill', '<script src="/polyfill.js"></script>')
 * inserted.add('trace', '<meta name="trace-id" content="abc123">')
 * const chunks = inserted.flush() // returns both chunks
 * const empty = inserted.flush()  // returns [] (already flushed)
 * ```
 */
export function createServerInsertedHTML(): ServerInsertedHTML {
  const pending = new Map<string, string>()
  const flushed = new Set<string>()

  return {
    add(id: string, html: string): void {
      pending.set(id, html)
      // If this id was previously flushed, allow re-adding with new content
      flushed.delete(id)
    },

    flush(): string[] {
      const chunks: string[] = []
      for (const [id, html] of pending) {
        if (!flushed.has(id)) {
          chunks.push(html)
          flushed.add(id)
        }
      }
      // Clear pending entries that were flushed
      for (const id of flushed) {
        pending.delete(id)
      }
      return chunks
    },

    reset(): void {
      pending.clear()
      flushed.clear()
    },
  }
}
