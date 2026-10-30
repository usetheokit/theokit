/**
 * Scaffold transform. Mutates files inside the freshly-created target
 * directory whose absolute path is the function input. No HTTP input.
 */
/**
 * T4.1 — `--bare` transformation.
 *
 * Applied AFTER the default template is copied. Removes:
 *   - `@theokit/ui` from `package.json` dependencies (TheoUI bundled components)
 *   - `@theokit/sdk` from `package.json` dependencies (agent SDK — see below)
 *   - `@theokit/agents` from `package.json` dependencies (only agents/chat.ts used it)
 *   - `app/page.tsx` agent-surface content (replaces with Hello Theo)
 *   - `src/server/agents/` (the demo agent, its hooks, skills, tools and prompts)
 *   - `src/app/page.test.tsx` (tests the chat page; replaced with a test of the Hello page)
 *   - tailwind* + postcss* from devDependencies, `@tailwindcss/vite` included
 *     (toolchain cleanup — only the @theokit/ui-driven surface needs it)
 *   - `tailwind.config.ts` + `postcss.config.js` when a template ships them.
 *     The default template does NOT: Tailwind v4 is configured by the framework
 *     when it detects `@theokit/ui` + `@tailwindcss/vite`, so there is no config
 *     file to maintain. The removals stay for templates that predate v4.
 *
 * Why SDK removal is in --bare:
 *   `--bare` drops the demo agent, and `@theokit/sdk` is the runtime only that
 *   agent needs. Shipping it in a scaffold with no agent is a dependency the
 *   app never imports. (It is published — the removal is about scope, not
 *   availability.)
 *
 * EC-4: callers MUST wrap this in try/catch + `rmSync` rollback so a partial
 * transform never leaves the target dir in a broken state.
 */

import { existsSync, readFileSync, unlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { writeScaffoldFile } from './write-file.js'

const HELLO_PAGE = `export default function Page() {
  return <h1>Hello Theo</h1>
}
`

// The default `page.test.tsx` renders the chat page through `@theokit/ui`, which --bare removes, so
// the bare app replaces it with a test of its own page. Server rendering keeps it in the default
// `node` environment: no DOM library is needed to read one heading.
const HELLO_PAGE_TEST = `import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import Page from './page'

describe('home page', () => {
  it('greets the visitor', () => {
    expect(renderToStaticMarkup(<Page />)).toContain('Hello Theo')
  })
})
`

// --bare ships an unstyled shell: no @theokit/ui Header, no styles.css import. Replaces the default
// layout (which composes components/Header.tsx + imports @theokit/ui, both dropped by --bare).
const BARE_LAYOUT = `import { Outlet } from 'react-router'

export default function RootLayout() {
  return <Outlet />
}
`

interface BareTransformOptions {
  /** Test-only — force a synthetic write failure to validate rollback path. */
  _testForceError?: string
}

export function applyBareTransform(targetDir: string, options: BareTransformOptions = {}): void {
  if (options._testForceError) {
    throw new Error(`Forced transform failure: ${options._testForceError}`)
  }

  // 1. Remove @theokit/ui + @theokit/sdk + tailwind toolchain from deps
  const pkgPath = join(targetDir, 'package.json')
  if (existsSync(pkgPath)) {
    interface PartialPackageJson {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      [key: string]: unknown
    }
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PartialPackageJson
    if (pkg.dependencies) {
      delete pkg.dependencies['@theokit/ui']
      // The SDK is the runtime of the demo agent, which --bare removes. A
      // scaffold with no agent should not carry the agent runtime.
      delete pkg.dependencies['@theokit/sdk']
      // --bare removes the demo agent (agents/chat.ts), so its runtime dep
      // (@theokit/agents, imported only by that file) goes with it.
      delete pkg.dependencies['@theokit/agents']
      // lucide-react ships with the TheoUI surface; --bare doesn't render
      // any icons so it's safe to drop.
      delete pkg.dependencies['lucide-react']
      // The app-chrome kit, imported only by the chat components removed below.
      delete pkg.dependencies['@usetheo/ui']
    }
    if (pkg.devDependencies) {
      // Tailwind toolchain is only needed by the @theokit/ui-driven default
      // surface. --bare ships unstyled Hello Theo; no Tailwind required.
      // `@tailwindcss/vite` is the entry the default template declares (v4 has
      // no config file or postcss step) — dropping `tailwindcss` without it
      // left the scaffold installing a Vite plugin whose engine was gone.
      delete pkg.devDependencies.tailwindcss
      delete pkg.devDependencies['@tailwindcss/vite']
      delete pkg.devDependencies['tailwindcss-animate']
      delete pkg.devDependencies.postcss
      delete pkg.devDependencies.autoprefixer
    }
    writeScaffoldFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  }

  // 2. Replace app/page.tsx (Hello Theo) + app/layout.tsx (unstyled shell) — the defaults compose the chat
  //    surface + import @theokit/ui, which --bare drops.
  const pagePath = join(targetDir, 'src/app/page.tsx')
  if (existsSync(pagePath)) {
    writeScaffoldFile(pagePath, HELLO_PAGE)
  }
  const layoutPath = join(targetDir, 'src/app/layout.tsx')
  if (existsSync(layoutPath)) {
    writeScaffoldFile(layoutPath, BARE_LAYOUT)
  }

  const pageTestPath = join(targetDir, 'src/app/page.test.tsx')
  if (existsSync(pageTestPath)) {
    writeScaffoldFile(pageTestPath, HELLO_PAGE_TEST)
  }

  // 3. Remove the agent: the whole `src/server/agents/` tree, not only `chat.ts`. Its hooks import
  //    `@theokit/agents` and its skills `@theokit/sdk`, both removed from package.json above, so
  //    leaving them failed the bare app's own `typecheck` (usetheokit/theokit#1008). The tools and
  //    prompts typecheck, but they are agent code in an app that has no agent. `src/shared/agent.ts`
  //    is the agent's display metadata and goes with it.
  rmSync(join(targetDir, 'src/server/agents'), { recursive: true, force: true })
  rmSync(join(targetDir, 'src/shared/agent.ts'), { force: true })

  // 3b. Remove the chat frontend surface — `app/{components,hooks,lib}/` (import @theokit/ui) + the
  //     `app/about/` example route (part of the chat demo). The Hello-Theo page references none of them.
  //     (The route surface — layout/page/error/… — is kept; page + layout are rewritten above.)
  for (const dir of ['src/app/components', 'src/app/hooks', 'src/app/lib', 'src/app/about']) {
    const p = join(targetDir, dir)
    if (existsSync(p)) rmSync(p, { recursive: true, force: true })
  }

  // 4. Remove tailwind + postcss config files (toolchain dropped from devDeps)
  const tailwindCfg = join(targetDir, 'tailwind.config.ts')
  if (existsSync(tailwindCfg)) {
    unlinkSync(tailwindCfg)
  }
  const postcssCfg = join(targetDir, 'postcss.config.js')
  if (existsSync(postcssCfg)) {
    unlinkSync(postcssCfg)
  }
}
