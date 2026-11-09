/**
 * B-386 — code mode across its real boundaries: `createCodeMode` over `createQuickJsSandbox`, with
 * the published `read_file` tool reading a real directory. Nothing is mocked: the script runs in
 * QuickJS-WASM, its api calls cross into the host, the tool reads the disk, and only the script's
 * return value comes back as the tool result.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createReadFileTool } from '@theokit/sdk-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CodeModePermissionDeniedError, createCodeMode } from '../../src/code-mode-entry.js'
import { CodeModeSandboxError, createQuickJsSandbox } from '../../src/code-mode-quickjs-entry.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'code-mode-'))
  writeFileSync(join(root, 'a.txt'), 'sentinel-a 17\n')
  writeFileSync(join(root, 'b.txt'), 'sentinel-b 25\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function codeModeOverReadFile(granted: boolean) {
  return createCodeMode({
    tools: [createReadFileTool({ projectRoot: root })],
    sandbox: createQuickJsSandbox(),
    onPermissionRequest: () =>
      granted ? { granted: true } : { granted: false, reason: 'denied in the test' },
  })
}

describe('code mode over QuickJS and a real read_file', () => {
  it('returns only the sum of two files a script read', async () => {
    const { tool } = codeModeOverReadFile(true)
    const script = [
      'const a = await api.read_file({ path: "a.txt" })',
      'const b = await api.read_file({ path: "b.txt" })',
      // read_file answers JSON, `{ ok, content, size }`, which the script receives parsed.
      'const n = (file) => Number(file.content.trim().split(" ")[1])',
      'return { sum: n(a) + n(b) }',
    ].join('\n')

    const result = await tool.handler({ code: script })

    expect(result).toBe('{"sum":42}')
    expect(result).not.toContain('sentinel')
  })

  it('surfaces a denied tool call to the script as an error it can catch', async () => {
    const { tool } = codeModeOverReadFile(false)

    const result = await tool.handler({
      code: 'try { await api.read_file({ path: "a.txt" }); return "read" } catch (e) { return e.message }',
    })

    expect(result).toContain("tool 'read_file' denied by permission gate: denied in the test")
    expect(new CodeModePermissionDeniedError('read_file').code).toBe('CODE_MODE_PERMISSION_DENIED')
  })

  it('rejects the tool call with the typed sandbox error when the script throws', async () => {
    const { tool } = codeModeOverReadFile(true)

    await expect(tool.handler({ code: 'throw new Error("no")' })).rejects.toBeInstanceOf(
      CodeModeSandboxError,
    )
  })
})
