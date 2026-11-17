import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BUILD_HOOK_TIMEOUT_MS,
  buildTheokitPackageOnce,
} from '../integration/_helpers/build-theokit-package.js'

const packageRoot = resolve(__dirname, '../../packages/theo')
const TEST_HELPER = /ForTests?$|^_reset/

type Target = string | { types?: string; import?: string | { types?: string } }

function typesOf(target: Target): string | undefined {
  if (typeof target === 'string') return undefined
  if (typeof target.types === 'string') return target.types
  const imp = target.import
  return typeof imp === 'object' ? imp.types : undefined
}

describe('no published entry of theokit exposes a test-only helper', () => {
  const found: Record<string, string[]> = {}
  const checked: string[] = []

  beforeAll(() => {
    buildTheokitPackageOnce()
    const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, Target>
    }
    const files = Object.entries(pkg.exports).flatMap(([entry, target]) => {
      const t = typesOf(target)
      const file = t === undefined ? undefined : resolve(packageRoot, t)
      return file !== undefined && existsSync(file) ? [[entry, file] as const] : []
    })
    const program = ts.createProgram(
      files.map(([, f]) => f),
      {
        skipLibCheck: true,
        noEmit: true,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    )
    const checker = program.getTypeChecker()
    for (const [entry, file] of files) {
      const source = program.getSourceFile(file)
      const symbol = source === undefined ? undefined : checker.getSymbolAtLocation(source)
      if (symbol === undefined) continue
      checked.push(entry)
      const names = checker.getExportsOfModule(symbol).map((s) => s.getName())
      const bad = names.filter((n) => TEST_HELPER.test(n))
      if (bad.length > 0) found[entry] = bad
    }
  }, BUILD_HOOK_TIMEOUT_MS)

  it('resolves every entry and finds no name matching the test-helper pattern', () => {
    expect(checked.length).toBeGreaterThan(10)
    expect(found).toEqual({})
  })
})
