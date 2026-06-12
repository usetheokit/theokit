import { describe, it, expect } from 'vitest'
import { createServerInsertedHTML } from '../../src/server-inserted-html.js'

describe('Server-Inserted HTML', () => {
  it('test_add_and_flush_returns_chunks', () => {
    // Given: a ServerInsertedHTML with two chunks
    const inserted = createServerInsertedHTML()
    inserted.add('polyfill', '<script src="/polyfill.js"></script>')
    inserted.add('trace', '<meta name="trace-id" content="abc123">')

    // When: flush is called
    const chunks = inserted.flush()

    // Then: both chunks are returned
    expect(chunks).toHaveLength(2)
    expect(chunks).toContain('<script src="/polyfill.js"></script>')
    expect(chunks).toContain('<meta name="trace-id" content="abc123">')
  })

  it('test_flush_returns_empty_on_second_call', () => {
    // Given: a ServerInsertedHTML that was already flushed
    const inserted = createServerInsertedHTML()
    inserted.add('chunk1', '<div>one</div>')

    const first = inserted.flush()
    expect(first).toHaveLength(1)

    // When: flush is called again without new adds
    const second = inserted.flush()

    // Then: no duplicates — empty array
    expect(second).toHaveLength(0)
  })

  it('test_dedup_by_id_replaces_content', () => {
    // Given: same id added twice with different content
    const inserted = createServerInsertedHTML()
    inserted.add('theme', '<style>:root { --bg: white; }</style>')
    inserted.add('theme', '<style>:root { --bg: black; }</style>')

    // When: flush is called
    const chunks = inserted.flush()

    // Then: only the latest content is returned (deduped by id)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe('<style>:root { --bg: black; }</style>')
  })

  it('test_reset_clears_all_state', () => {
    // Given: a ServerInsertedHTML with chunks (some flushed, some pending)
    const inserted = createServerInsertedHTML()
    inserted.add('a', '<div>a</div>')
    inserted.flush()
    inserted.add('b', '<div>b</div>')

    // When: reset is called
    inserted.reset()

    // Then: flush returns nothing
    const chunks = inserted.flush()
    expect(chunks).toHaveLength(0)
  })
})
