/**
 * `createHandoffConversation` ships from `@theokit/agents/handoff`, not from the root entry (B-410).
 *
 * The root bundle sits about 2.6 KB under its 42 000-byte cap, and a conversation that hands off
 * between agents is an app-facing orchestrator most agents never import, so it gets its own subpath
 * the way the A2A client and the eval runner did.
 *
 * The subpath is imported by its package specifier, a self-reference resolved through the
 * manifest's `exports`, so a missing or misrouted `./handoff` export fails here instead of in the
 * consumer's import. Both halves read the BUILT output; without a build the tests skip.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const distDir = resolve(__dirname, '../../dist')
const SPECIFIER = '@theokit/agents/handoff'
const RELATIVE_IMPORT = /(?:from|import)\s*["']\.\/([^"']+\.js)["']/g

/**
 * `dist/index.js` and every file it reaches through relative imports. tsup moves code shared by two
 * entries into `chunk-*.js`, so a root import of the handoff module would leave `index.js` itself
 * clean while the root still loads the code through a chunk.
 */
function rootGraph(): string[] {
  const seen = new Set<string>()
  const queue = ['index.js']
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(resolve(distDir, file), 'utf8')
    for (const match of source.matchAll(RELATIVE_IMPORT)) queue.push(match[1] ?? '')
  }
  return [...seen]
}

describe('the handoff subpath', () => {
  it('resolves @theokit/agents/handoff through the package exports', async (ctx) => {
    if (!existsSync(resolve(distDir, 'index.js'))) {
      ctx.skip()
      return
    }
    const mod = (await import(/* @vite-ignore */ SPECIFIER)) as Record<string, unknown>
    expect(typeof mod.createHandoffConversation).toBe('function')
    expect(typeof mod.HandoffError).toBe('function')
  })

  it('keeps transfer_to_agent out of dist/index.js and every chunk it loads', (ctx) => {
    if (!existsSync(resolve(distDir, 'index.js'))) {
      ctx.skip()
      return
    }
    const loaded = rootGraph()
    expect(loaded.length).toBeGreaterThan(1)
    for (const file of loaded) {
      expect(readFileSync(resolve(distDir, file), 'utf8'), file).not.toContain('transfer_to_agent')
    }
  })
})
