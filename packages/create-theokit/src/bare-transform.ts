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
 *   - `agents/chat.ts` (the demo agent — depends on the SDK + TheoUI page)
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

import { existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const HELLO_PAGE = `export default function Page() {
  return <h1>Hello Theo</h1>
}
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
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  }

  // 2. Replace app/page.tsx (Hello Theo) + app/layout.tsx (unstyled shell) — the defaults compose the chat
  //    surface + import @theokit/ui, which --bare drops.
  const pagePath = join(targetDir, 'app/page.tsx')
  if (existsSync(pagePath)) {
    writeFileSync(pagePath, HELLO_PAGE)
  }
  const layoutPath = join(targetDir, 'app/layout.tsx')
  if (existsSync(layoutPath)) {
    writeFileSync(layoutPath, BARE_LAYOUT)
  }

  // 3. Remove the demo chat agent (the `agents/chat.ts` file + its TheoUI page)
  const chatPath = join(targetDir, 'agents/chat.ts')
  if (existsSync(chatPath)) {
    unlinkSync(chatPath)
  }

  // 3b. Remove the chat frontend surface — `app/{components,hooks,lib}/` (import @theokit/ui) + the
  //     `app/about/` example route (part of the chat demo). The Hello-Theo page references none of them.
  //     (The route surface — layout/page/error/… — is kept; page + layout are rewritten above.)
  for (const dir of ['app/components', 'app/hooks', 'app/lib', 'app/about']) {
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
