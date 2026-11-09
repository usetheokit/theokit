import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// The app's own ESLint config, resolved the way `pnpm --filter theoclaw exec eslint` resolves it.
// Until B-664 it ignored `src/**` and `tests/**`, and the root config ignores `apps/**`, so no
// linter read a TheoClaw TypeScript file and a clean run had analysed nothing.
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: appRoot })

describe('the theoclaw ESLint config', () => {
  it('does not ignore a test file', async () => {
    expect(await eslint.isPathIgnored(join(appRoot, 'tests/owner-policy-hook.test.ts'))).toBe(false)
  })

  it('does not ignore a source file', async () => {
    expect(await eslint.isPathIgnored(join(appRoot, 'src/composition.ts'))).toBe(false)
  })

  it('reports an unused variable in a test file as an error', async () => {
    const [result] = await eslint.lintText('const unusedProbe: number = 1\n', {
      filePath: join(appRoot, 'tests/lint-probe.test.ts'),
    })
    expect(result?.messages.map((message) => message.ruleId)).toEqual([
      '@typescript-eslint/no-unused-vars',
    ])
    expect(result?.errorCount).toBe(1)
  })
})
