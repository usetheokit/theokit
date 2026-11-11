import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { codingWorkerPort } from '../src/tools/coding-worker.js'
import type { ToolSettings } from '../src/tools/tool-settings.js'

describe('coder delegation', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

  it('runs the task in a worktree on its own branch, commits, and keeps it listed', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'cw-'))
    dirs.push(workspace)
    const repo = join(workspace, 'files')
    const g = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' })
    execFileSync('git', ['init', '-q', repo])
    writeFileSync(join(repo, 'a.txt'), 'a')
    g('add', '.')
    g('commit', '-q', '-m', 'init')
    const settings = { workspace, toolRoot: repo } as unknown as ToolSettings
    let tree = ''
    const port = codingWorkerPort(settings, () => [], async (_tools, _task, _signal) => {
      tree = readdirTree(workspace)
      writeFileSync(join(tree, 'b.txt'), 'b')
      return { response: 'done', toolCalls: [], cost: 0, tokens: 0 }
    })
    const result = await port.run('add b', {})
    expect(result.response).toContain('on branch task/coder-')
    expect(g('worktree', 'list')).toContain(tree)
    const branch = /task\/coder-[0-9a-f]+/.exec(result.response)?.[0] ?? ''
    expect(g('show', '--stat', branch)).toContain('b.txt')
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(readFileSync(join(tree, 'b.txt'), 'utf8')).toBe('b')
  })
})

function readdirTree(workspace: string): string {
  const out = execFileSync('git', ['-C', join(workspace, 'files'), 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
  const paths = [...out.matchAll(/^worktree (.+)$/gm)].map((m) => m[1] ?? '')
  return paths.find((p) => p.includes('worktrees')) ?? ''
}
