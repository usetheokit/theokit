import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { scaffold } from '../../src/index.js'

describe('scaffold (integration — real template)', () => {
  const tempDirs: string[] = []

  function createTargetDir(): string {
    const dir = join(tmpdir(), `create-theokit-integration-${randomUUID()}`)
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it('should produce a valid TheoKit project from the default template', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'integration-test-app')

    // package.json exists with correct name
    const pkgPath = join(targetDir, 'package.json')
    expect(existsSync(pkgPath)).toBe(true)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    expect(pkg.name).toBe('integration-test-app')
    expect(pkg.version).toBe('0.1.0')
    expect(pkg.type).toBe('module')

    // Core template structure
    expect(existsSync(join(targetDir, 'app/page.tsx'))).toBe(true)
    expect(existsSync(join(targetDir, 'app/layout.tsx'))).toBe(true)
    expect(existsSync(join(targetDir, 'server'))).toBe(true)
    expect(existsSync(join(targetDir, 'tsconfig.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'theo.config.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'index.html'))).toBe(true)

    // Agent-centered structure (docs/ARCHITECTURE.md): the agent file + the folders it composes live
    // together under `agents/`, clean-named. The folder-semantic scanner serves only `chat.ts`;
    // `prompts/`, `tools/`, `skills/` are that concern, NOT phantom /api/agents/tools/weather routes.
    expect(existsSync(join(targetDir, 'agents/chat.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'agents/prompts/instructions.ts'))).toBe(true)
    // A real, working set — two tools (a remote HTTP one + a local one) and a real skill.
    expect(existsSync(join(targetDir, 'agents/tools/weather.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'agents/tools/current-time.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'agents/skills/daily-briefing.ts'))).toBe(true)
    // The skill uses the real skills feature (Skill.create), not a dead Markdown note.
    expect(readFileSync(join(targetDir, 'agents/skills/daily-briefing.ts'), 'utf-8')).toContain(
      'Skill.create(',
    )
    // chat.ts composes persona + tools + the skill. ONE `.skills([...])` call registers the inline skill
    // into the `<skills>` block AND auto-provisions the `skill_read` tool (no separate wiring needed).
    const chat = readFileSync(join(targetDir, 'agents/chat.ts'), 'utf-8')
    expect(chat).toContain('BASE_INSTRUCTIONS')
    expect(chat).toContain('.tool(weatherTool)')
    expect(chat).toContain('.tool(currentTimeTool)')
    expect(chat).toContain('.skills([dailyBriefingSkill])')
    // shared/ — one source of truth for cross-layer branding, imported by the agent + the frontend.
    // The frontend consumes it from `app/lib/constants.ts`. The web app is organized type-based: the route
    // surface (page/layout/…) at the app root, plus `components/`, `hooks/`, `lib/` — none of which are
    // routes (a folder is only served when it holds a `page`/`layout`/… file).
    expect(existsSync(join(targetDir, 'shared/agent.ts'))).toBe(true)
    expect(readFileSync(join(targetDir, 'app/lib/constants.ts'), 'utf-8')).toContain(
      "from '../../shared/agent'",
    )
    // components/ (real UI split), hooks/ (the transcript hook), lib/ (constants).
    expect(existsSync(join(targetDir, 'app/components/ChatPanel.tsx'))).toBe(true)
    expect(existsSync(join(targetDir, 'app/components/Composer.tsx'))).toBe(true)
    expect(existsSync(join(targetDir, 'app/components/Header.tsx'))).toBe(true)
    expect(existsSync(join(targetDir, 'app/hooks/use-transcript.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'app/lib/constants.ts'))).toBe(true)
    // A second, self-documenting screen (`/about`) + a nav menu — shows how the app grows. Both use
    // TheoKit's own client primitives (`Link` with prefetch, `Metadata` for the title), not raw react-router.
    expect(existsSync(join(targetDir, 'app/about/page.tsx'))).toBe(true)
    expect(existsSync(join(targetDir, 'app/components/Nav.tsx'))).toBe(true)
    const nav = readFileSync(join(targetDir, 'app/components/Nav.tsx'), 'utf-8')
    expect(nav).toContain("from 'theokit/client'")
    expect(nav).toContain('prefetch')
    expect(readFileSync(join(targetDir, 'app/about/page.tsx'), 'utf-8')).toContain('Metadata')
    // The page is the composition root: pulls transcript state from the hook, lays out the components.
    const pageSrc = readFileSync(join(targetDir, 'app/page.tsx'), 'utf-8')
    expect(pageSrc).toContain('useChatTranscript')
    expect(pageSrc).toContain('./components/ChatPanel')
    expect(pageSrc).toContain('./hooks/use-transcript')
    expect(readFileSync(join(targetDir, 'app/hooks/use-transcript.ts'), 'utf-8')).toContain(
      'useAgent',
    )
    // layout.tsx composes the Header component (not an inline header).
    expect(readFileSync(join(targetDir, 'app/layout.tsx'), 'utf-8')).toContain(
      "from './components/Header'",
    )
    // docs/ — the structure is documented.
    expect(existsSync(join(targetDir, 'docs/ARCHITECTURE.md'))).toBe(true)

    // .gitignore renamed from _gitignore
    expect(existsSync(join(targetDir, '.gitignore'))).toBe(true)
    expect(existsSync(join(targetDir, '_gitignore'))).toBe(false)

    // No leftover .tmpl files
    expect(existsSync(join(targetDir, 'package.json.tmpl'))).toBe(false)
    expect(existsSync(join(targetDir, 'README.md.tmpl'))).toBe(false)
  })

  it('should produce a valid README.md with project name substituted', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'readme-test')

    const readme = readFileSync(join(targetDir, 'README.md'), 'utf-8')
    expect(readme).toContain('readme-test')
    expect(readme).not.toContain('{{name}}')
  })

  it('should produce a working package.json with expected scripts', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'scripts-test')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts).toBeDefined()
    expect(pkg.scripts.dev).toBeDefined()
    expect(pkg.scripts.build).toBeDefined()
    expect(pkg.scripts.start).toBeDefined()
    expect(pkg.scripts.test).toBe('vitest run')
    expect(pkg.scripts.lint).toBeDefined()
  })

  it('should produce a working package.json with expected dependencies', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'deps-test')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies).toBeDefined()
    expect(pkg.devDependencies).toBeDefined()
    expect(pkg.dependencies.zod).toBeDefined()
    // Chat-surface default (ADR 0026): @theokit/sdk runtime + @theokit/ui components
    expect(pkg.dependencies['@theokit/sdk']).toBeDefined()
    expect(pkg.dependencies['@theokit/ui']).toBeDefined()
    expect(pkg.devDependencies.tailwindcss).toBeDefined()
    expect(pkg.devDependencies['@tailwindcss/vite']).toBeDefined()
    expect(pkg.devDependencies.vitest).toBeDefined()
    // No @swc/core (no controllers)
    expect(pkg.devDependencies['@swc/core']).toBeUndefined()
  })

  it('should include .env.example', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'env-test')

    expect(existsSync(join(targetDir, '.env.example'))).toBe(true)
  })

  it('should produce a bare scaffold with Hello Theo page', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'bare-test', 'default', { bare: true })

    // page.tsx should have Hello Theo
    const page = readFileSync(join(targetDir, 'app/page.tsx'), 'utf-8')
    expect(page).toContain('Hello Theo')

    // SDK-dependent deps should be removed
    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies?.['@theokit/ui']).toBeUndefined()
    expect(pkg.dependencies?.['@theokit/sdk']).toBeUndefined()
    // The chat frontend surface imports @theokit/ui — --bare must drop it all (components/hooks/lib),
    // not leave dead folders referencing a removed dep. layout.tsx is rewritten to an unstyled shell.
    expect(existsSync(join(targetDir, 'app/components'))).toBe(false)
    expect(existsSync(join(targetDir, 'app/hooks'))).toBe(false)
    expect(existsSync(join(targetDir, 'app/lib'))).toBe(false)
    expect(existsSync(join(targetDir, 'app/about'))).toBe(false)
    const bareLayout = readFileSync(join(targetDir, 'app/layout.tsx'), 'utf-8')
    expect(bareLayout).not.toContain('@theokit/ui')
    expect(bareLayout).not.toContain('./components/Header')
  })

  it('should use theokit as main dep without controller-era packages', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'framework-test')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    // theokit is the main dep
    expect(pkg.dependencies.theokit).toMatch(/^\^0\.\d+\.\d+/)
    // @theokit/http is NOT a direct dep (transitive via theokit).
    expect(pkg.dependencies['@theokit/http']).toBeUndefined()
    // @theokit/agents IS a direct dep since M3 — the agents/*.ts convention
    // imports `defineAgent` from it (the proprietary in-theokit surface was removed).
    expect(pkg.dependencies['@theokit/agents']).toMatch(/^\^\d+\.\d+\.\d+/)
    // reflect-metadata is NOT a direct dep (theokit handles it internally)
    expect(pkg.dependencies['reflect-metadata']).toBeUndefined()
    // @swc/core is NOT needed (no controllers — defineRoute only)
    expect(pkg.devDependencies['@swc/core']).toBeUndefined()
    // Scripts use theokit CLI
    expect(pkg.scripts.dev).toBe('theokit dev')
    expect(pkg.scripts.build).toBe('theokit build')
    expect(pkg.scripts.start).toBe('theokit start')
  })

  it('should include theo.config.ts and index.html, not controllers', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'structure-test')

    expect(existsSync(join(targetDir, 'theo.config.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'index.html'))).toBe(true)
    expect(existsSync(join(targetDir, 'server/routes/health.ts'))).toBe(true)
    // EC-2: no controllers, agents, toolboxes, guards, interceptors, filters, middleware
    expect(existsSync(join(targetDir, 'server/controllers'))).toBe(false)
    expect(existsSync(join(targetDir, 'server/agents'))).toBe(false)
    expect(existsSync(join(targetDir, 'server/toolboxes'))).toBe(false)
    expect(existsSync(join(targetDir, 'server/guards'))).toBe(false)
    expect(existsSync(join(targetDir, 'server/store.ts'))).toBe(false)
  })

  it('should include chat + health routes and no database layer (chat-surface default, ADR 0026)', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'clean-template-test')

    // Chat-surface default ships the canonical agents/chat.ts + a health route.
    expect(existsSync(join(targetDir, 'agents/chat.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'server/routes/health.ts'))).toBe(true)
    // No demo tasks routes
    expect(existsSync(join(targetDir, 'server/routes/tasks'))).toBe(false)
    // No bundled database layer — the chat surface is db-agnostic (consumers
    // wire their own persistence). Drizzle/SQLite were removed with the
    // default-only (ADR 0023) + chat-surface (ADR 0026) reshape.
    expect(existsSync(join(targetDir, 'server/db'))).toBe(false)
    expect(existsSync(join(targetDir, 'drizzle.config.ts'))).toBe(false)
  })

  it('should NOT ship Drizzle deps, scripts, or eslint rules (db removed, ADR 0023/0026)', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'no-drizzle-test')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies['drizzle-orm']).toBeUndefined()
    expect(pkg.dependencies['better-sqlite3']).toBeUndefined()
    expect(pkg.devDependencies['drizzle-kit']).toBeUndefined()
    expect(pkg.devDependencies['eslint-plugin-drizzle']).toBeUndefined()
    expect(pkg.scripts['db:migrate']).toBeUndefined()
    expect(pkg.scripts['db:generate']).toBeUndefined()

    // eslint.config.mjs must not reference the (uninstalled) drizzle plugin —
    // otherwise `npm run lint` in the scaffolded app would crash.
    const eslintConfig = readFileSync(join(targetDir, 'eslint.config.mjs'), 'utf-8')
    expect(eslintConfig).not.toContain('drizzle')
  })

  it('should have theo.config.ts without httpDecoratorsPlugin', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'config-test')

    const config = readFileSync(join(targetDir, 'theo.config.ts'), 'utf-8')
    // The template uses the fluent `config().build()` API (was `defineConfig`); the intent of this test
    // is that theo.config.ts wires NO httpDecoratorsPlugin / @theokit/http.
    expect(config).toContain('config(')
    expect(config).not.toContain('httpDecoratorsPlugin')
    expect(config).not.toContain('@theokit/http')
  })

  it('should import @theokit/ui styles in the layout (chat-surface default)', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'css-test')

    // Chat-surface default uses Tailwind v4 + @theokit/ui's bundled stylesheet
    // (zero-config) — there is no hand-written app/globals.css to maintain.
    const layout = readFileSync(join(targetDir, 'app/layout.tsx'), 'utf-8')
    expect(layout).toContain("import '@theokit/ui/styles.css'")
    expect(layout).not.toContain('<link rel="stylesheet"')
  })

  it('should ship a chat-surface page.tsx without demo CRUD code', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'page-test')

    const page = readFileSync(join(targetDir, 'app/page.tsx'), 'utf-8')
    // The page is the composition root: it lays out the ChatPanel + Composer components and pulls transcript
    // state from `useChatTranscript` (the hook wraps the M2 `useAgent`). @theokit/ui lives in the components.
    expect(page).toContain('ChatPanel')
    expect(page).toContain('useChatTranscript')
    expect(readFileSync(join(targetDir, 'app/components/ChatPanel.tsx'), 'utf-8')).toContain(
      '@theokit/ui',
    )
    expect(readFileSync(join(targetDir, 'app/hooks/use-transcript.ts'), 'utf-8')).toContain(
      'useAgent',
    )
    expect(page).not.toContain('useAgentStream')
    // No leftover task-CRUD demo code
    expect(page).not.toContain('createTask')
  })

  it('should scaffold .claude/ with skills and settings', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'claude-test')

    // .claude/ directory created (renamed from dot-claude/)
    expect(existsSync(join(targetDir, '.claude'))).toBe(true)
    expect(existsSync(join(targetDir, 'dot-claude'))).toBe(false)

    // Settings
    expect(existsSync(join(targetDir, '.claude/settings.json'))).toBe(true)
    const settings = JSON.parse(readFileSync(join(targetDir, '.claude/settings.json'), 'utf-8'))
    expect(settings.permissions.deny).toContain('Read(.env*)')

    // Rules
    expect(existsSync(join(targetDir, '.claude/rules/theokit-conventions.md'))).toBe(true)

    // 5 skills
    expect(existsSync(join(targetDir, '.claude/skills/theokit-routes/SKILL.md'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude/skills/theokit-agents/SKILL.md'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude/skills/theokit-database/SKILL.md'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude/skills/theokit-frontend/SKILL.md'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude/skills/theokit-config/SKILL.md'))).toBe(true)

    // CLAUDE.md
    expect(existsSync(join(targetDir, 'CLAUDE.md'))).toBe(true)
    const claudeMd = readFileSync(join(targetDir, 'CLAUDE.md'), 'utf-8')
    expect(claudeMd).toContain('@AGENTS.md')
  })

  it('should preserve non-tmpl files from the template', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'preserve-test')

    // .prettierrc, eslint.config.mjs, tsconfig.json are not .tmpl files
    expect(existsSync(join(targetDir, '.prettierrc'))).toBe(true)
    expect(existsSync(join(targetDir, 'eslint.config.mjs'))).toBe(true)
    expect(existsSync(join(targetDir, 'tsconfig.json'))).toBe(true)
  })
})
