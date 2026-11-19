import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { worktreeProvider } from '../../src/bridge/workspace-provider.js'

it('copies a gitignored file listed in .worktreeinclude and nothing else', async () => {
  const base = mkdtempSync(join(tmpdir(), 'wti-'))
  const repo = join(base, 'repo')
  mkdirSync(repo)
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- test fixture uses the system git
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t.t')
  git('config', 'user.name', 't')
  writeFileSync(join(repo, '.gitignore'), '.env\nsecret.txt\n')
  writeFileSync(join(repo, '.worktreeinclude'), '# local config\n.env\n')
  writeFileSync(join(repo, '.env'), 'KEY=1')
  writeFileSync(join(repo, 'secret.txt'), 'nope')
  git('add', '.')
  git('commit', '-qm', 'init')

  const ws = await worktreeProvider(repo, join(base, 'wt')).acquire('a')
  expect(readFileSync(join(ws.path, '.env'), 'utf8')).toBe('KEY=1')
  expect(existsSync(join(ws.path, 'secret.txt'))).toBe(false)
  await ws.release()
})
