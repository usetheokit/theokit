import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  scanUpgradeReadiness,
  type UpgradeReadinessReport,
} from '../../packages/theo/src/cli/commands/upgrade-readiness.js'

/**
 * T2.3 — `theokit check --upgrade-readiness 0.3`
 *
 * LINT-only scanner reporting anticipated violations that will surface as
 * runtime breakage in 0.3.0. Per ADR D1: no AST transforms, only reports.
 *
 * Rules detected:
 *   - csrf-missing-header: raw fetch with POST/PUT/PATCH/DELETE missing
 *     X-Theo-Action header (returns 403 under 0.3.0 strict CSRF)
 *   - inline-script: <script>...</script> in *.html without `src=` attribute
 *     (blocked under 0.3.0 enforce CSP without `'unsafe-inline'`)
 *   - dangerously-set-inline-script: React dangerouslySetInnerHTML payload
 *     containing <script>
 *
 * EC-7 (SHOULD TEST): violation regex MUST skip occurrences inside
 * comments and string literals (best-effort).
 * EC-8 (SHOULD TEST): scanning an empty project (no app/, no server/)
 * MUST exit gracefully with `status: 'no-project-detected'`.
 */

/**
 * The clean and dirty projects are built in a tmpdir rather than read from
 * rest of `fixtures/`. They are built in a tmpdir here with the same content those fixtures
 * declared — one rule per file, so a failure points at the rule.
 */
