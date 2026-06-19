import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { glob } from 'node:fs/promises'

const CORE = resolve(__dirname, '../../packages/theo/src/core')

/**
 * Core-purity guard (architecture-report cleanup Step 3).
 *
 * `architecture.md` Prohibitions: "Node.js APIs only in adapter layer (use Web
 * Standards in core)." `core/` is the foundation that may import npm packages
 * (vite, react, zod) but MUST NOT reach for `node:` builtins — those belong in
 * the application/adapter layers. This guard makes the prohibition enforceable.
 */
describe('core/ purity', () => {
  it("test_core_has_no_node_builtin_imports — no `from 'node:*'` under core/", async () => {
    const offenders: string[] = []
    for await (const entry of glob('**/*.ts', { cwd: CORE })) {
      if (entry.endsWith('.test.ts') || entry.endsWith('.test-d.ts')) continue
      const text = await readFile(resolve(CORE, entry), 'utf8')
      // Match both `from 'node:fs'` and `import 'node:...'` and dynamic import.
      if (/from\s+['"]node:|import\(\s*['"]node:/.test(text)) {
        offenders.push(entry)
      }
    }
    expect(
      offenders,
      `core/ must be free of node: builtins; offenders: ${offenders.join(', ')}`,
    ).toEqual([])
  })
})
