import { describe, expect, it } from 'vitest'

import { readToolResult } from '../src/tool-result/read-tool-result.js'

describe('readToolResult', () => {
  it('the shell_exec JSON string with exit_code 2 reads as shell with exitCode 2', () => {
    const raw = JSON.stringify({ ok: true, stdout: 'a', stderr: 'b', exit_code: 2 })
    expect(readToolResult(raw)).toEqual({ kind: 'shell', stdout: 'a', stderr: 'b', exitCode: 2 })
  })
  it('the SDK runtime object with exitCode 1 reads as shell with exitCode 1', () => {
    expect(readToolResult({ stdout: 'x', stderr: '', exitCode: 1 })).toEqual({
      kind: 'shell',
      stdout: 'x',
      stderr: '',
      exitCode: 1,
    })
  })
  it('a shell object without an exit code keeps exitCode undefined', () => {
    const v = readToolResult({ stdout: 'x', stderr: '' })
    expect(v.kind).toBe('shell')
    expect('exitCode' in v).toBe(false)
  })
  it('exitCode wins over exit_code when both differ', () => {
    expect(readToolResult({ stdout: '', exitCode: 3, exit_code: 4 })).toMatchObject({ exitCode: 3 })
  })
  it('ok false with error timeout reads as error timeout', () => {
    expect(readToolResult('{"ok":false,"error":"timeout","timeout_ms":5}')).toEqual({
      kind: 'error',
      error: 'timeout',
    })
  })
  it('ok false falls back to tool_failed and carries stderr as detail', () => {
    expect(readToolResult({ ok: false, stderr: 'boom' })).toEqual({
      kind: 'error',
      error: 'tool_failed',
      detail: 'boom',
    })
  })
  it('the git_diff JSON string reads as diff with its patch', () => {
    const raw = JSON.stringify({ ok: true, diff: 'P', truncated: false })
    expect(readToolResult(raw)).toEqual({ kind: 'diff', patch: 'P' })
  })
  it('a raw unified diff string reads as diff', () => {
    const raw = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n'
    expect(readToolResult(raw)).toEqual({ kind: 'diff', patch: raw })
  })
  it('a non-JSON string reads as text unchanged', () => {
    expect(readToolResult('hello')).toEqual({ kind: 'text', text: 'hello' })
  })
  it('an object with a BigInt reads as text without throwing', () => {
    const v = readToolResult({ n: 1n })
    expect(v.kind).toBe('text')
  })
  it('a cyclic object reads as text without throwing', () => {
    const o: Record<string, unknown> = {}
    o.self = o
    expect(readToolResult(o).kind).toBe('text')
  })
})
