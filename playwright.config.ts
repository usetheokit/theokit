import path from 'node:path'

import { defineConfig } from '@playwright/test'

/**
 * Local E2E harness — boots a TheoKit dev server per fixture app and drives
 * it with a real browser. Each project pins its own port + fixture so the
 * dev servers do not collide.
 *
 * Scope: the four dependency-free routing fixtures (hello-theo + the three
 * app-router fixtures). These exercise the core file-system router end-to-end
 * with no external services. Heavier specs (template-{default,saas,postgres},
 * services-*, devtools, websocket, ssr-nonce, example-full-stack-agent) need
 * additional setup (sdk/ui/postgres/python/LLM creds or the not-yet-built
 * templates) and are intentionally NOT wired here — add a project per fixture
 * as each becomes self-contained.
 */
const rootDir = path.dirname(new URL(import.meta.url).pathname)
const cliPath = path.resolve(rootDir, 'packages/theo/src/cli/index.ts')

function fixture(name: string): string {
  return path.resolve(rootDir, 'fixtures', name)
}

interface E2EProject {
  name: string
  port: number
  fixtureDir: string
  spec: string
}

const PROJECTS: E2EProject[] = [
  { name: 'hello-theo', port: 3456, fixtureDir: 'onda1-hello-theo', spec: 'hello-theo.spec.ts' },
  {
    name: 'app-router-layouts',
    port: 3457,
    fixtureDir: 'app-router-nested-layouts',
    spec: 'app-router-layouts.spec.ts',
  },
  {
    name: 'app-router-errors',
    port: 3458,
    fixtureDir: 'app-router-errors',
    spec: 'app-router-errors.spec.ts',
  },
  {
    name: 'app-router-not-found',
    port: 3459,
    fixtureDir: 'app-router-not-found',
    spec: 'app-router-not-found.spec.ts',
  },
]

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // Sequential — multiple dev servers compete for resources in parallel.
  workers: 1,
  projects: PROJECTS.map((p) => ({
    name: p.name,
    use: { baseURL: `http://localhost:${p.port}` },
    testMatch: p.spec,
  })),
  webServer: PROJECTS.map((p) => ({
    command: `npx tsx ${cliPath} dev --port ${p.port}`,
    cwd: fixture(p.fixtureDir),
    port: p.port,
    reuseExistingServer: false,
    timeout: 30_000,
  })),
})