function makeTheokitProject(contents: Record<string, string>): string {
  const dir = resolve(tmpdir(), `theokit-upgrade-${Date.now()}-${Math.random()}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    resolve(dir, 'package.json'),
    JSON.stringify({ name: 'tmp-app', private: true, dependencies: { theokit: '^0.2.0' } }),
  )
  for (const [rel, content] of Object.entries(contents)) {
    const full = resolve(dir, rel)
    mkdirSync(resolve(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

const CLEAN_SOURCES = {
  'app/page.tsx':
    "import { theoFetch } from 'theokit/client'\n" +
    'export default function Page() {\n' +
    "  const save = () => theoFetch('/api/save', { method: 'POST' })\n" +
    '  return <button onClick={save}>save</button>\n' +
    '}\n',
}

const DIRTY_SOURCES = {
  'app/page.tsx':
    'export default function Page() {\n' +
    "  const save = () => fetch('/api/save', { method: 'POST', body: '{}' })\n" +
    '  return (\n' +
    '    <div onClick={save}\n' +
    "      dangerouslySetInnerHTML={{ __html: '<script>alert(1)</script>' }} />\n" +
    '  )\n' +
    '}\n',
  'public/index.html':
    '<!doctype html>\n<html>\n<body>\n<script>window.x = 1</script>\n</body>\n</html>\n',
  'node_modules/some-dep/index.js': "fetch('/api/x', { method: 'POST' })\n",
}

describe('scanUpgradeReadiness — clean project', () => {
  it('Given a project with theoFetch only, Then status=="ready" and violations is empty', async () => {
    const dir = makeTheokitProject(CLEAN_SOURCES)
    try {
      const report = await scanUpgradeReadiness({ cwd: dir })
      expect(report.status).toBe('ready')
      expect(report.violations).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Given a clean project, Then exitCode === 0', async () => {
    const dir = makeTheokitProject(CLEAN_SOURCES)
    try {
      expect((await scanUpgradeReadiness({ cwd: dir })).exitCode).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('scanUpgradeReadiness — project with violations', () => {
  let dir: string
  let report: UpgradeReadinessReport

  beforeAll(async () => {
    dir = makeTheokitProject(DIRTY_SOURCES)
    report = await scanUpgradeReadiness({ cwd: dir })
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('Given violations exist, Then status=="has-violations" and violations.length > 0', () => {
    expect(report.status).toBe('has-violations')
    expect(report.violations.length).toBeGreaterThan(0)
  })

  it('Given page.tsx with raw fetch POST, Then a csrf-missing-header violation is reported', () => {
    const v = report.violations.find((v) => v.rule === 'csrf-missing-header')
    expect(v).toBeDefined()
    expect(v?.file).toMatch(/page\.tsx$/)
    expect(v?.line).toBeGreaterThan(0)
    expect(v?.message).toMatch(/X-Theo-Action/)
    expect(v?.fix).toMatch(/theoFetch|X-Theo-Action/)
  })

  it('Given public/index.html with inline <script>, Then an inline-script violation is reported', () => {
    const v = report.violations.find((v) => v.rule === 'inline-script')
    expect(v).toBeDefined()
    expect(v?.file).toMatch(/index\.html$/)
    expect(v?.line).toBeGreaterThan(0)
  })

  it('Given page.tsx with dangerouslySetInnerHTML containing <script>, Then dangerously-set-inline-script reported', () => {
    const v = report.violations.find((v) => v.rule === 'dangerously-set-inline-script')
    expect(v).toBeDefined()
    expect(v?.file).toMatch(/page\.tsx$/)
  })

  it('Given a fetch POST inside node_modules, Then NOT reported (node_modules skipped)', () => {
    expect(report.violations.every((v) => !v.file.includes('node_modules'))).toBe(true)
  })

  it('Given a HIGH violation, Then exitCode === 1 (blocks CI)', () => {
    expect(report.exitCode).toBe(1)
  })

  it('Given allowWarnings=true, Then exitCode === 0 even with violations', async () => {
    const relaxed = await scanUpgradeReadiness({ cwd: dir, allowWarnings: true })
    expect(relaxed.status).toBe('has-violations')
    expect(relaxed.exitCode).toBe(0)
  })

  it('Given any scan, Then result is a plain object serializable to JSON with violations array', () => {
    const parsed = JSON.parse(JSON.stringify(report)) as UpgradeReadinessReport
    expect(Array.isArray(parsed.violations)).toBe(true)
    expect(parsed.violations[0]).toMatchObject({
      file: expect.any(String),
      line: expect.any(Number),
      rule: expect.any(String),
      message: expect.any(String),
      fix: expect.any(String),
    })
  })
})

/**
 * EC-7 (SHOULD TEST): skip occurrences inside comments and string literals.
 * We test these by writing tiny one-off sources into a tmp dir; a fixture
 * pollutes the dirty fixture with noise we don't want there.
 */
describe('scanUpgradeReadiness — EC-7 (skip comments + string literals)', () => {
  function makeTmpProject(contents: Record<string, string>): string {
    const dir = resolve(tmpdir(), `theokit-ec7-${Date.now()}-${Math.random()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'package.json'), JSON.stringify({ name: 'tmp', private: true }))
    for (const [rel, content] of Object.entries(contents)) {
      const full = resolve(dir, rel)
      mkdirSync(resolve(full, '..'), { recursive: true })
      writeFileSync(full, content)
    }
    return dir
  }

  it("Given source contains `// fetch('/api/x', { method: 'POST' })`, Then NO violation (line comment skipped)", async () => {
    const dir = makeTmpProject({
      'app/page.tsx':
        "export default function Page() {\n  // const x = fetch('/api/x', { method: 'POST' })\n  return null\n}\n",
    })
    try {
      const report = await scanUpgradeReadiness({ cwd: dir })
      const csrf = report.violations.filter((v) => v.rule === 'csrf-missing-header')
      expect(csrf).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Given fetch as a string literal `const s = "fetch(\\"...\\", { method: \\"POST\\" })"`, Then NO violation', async () => {
    const dir = makeTmpProject({
      'app/page.tsx':
        'export default function Page() {\n  const example = "fetch(\\"/api/x\\", { method: \\"POST\\" })"\n  return <pre>{example}</pre>\n}\n',
    })
    try {
      const report = await scanUpgradeReadiness({ cwd: dir })
      const csrf = report.violations.filter((v) => v.rule === 'csrf-missing-header')
      expect(csrf).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * EC-8 (SHOULD TEST): empty project (no app/, no server/) should not crash.
 */
describe('scanUpgradeReadiness — EC-8 (empty project exits gracefully)', () => {
  it('Given directory with only package.json, Then exitCode===0 and status==="no-project-detected"', async () => {
    const dir = resolve(tmpdir(), `theokit-empty-${Date.now()}-${Math.random()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'package.json'), JSON.stringify({ name: 'empty', private: true }))
    try {
      const report = await scanUpgradeReadiness({ cwd: dir })
      expect(report.exitCode).toBe(0)
      expect(report.status).toBe('no-project-detected')
      expect(report.violations).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * EC-3: a directory that has `app/` (e.g. a Next.js project) but no `theokit`
 * in package.json should be detected as "not a TheoKit project" and produce
 * `status==="not-a-theokit-project"`, exit 1. This prevents the scanner from
 * generating dozens of false positives against Next.js / Remix / Astro apps.
 */
describe('scanUpgradeReadiness — EC-3 (non-TheoKit project detection)', () => {
  it('Given app/ exists but package.json lacks theokit, Then status==="not-a-theokit-project" and exitCode===1', async () => {
    const dir = resolve(tmpdir(), `not-theokit-${Date.now()}-${Math.random()}`)
    mkdirSync(resolve(dir, 'app'), { recursive: true })
    writeFileSync(resolve(dir, 'app', 'page.tsx'), 'export default function Home() { return null }')
    writeFileSync(
      resolve(dir, 'package.json'),
      JSON.stringify({ name: 'next-app', dependencies: { next: '15.0.0' } }),
    )
    try {
      const report = await scanUpgradeReadiness({ cwd: dir })
      expect(report.status).toBe('not-a-theokit-project')
      expect(report.exitCode).toBe(1)
      expect(report.violations).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Given theokit in dependencies, Then scan proceeds normally (regression check)', async () => {
    const dir = resolve(tmpdir(), `is-theokit-${Date.now()}-${Math.random()}`)
    mkdirSync(resolve(dir, 'app'), { recursive: true })
    writeFileSync(resolve(dir, 'app', 'page.tsx'), 'export default function Home() { return null }')
    writeFileSync(
      resolve(dir, 'package.json'),
      JSON.stringify({ name: 'theokit-app', dependencies: { theokit: '^0.2.0' } }),
    )
    try {
      const report = await scanUpgradeReadiness({ cwd: dir })
      expect(['ready', 'has-violations']).toContain(report.status)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Given theokit in devDependencies only, Then scan still proceeds (devDep is valid)', async () => {
    const dir = resolve(tmpdir(), `is-theokit-dev-${Date.now()}-${Math.random()}`)
    mkdirSync(resolve(dir, 'app'), { recursive: true })
    writeFileSync(resolve(dir, 'app', 'page.tsx'), 'export default function Home() { return null }')
    writeFileSync(
      resolve(dir, 'package.json'),
      JSON.stringify({ name: 'theokit-dev', devDependencies: { theokit: '^0.2.0' } }),
    )
    try {
      const report = await scanUpgradeReadiness({ cwd: dir })
      expect(['ready', 'has-violations']).toContain(report.status)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Given malformed package.json, Then scan does NOT crash; exits gracefully', async () => {
    const dir = resolve(tmpdir(), `bad-pkg-${Date.now()}-${Math.random()}`)
    mkdirSync(resolve(dir, 'app'), { recursive: true })
    writeFileSync(resolve(dir, 'app', 'page.tsx'), 'export default function Home() { return null }')
    writeFileSync(resolve(dir, 'package.json'), '{ this is not json')
    try {
      const report = await scanUpgradeReadiness({ cwd: dir })
      // Treated as "no readable package.json" → behave like the EC-8 case.
      expect(report.exitCode).toBe(1)
      expect(report.status).toBe('not-a-theokit-project')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
