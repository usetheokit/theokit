import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { foreignSurfaceInventory } from '../../src/bridge/foreign-surfaces.js'

function project(files: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), 'foreign-inv-'))
  for (const [rel, body] of Object.entries(files)) {
    const p = join(cwd, '.claude', rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, body)
  }
  return cwd
}
const get = (
  cwd: string,
  dir: string,
  enabled?: Parameters<typeof foreignSurfaceInventory>[0]['enabled'],
) => foreignSurfaceInventory({ cwd, ...(enabled ? { enabled } : {}) }).find((e) => e.dir === dir)!

describe('foreign surface inventory', () => {
  it('agents counts only top-level .md files with frontmatter', () => {
    const cwd = project({
      'agents/a.md': '---\nname: a\n---\nhi',
      'agents/README.md': 'no frontmatter',
      'agents/review-1/b.md': '---\nname: b\n---\n',
    })
    const e = get(cwd, 'agents')
    expect(e.count).toBe(1)
    expect(e.state).toBe('read')
  })

  it('workflows is reported refused with its reason and a count of scripts', () => {
    const cwd = project({ 'workflows/a.js': '', 'workflows/b.mjs': '', 'workflows/c.txt': '' })
    mkdirSync(join(cwd, '.claude', 'workflows', 'd.js'))
    const e = get(cwd, 'workflows')
    expect(e.state).toBe('refused')
    expect(e.count).toBe(1)
    expect(e.names).toEqual(['a.js', 'b.mjs', 'd.js'])
    expect(e.reason).toContain('does NOT')
  })

  it('plugins counts bundles that ship a skills folder', () => {
    const cwd = project({ 'plugins/p1/skills/s.md': 'x', 'plugins/p2/readme.md': 'x' })
    expect(get(cwd, 'plugins').count).toBe(1)
  })

  it('an unreadable definition is listed in unreadable and does not throw', () => {
    const cwd = project({ 'commands/ok.md': '---\nname: o\n---\nbody' })
    // A self-referencing symlink fails to stat (ELOOP) for every user, root included.
    symlinkSync('x.md', join(cwd, '.claude', 'commands', 'x.md'))
    let e: ReturnType<typeof get> | undefined
    expect(() => (e = get(cwd, 'commands'))).not.toThrow()
    expect(e?.unreadable).toEqual(['commands/x.md'])
    expect(e?.count).toBe(1)
  })

  it('an inaccessible plugin bundle is listed in unreadable, not omitted', () => {
    const cwd = project({ 'plugins/p1/skills/s.md': 'x' })
    mkdirSync(join(cwd, '.claude', 'plugins', 'p2'))
    symlinkSync('skills', join(cwd, '.claude', 'plugins', 'p2', 'skills'))
    const e = get(cwd, 'plugins')
    expect(e.count).toBe(1)
    expect(e.unreadable).toEqual(['plugins/p2'])
  })

  it('commands counts what the loader takes: nested and frontmatter-free .md, not an unclosed fence', () => {
    const cwd = project({
      'commands/plain.md': 'just a prompt',
      'commands/ns/deep.md': '---\ndescription: d\n---\nbody',
      'commands/broken.md': '---\nnever closes',
      'commands/notes.txt': 'x',
    })
    expect(get(cwd, 'commands').count).toBe(2)
    const ok = project({ 'commands/a.md': '---\ndescription: d\n---\nbody' })
    expect(get(ok, 'commands').count).toBe(1)
  })

  it('a failing nested command is listed by its own path and readable siblings still count', () => {
    const cwd = project({ 'commands/ns/ok.md': '---\ndescription: d\n---\nb' })
    symlinkSync('bad.md', join(cwd, '.claude', 'commands', 'ns', 'bad.md'))
    const e = get(cwd, 'commands')
    expect(e.count).toBe(1)
    expect(e.unreadable).toEqual(['commands/ns/bad.md'])
  })

  it('agents applies the SDK filter: no symlinks, a fence line followed by a newline', () => {
    const cwd = project({
      'agents/a.md': '---\nname: a\n---\n',
      'agents/bad.md': '---not-frontmatter\nname: b\n---\n',
      'agents/real.md': '---\nname: r\n---\n',
    })
    symlinkSync('real.md', join(cwd, '.claude', 'agents', 'link.md'))
    expect(get(cwd, 'agents').count).toBe(2)
  })

  it('a FIFO named like a definition is never read', () => {
    const cwd = project({ 'agents/a.md': '---\n---\n' })
    execFileSync('/usr/bin/mkfifo', [join(cwd, '.claude', 'agents', 'pipe.md')])
    expect(get(cwd, 'agents').count).toBe(1)
  })

  it('the workflows warning scan does not touch other surfaces', () => {
    const cwd = project({ 'workflows/a.js': '' })
    execFileSync('/usr/bin/mkfifo', [join(cwd, '.claude', 'commands-pipe.md')])
    const entries = foreignSurfaceInventory({ cwd, dirs: ['workflows'] })
    expect(entries.map((e) => e.dir)).toEqual(['workflows'])
  })

  it('an enabled name the gate does not declare is not read', () => {
    const cwd = project({ 'agents/a.md': '---\n---\n' })
    const e = get(cwd, 'agents', ['nonsense' as never])
    expect(e.state).toBe('refused')
  })

  it('a surface left out of enabled is reported refused', () => {
    const cwd = project({ 'agents/a.md': '---\n---\n' })
    const e = get(cwd, 'agents', ['commands'])
    expect(e.state).toBe('refused')
    expect(e.reason).toBeDefined()
    expect(e.count).toBe(1)
  })
})
