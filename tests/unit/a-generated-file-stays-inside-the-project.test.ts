import { describe, it, expect } from 'vitest'
import { join, resolve } from 'node:path'
import { pathTraversalRefusal } from '../../packages/theo/src/cli/commands/generate-containment.js'

/**
 * The containment rule every generator applies before writing, pinned at the unit layer. The
 * filesystem tests reach it only through a temp project, which leaves the null-byte, absolute and
 * project-root branches unexercised.
 */
describe('a generated file stays inside the project', () => {
  const cwd = resolve('/tmp/theo-containment/app')

  it('test_a_file_inside_the_project_is_allowed', () => {
    expect(
      pathTraversalRefusal(cwd, join(cwd, 'src/server/agents/schedules/daily.ts')),
    ).toBeUndefined()
  })

  it.each([
    ['a .. escape', join(cwd, '../elsewhere/daily.ts')],
    ['a sibling sharing the project prefix', resolve('/tmp/theo-containment/app-outside/daily.ts')],
    ['the project root itself', cwd],
    ['a path carrying a null byte', join(cwd, 'src/da\x00ily.ts')],
  ])('test_%s_is_refused_as_path_traversal', (_label, filePath) => {
    const refusal = pathTraversalRefusal(cwd, filePath)
    expect(refusal?.status).toBe('invalid_name')
    expect(refusal?.message).toBe(
      `Path traversal denied: "${filePath}" is outside the project root ${cwd}.`,
    )
  })

  it('test_a_path_on_another_root_is_refused_as_path_traversal', () => {
    // On POSIX every absolute path shares "/", so the isAbsolute(relative) branch is reached by a
    // Windows drive letter; elsewhere the case still holds through the ".." branch.
    const other = process.platform === 'win32' ? 'D:\\other\\daily.ts' : '/var/other/daily.ts'
    expect(pathTraversalRefusal(cwd, other)?.status).toBe('invalid_name')
  })
})
