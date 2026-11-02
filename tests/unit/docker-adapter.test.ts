import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dockerCommand } from '../../packages/theo/src/cli/commands/docker.js'
import { tmpdir } from 'node:os'

function createTempProject(lockfile = 'pnpm-lock.yaml'): string {
  // `mkdtempSync`, not a name built from a clock or a counter: this directory is WRITTEN to, and
  // a name another process can predict is a window to pre-create it as a symlink and redirect
  // every write (CodeQL `js/insecure-temporary-file`).
  const dir = mkdtempSync(join(tmpdir(), 'theo-docker-test-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{}')
  writeFileSync(join(dir, lockfile), '')
  return dir
}

describe('Docker Adapter', () => {
  it('should generate Dockerfile', async () => {
    const dir = createTempProject()
    const origCwd = process.cwd()
    process.chdir(dir)
    try {
      await dockerCommand()
      expect(existsSync(join(dir, 'Dockerfile'))).toBe(true)
    } finally {
      process.chdir(origCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('should generate .dockerignore', async () => {
    const dir = createTempProject()
    const origCwd = process.cwd()
    process.chdir(dir)
    try {
      await dockerCommand()
      expect(existsSync(join(dir, '.dockerignore'))).toBe(true)
    } finally {
      process.chdir(origCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('should use node:22 in Dockerfile', async () => {
    const dir = createTempProject()
    const origCwd = process.cwd()
    process.chdir(dir)
    try {
      await dockerCommand()
      const content = readFileSync(join(dir, 'Dockerfile'), 'utf-8')
      expect(content).toContain('node:22')
    } finally {
      process.chdir(origCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('should detect pnpm from lockfile', async () => {
    const dir = createTempProject('pnpm-lock.yaml')
    const origCwd = process.cwd()
    process.chdir(dir)
    try {
      await dockerCommand()
      const content = readFileSync(join(dir, 'Dockerfile'), 'utf-8')
      expect(content).toContain('pnpm')
    } finally {
      process.chdir(origCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('should detect npm from lockfile', async () => {
    const dir = createTempProject('package-lock.json')
    const origCwd = process.cwd()
    process.chdir(dir)
    try {
      await dockerCommand()
      const content = readFileSync(join(dir, 'Dockerfile'), 'utf-8')
      expect(content).toContain('npm ci')
    } finally {
      process.chdir(origCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // #1069 — `npx theo build` resolved the unrelated npm package `theo` (a design-tokens tool) from
  // the registry, installed it inside the image build and ran it. The installed bin is `theokit`.
  it.each(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'])(
    'builds and starts with the installed theokit bin, never a registry lookup (%s)',
    async (lockfile) => {
      const dir = createTempProject(lockfile)
      const origCwd = process.cwd()
      process.chdir(dir)
      try {
        await dockerCommand()
        const content = readFileSync(join(dir, 'Dockerfile'), 'utf-8')
        expect(content).not.toMatch(/\btheo (build|start)\b/)
        expect(content).not.toContain('"theo"')
        expect(content).toContain('RUN ./node_modules/.bin/theokit build')
        expect(content).toContain('CMD ["./node_modules/.bin/theokit", "start"]')
      } finally {
        process.chdir(origCwd)
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  // #1069 — the runner copied `/app/server`, which does not exist when `serverDir` is `src/server`
  // (the create-theokit layout), so the image build failed at that COPY.
  it('copies the directories the configured serverDir and agentsDir live in', async () => {
    const dir = createTempProject('package-lock.json')
    writeFileSync(
      join(dir, 'theo.config.ts'),
      "export default { appDir: 'src/app', serverDir: 'src/server', agentsDir: 'src/server/agents' }\n",
    )
    const origCwd = process.cwd()
    process.chdir(dir)
    try {
      await dockerCommand()
      const content = readFileSync(join(dir, 'Dockerfile'), 'utf-8')
      expect(content).toContain('COPY --from=builder /app/src ./src')
      expect(content).not.toContain('/app/server')
      expect(content).toContain('COPY --from=builder /app/theo.config.ts ./theo.config.ts')
    } finally {
      process.chdir(origCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('copies the flat layout directories when the config declares no paths', async () => {
    const dir = createTempProject('package-lock.json')
    const origCwd = process.cwd()
    process.chdir(dir)
    try {
      await dockerCommand()
      const content = readFileSync(join(dir, 'Dockerfile'), 'utf-8')
      expect(content).toContain('COPY --from=builder /app/server ./server')
      expect(content).toContain('COPY --from=builder /app/agents ./agents')
      // No theo.config.ts in this project, so there is nothing to copy and a COPY would fail.
      expect(content).not.toContain('theo.config.ts')
    } finally {
      process.chdir(origCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Inside a container `localhost` answers nobody (#402); the image has to bind every interface.
  it('binds every interface inside the container', async () => {
    const dir = createTempProject('package-lock.json')
    const origCwd = process.cwd()
    process.chdir(dir)
    try {
      await dockerCommand()
      const content = readFileSync(join(dir, 'Dockerfile'), 'utf-8')
      expect(content).toContain('ENV HOST=0.0.0.0')
    } finally {
      process.chdir(origCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('copies pnpm-workspace.yaml next to the lockfile when the project has one', async () => {
    const dir = createTempProject('pnpm-lock.yaml')
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'allowBuilds:\n  esbuild: true\n')
    const origCwd = process.cwd()
    process.chdir(dir)
    try {
      await dockerCommand()
      const content = readFileSync(join(dir, 'Dockerfile'), 'utf-8')
      expect(content).toContain('COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./')
    } finally {
      process.chdir(origCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // #1069 secondary — `.dockerignore` excluded all of `.theokit`, so `.theokit/THEO.md` never reached
  // the image. The context goes in; runtime state and credentials stay out.
  it('sends the agent context in .theokit to the build and keeps the rest out', async () => {
    const dir = createTempProject()
    const origCwd = process.cwd()
    process.chdir(dir)
    try {
      await dockerCommand()
      const lines = readFileSync(join(dir, '.dockerignore'), 'utf-8').split('\n')
      expect(lines).not.toContain('.theokit')
      expect(lines).toContain('.theokit/*')
      expect(lines).toContain('!.theokit/THEO.md')
      expect(lines).toContain('!.theokit/rules')
      expect(lines).toContain('!.theokit/personalities')
    } finally {
      process.chdir(origCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('should skip if Dockerfile exists without --force', async () => {
    const dir = createTempProject()
    writeFileSync(join(dir, 'Dockerfile'), 'existing')
    const origCwd = process.cwd()
    process.chdir(dir)
    try {
      await dockerCommand()
      // Should NOT overwrite
      expect(readFileSync(join(dir, 'Dockerfile'), 'utf-8')).toBe('existing')
    } finally {
      process.chdir(origCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('should overwrite with --force', async () => {
    const dir = createTempProject()
    writeFileSync(join(dir, 'Dockerfile'), 'existing')
    const origCwd = process.cwd()
    process.chdir(dir)
    try {
      await dockerCommand({ force: true })
      expect(readFileSync(join(dir, 'Dockerfile'), 'utf-8')).toContain('node:22')
    } finally {
      process.chdir(origCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
