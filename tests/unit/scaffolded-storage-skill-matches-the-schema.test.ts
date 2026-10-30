import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { storageSchema } from '../../packages/theo/src/config/schemas/storage.js'

/**
 * The scaffolded `theokit-config` skill taught `storage: { postgres: [{ url }], redis: [{ url }] }`
 * (usetheokit/theokit#1023). The schema has no such keys: `postgres` was stripped without a word and
 * `redis` was rejected as "expected record". An assistant following the skill wrote a config that
 * booted with no storage. The example is now evaluated against the schema itself, so the two cannot
 * drift apart again.
 */
const SKILL = resolve(
  import.meta.dirname,
  '../../packages/create-theokit/templates/default/dot-claude/skills/theokit-config/SKILL.md',
)

/** The `storage: { ... }` object literal in the skill's Storage section, braces balanced. */
function storageLiteral(markdown: string): string {
  const section = markdown.slice(markdown.indexOf('### Storage'))
  const start = section.indexOf('storage: {') + 'storage: '.length
  let depth = 0
  for (let i = start; i < section.length; i++) {
    if (section[i] === '{') depth++
    if (section[i] === '}') depth--
    if (depth === 0) return section.slice(start, i + 1)
  }
  throw new Error('unbalanced storage literal in the theokit-config skill')
}

describe('the scaffolded storage skill', () => {
  const markdown = readFileSync(SKILL, 'utf-8')

  it('shows a storage block the schema accepts unchanged', () => {
    const literal = storageLiteral(markdown).replace(/\/\/.*$/gm, '')
    // The example reads env vars with fallbacks; an empty environment exercises the fallbacks.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, sonarjs/code-eval -- evaluates a checked-in docs snippet, no input
    const value: unknown = new Function('process', `return (${literal})`)({ env: {} })
    const parsed = storageSchema.safeParse(value)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect(parsed.data).toEqual(value)
  })

  it('names no environment variable theokit does not read', () => {
    expect(markdown).not.toMatch(/`(DATABASE_URL|REDIS_URL)`\s+—/)
  })

  it('rejects the connection-string shape the skill used to teach', () => {
    expect(
      storageSchema.safeParse({ postgres: [{ url: 'postgres://db.example:5432/app' }] }).success,
    ).toBe(false)
  })
})
