import { execSync } from 'node:child_process'
import { readFileSync, unlinkSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

import { aliasPaths } from './alias-paths.js'
import { cloneExample } from './clone-example.js'
import { runInstall } from './install.js'
import { detectPkgManager, type PkgManager } from './pkg-manager.js'
import { assertNodeVersion } from './preflight-node.js'
import { runPrompts, getDefaults, type ProjectOptions } from './prompts.js'
import { parseBackendFlags, scaffoldServices, type BackendKind } from './scaffold-services.js'
import { applySurface, parseSurfaceFlags, type SurfaceKind } from './scaffold-surface.js'
import { CLI_VERSION } from './version.js'
import { writeScaffoldFile } from './write-file.js'

import { scaffold } from './index.js'

const VERSION = CLI_VERSION

function getFlag(args: string[], name: string): string | undefined {
  const flag = args.find((a) => a.startsWith(`--${name}=`))
  return flag ? flag.split('=')[1] : undefined
}

function hasFlag(args: string[], ...names: string[]): boolean {
  return names.some((n) => args.includes(`--${n}`) || args.includes(`-${n}`))
}

function showHelp(): void {
  console.log(`
  create-theokit v${VERSION}

  Usage: create-theokit <project-name> [options]

  Options:
    -h, --help                    Show this help message
    -v, --version                 Show version number
    --yes                         Use recommended defaults (skip prompts)
    --template=<name>             Template to use (default: "default")
    --surface=<web|tui|desktop>   App surface (default: "web") — tui (Ink) / desktop (Tauri)
    --bare                        Minimal app (no @theokit/* deps)
    --preset=bot                  Layer the unattended-agent shape over the template
    --skip-install                Scaffold files only, skip package install
    --disable-git                 Skip git init
    --use-npm                     Use npm as package manager
    --use-pnpm                    Use pnpm as package manager
    --use-yarn                    Use yarn as package manager
    --use-bun                     Use bun as package manager
    --import-alias=<alias>        Import alias (default: "@/*")
    --example=<github-url>        Bootstrap from a GitHub repository
    --biome                       Use Biome instead of ESLint
    --agents-md                   Include AGENTS.md (default: true)

  Examples:
    npx create-theokit my-app --yes
    npx create-theokit my-app
    npx create-theokit my-app --bare --skip-install
    npx create-theokit my-app --surface=tui
    npx create-theokit my-app --preset=bot
    npx create-theokit my-app --surface=desktop
    npx create-theokit my-app --use-bun --biome
    npx create-theokit my-app --example=https://github.com/user/repo
    npx create-theokit my-app --import-alias="~/*"
`)
}

export /**
 * `--preset=<name>` — today only `bot` (#467).
 *
 * Extracted rather than inlined because an unknown value must be REFUSED by name: a typo that
 * silently scaffolds the plain template is a person wondering for ten minutes where their bots
 * went. Ignoring an unrecognised flag is the failure this whole session kept finding — a
 * declaration that reports something the code did not do.
 */
function parsePresetFlag(args: string[]): boolean {
  const preset = getFlag(args, 'preset')
  if (preset === undefined) return false
  if (preset !== 'bot') {
    console.error('')
    console.error(`Unknown preset "${preset}". The only preset today is \`bot\`.`)
    process.exit(1)
  }
  return true
}

async function main(): Promise<void> {
  try {
    assertNodeVersion(process.version)
  } catch (err) {
    console.error('')
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  const args = process.argv.slice(2)

  // -h / --help
  if (hasFlag(args, 'h', 'help')) {
    showHelp()
    process.exit(0)
  }

  // -v / --version
  if (hasFlag(args, 'v', 'version')) {
    console.log(VERSION)
    process.exit(0)
  }

  const positionalArgs = args.filter((a) => !a.startsWith('--') && !a.startsWith('-'))
  const projectName = positionalArgs[0]

  if (!projectName) {
    showHelp()
    process.exit(1)
  }

  // Parse flags
  const templateName = getFlag(args, 'template') ?? 'default'
  const bare = hasFlag(args, 'bare')
  const botPreset = parsePresetFlag(args)
  const skipInstall = hasFlag(args, 'skip-install')
  const useDefaults = hasFlag(args, 'yes')
  const disableGit = hasFlag(args, 'disable-git')
  const useBiome = hasFlag(args, 'biome')
  const exampleFlag = getFlag(args, 'example')
  const importAlias = getFlag(args, 'import-alias') ?? '@/*'

  // --use-npm/pnpm/yarn/bun override
  let pkgManagerOverride: PkgManager | undefined
  if (hasFlag(args, 'use-npm')) pkgManagerOverride = 'npm'
  else if (hasFlag(args, 'use-pnpm')) pkgManagerOverride = 'pnpm'
  else if (hasFlag(args, 'use-yarn')) pkgManagerOverride = 'yarn'
  else if (hasFlag(args, 'use-bun')) pkgManagerOverride = 'bun'

  let backends: BackendKind[] = []
  try {
    backends = parseBackendFlags(args)
  } catch (err) {
    console.error('')
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  let surface: SurfaceKind = 'web'
  try {
    surface = parseSurfaceFlags(args)
  } catch (err) {
    console.error('')
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
  // --bare strips the agent deps; a tui/desktop surface needs them. Refuse the contradiction fail-fast.
  if (bare && surface !== 'web') {
    console.error(
      `\n--bare cannot be combined with --surface=${surface} (the surface needs the agent deps).\n`,
    )
    process.exit(1)
  }

  const targetDir = resolve(process.cwd(), projectName)

  // --example: clone from GitHub
  if (exampleFlag) {
    try {
      console.log(`\nCloning example "${exampleFlag}" into ${projectName}...\n`)
      cloneExample(exampleFlag, targetDir)
      const pkgManager = pkgManagerOverride ?? detectPkgManager()
      if (!skipInstall) {
        console.log(`Installing dependencies with ${pkgManager}...\n`)
        runInstall(targetDir, pkgManager)
      }
      if (!disableGit) initGit(targetDir)
      console.log(`\n  ✓ Example cloned to ${targetDir}\n`)
      console.log(`    cd ${projectName}`)
      console.log(`    ${pkgManager === 'npm' ? 'npm run' : pkgManager} dev\n`)
      process.exit(0)
    } catch (err) {
      console.error(`\n  ✗ ${(err as Error).message}\n`)
      process.exit(1)
    }
  }

  // Interactive prompts (skipped with --yes or --bare)
  let options: ProjectOptions
  if (useDefaults || bare) {
    options = getDefaults(projectName)
    if (useBiome) options.eslint = false // Biome replaces ESLint
  } else {
    options = await runPrompts(projectName)
  }

  try {
    const suffix = bare ? ' [--bare]' : ''
    const surfaceSuffix = surface !== 'web' ? ` [surface: ${surface}]` : ''
    const backendsSuffix = backends.length > 0 ? ` [+services: ${backends.join(', ')}]` : ''
    console.log(
      `\nCreating TheoKit project "${projectName}" (template: ${templateName})${suffix}${surfaceSuffix}${backendsSuffix}${botPreset ? ' + bot preset' : ''}...\n`,
    )

    scaffold(targetDir, projectName, templateName, { bare, botPreset })

    // M45 — apply the surface onto the scaffolded default (tui/desktop; web is a no-op).
    applySurfaceStep(targetDir, projectName, surface, options)

    // Post-scaffold: apply user options
    applyOptions(targetDir, options, { importAlias, useBiome })

    if (backends.length > 0) {
      scaffoldServices({ targetDir, projectName, backends })
      console.log(`  ✓ Scaffolded ${String(backends.length)} service(s): ${backends.join(', ')}\n`)
    }

    const pkgManager = pkgManagerOverride ?? detectPkgManager()
    if (skipInstall) {
      console.log(`Skipping install (--skip-install). Run \`${pkgManager} install\` manually.\n`)
    } else {
      console.log(`Installing dependencies with ${pkgManager}...\n`)
      runInstall(targetDir, pkgManager)
    }

    // git init (unless --disable-git)
    if (!disableGit) initGit(targetDir)

    console.log(`\n  ✓ Project created at ${targetDir}\n`)
    console.log('  Next steps:\n')
    console.log(`    cd ${projectName}`)
    if (skipInstall) console.log(`    ${pkgManager} install`)
    console.log(`    ${pkgManager === 'npm' ? 'npm run' : pkgManager} dev\n`)
  } catch (err) {
    console.error(`\n  ✗ ${(err as Error).message}\n`)
    process.exit(1)
  }
}

// ── Post-scaffold transforms ──

/**
 * M45 — apply the surface onto the scaffolded default (tui/desktop; web is a no-op). Rolls the whole
 * target dir back on failure (EC-4), exactly like --bare, and disables the web-only options a
 * tui/desktop app does not ship.
 */
function applySurfaceStep(
  targetDir: string,
  projectName: string,
  surface: SurfaceKind,
  options: ProjectOptions,
): void {
  if (surface === 'web') return
  try {
    applySurface({ targetDir, projectName, surface })
  } catch (err) {
    rmSync(targetDir, { recursive: true, force: true })
    const original = err instanceof Error ? err.message : String(err)
    throw new Error(`Scaffold rolled back: surface transform failed.\nOriginal error: ${original}`)
  }
  options.tailwind = false
}

interface ApplyOpts {
  importAlias: string
  useBiome: boolean
}

function applyOptions(targetDir: string, options: ProjectOptions, opts: ApplyOpts): void {
  const pkgPath = resolve(targetDir, 'package.json')

  // Biome: replace ESLint with Biome
  if (opts.useBiome) {
    const eslintPath = resolve(targetDir, 'eslint.config.mjs')
    if (existsSync(eslintPath)) unlinkSync(eslintPath)

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    delete pkg.devDependencies.eslint
    delete pkg.devDependencies['eslint-config-prettier']
    delete pkg.devDependencies['typescript-eslint']
    pkg.devDependencies['@biomejs/biome'] = '^1.9.0'
    pkg.scripts.lint = 'biome check .'
    pkg.scripts['lint:fix'] = 'biome check . --fix'
    pkg.scripts.format = 'biome format . --write'
    pkg.scripts['format:check'] = 'biome format .'
    writeScaffoldFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

    // Write biome.json
    writeScaffoldFile(
      resolve(targetDir, 'biome.json'),
      JSON.stringify(
        {
          $schema: 'https://biomejs.dev/schemas/1.9.0/schema.json',
          organizeImports: { enabled: true },
          linter: { enabled: true, rules: { recommended: true } },
          formatter: { enabled: true, indentStyle: 'space', indentWidth: 2, lineWidth: 100 },
        },
        null,
        2,
      ) + '\n',
    )
  } else if (!options.eslint) {
    // No linter
    const eslintPath = resolve(targetDir, 'eslint.config.mjs')
    if (existsSync(eslintPath)) unlinkSync(eslintPath)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    delete pkg.scripts.lint
    delete pkg.scripts['lint:fix']
    delete pkg.devDependencies.eslint
    delete pkg.devDependencies['eslint-config-prettier']
    delete pkg.devDependencies['typescript-eslint']
    writeScaffoldFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }

  // Tailwind
  if (options.tailwind) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    pkg.devDependencies = pkg.devDependencies ?? {}
    pkg.devDependencies.tailwindcss = '^4.0.0'
    pkg.devDependencies['@tailwindcss/vite'] = '^4.0.0'
    writeScaffoldFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    const cssDir = existsSync(resolve(targetDir, 'src/app')) ? 'src/app' : 'app'
    const cssPath = resolve(targetDir, `${cssDir}/globals.css`)
    const existing = existsSync(cssPath) ? readFileSync(cssPath, 'utf-8') : ''
    writeScaffoldFile(cssPath, '@import "tailwindcss";\n\n' + existing)
  }

  // `src/` is the layout, not an option. The block that used to move `app/` and `server/` into it
  // is gone because there is nothing left to move — and leaving it would have been worse than dead
  // code: it also relocated `theo.config.ts` into `src/`, where the CLI does not look for it, and
  // overwrote `include` with `src/**` alone, dropping the two ambient `.d.ts` globs the template
  // needs. A flag whose "on" state breaks the project it configures is a flag nobody can use
  // correctly.

  // Import alias (custom or disabled)
  const tscPath = resolve(targetDir, 'tsconfig.json')
  const tsc = JSON.parse(readFileSync(tscPath, 'utf-8'))
  if (!options.aliases) {
    delete tsc.compilerOptions.baseUrl
    delete tsc.compilerOptions.paths
  } else if (opts.importAlias !== '@/*') {
    // Custom alias: replace @/* with user choice. The mapping lives in `alias-paths.ts` so it can
    // be tested against the directories the template actually ships (see that file's docblock).
    tsc.compilerOptions.paths = aliasPaths(opts.importAlias)
  }
  writeScaffoldFile(tscPath, JSON.stringify(tsc, null, 2) + '\n')

  // AGENTS.md
  if (!options.agentsMd) {
    const agentsPath = resolve(targetDir, 'AGENTS.md')
    if (existsSync(agentsPath)) unlinkSync(agentsPath)
  }
}

// ── Git init ──

function initGit(targetDir: string): void {
  try {
    execSync('git init', { cwd: targetDir, stdio: 'ignore' })
    execSync('git add -A', { cwd: targetDir, stdio: 'ignore' })
    execSync('git commit -m "Initial commit from create-theokit" --no-verify', {
      cwd: targetDir,
      stdio: 'ignore',
    })
  } catch {
    // git not installed — silently skip
  }
}

// Auto-execute
main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
