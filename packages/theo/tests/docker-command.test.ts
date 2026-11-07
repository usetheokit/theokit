import { describe, expect, it } from 'vitest'

import { generateDockerfile } from '../src/cli/commands/docker.js'

describe('generateDockerfile', () => {
  it('drops root in the runner stage before CMD', () => {
    const out = generateDockerfile({
      pkgManager: 'npm',
      sourceRoots: ['src'],
      distDir: '.theokit',
      hasConfigFile: true,
      hasPnpmWorkspace: false,
    })
    const runner = out.slice(out.indexOf('AS runner'))
    expect(runner).toMatch(/^USER node$/m)
    expect(runner.indexOf('USER node')).toBeLessThan(runner.indexOf('CMD'))
    for (const line of runner.split('\n').filter((l) => l.startsWith('COPY'))) {
      expect(line).toContain('--chown=node:node')
    }
  })
})
