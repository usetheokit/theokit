import { execSync } from 'node:child_process'
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  renameSync,
  existsSync,
  rmSync,
} from 'node:fs'
import { resolve, join } from 'node:path'

import { runInstall } from './install.js'
import { detectPkgManager } from './pkg-manager.js'
import { assertNodeVersion } from './preflight-node.js'
import { runPrompts, getDefaults, type ProjectOptions } from './prompts.js'
import { parseBackendFlags, scaffoldServices, type BackendKind } from './scaffold-services.js'

import { scaffold } from './index.js'

const VERSION = '0.8.0'

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
    --bare                        Minimal app (no @theokit/* deps)
    --skip-install                Scaffold files only, skip package install
    --disable-git                 Skip git init
    --use-npm                     Use npm as package manager
    --use-pnpm                    Use pnpm as package manager
    --use-yarn                    Use yarn as package manager
    --use-bun                     Use bun as package manager
    --import-alias=<alias>        Import alias (default: "@/*")
    --example=<name|github-url>   Bootstrap from a GitHub example
    --biome                       Use Biome instead of ESLint
    --agents-md                   Include AGENTS.md (default: true)

  Examples:
    npx create-theokit my-app --yes
    npx create-theokit my-app
    npx create-theokit my-app --bare --skip-install
    npx create-theokit my-app --use-bun --biome
    npx create-theokit my-app --example=https://github.com/user/repo
    npx create-theokit my-app --import-alias="~/*"
`)
}

export async function main(): Promise<void> {
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
  const skipInstall = hasFlag(args, 'skip-install')
  const useDefaults = hasFlag(args, 'yes')
  const disableGit = hasFlag(args, 'disable-git')
  const useBiome = hasFlag(args, 'biome')
  const exampleFlag = getFlag(args, 'example')
  const importAlias = getFlag(args, 'import-alias') ?? '@/*'

  // --use-npm/pnpm/yarn/bun override
  let pkgManagerOverride: string | undefined
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
    const backendsSuffix = backends.length > 0 ? ` [+services: ${backends.join(', ')}]` : ''
    console.log(
      `\nCreating TheoKit project "${projectName}" (template: ${templateName})${suffix}${backendsSuffix}...\n`,
    )

    scaffold(targetDir, projectName, templateName, { bare })

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
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

    // Write biome.json
    writeFileSync(
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
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }

  // Tailwind
  if (options.tailwind) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    pkg.devDependencies = pkg.devDependencies ?? {}
    pkg.devDependencies.tailwindcss = '^4.0.0'
    pkg.devDependencies['@tailwindcss/vite'] = '^4.0.0'
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    const cssDir = existsSync(resolve(targetDir, 'src/app')) ? 'src/app' : 'app'
    writeFileSync(resolve(targetDir, `${cssDir}/globals.css`), '@import "tailwindcss";\n')
  }

  // src/ directory
  if (options.srcDir) {
    const srcDir = resolve(targetDir, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const dir of ['app', 'server']) {
      const from = resolve(targetDir, dir)
      const to = resolve(srcDir, dir)
      if (existsSync(from)) renameSync(from, to)
    }
    const appFrom = resolve(targetDir, 'app.tsx')
    if (existsSync(appFrom)) renameSync(appFrom, resolve(srcDir, 'app.tsx'))

    const tscPath = resolve(targetDir, 'tsconfig.json')
    const tsc = JSON.parse(readFileSync(tscPath, 'utf-8'))
    tsc.compilerOptions.baseUrl = 'src'
    tsc.include = ['src/**/*.ts', 'src/**/*.tsx']
    writeFileSync(tscPath, JSON.stringify(tsc, null, 2) + '\n')

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    pkg.scripts.dev = 'npx tsx --watch src/app.tsx'
    pkg.scripts['dev:bun'] = 'bun --watch src/app.tsx'
    pkg.scripts.build = 'npx tsup src/app.tsx --format esm --out-dir dist'
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }

  // Import alias (custom or disabled)
  const tscPath = resolve(targetDir, 'tsconfig.json')
  const tsc = JSON.parse(readFileSync(tscPath, 'utf-8'))
  if (!options.aliases) {
    delete tsc.compilerOptions.baseUrl
    delete tsc.compilerOptions.paths
  } else if (opts.importAlias !== '@/*') {
    // Custom alias: replace @/* with user choice
    const prefix = opts.importAlias.replace('/*', '')
    tsc.compilerOptions.paths = {
      [`${prefix}/*`]: ['./*'],
      [`${prefix}/server/*`]: ['./server/*'],
      [`${prefix}/app/*`]: ['./app/*'],
    }
  }
  writeFileSync(tscPath, JSON.stringify(tsc, null, 2) + '\n')

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

// ── Example cloning ──

function cloneExample(example: string, targetDir: string): void {
  const isUrl = example.startsWith('http://') || example.startsWith('https://')
  const repo = isUrl
    ? example
    : `https://github.com/usetheodev/theokit-examples/tree/main/${example}`

  if (isUrl) {
    // Full repo URL — shallow clone
    execSync(`git clone --depth 1 ${repo} ${targetDir}`, { stdio: 'inherit' })
    // Remove .git to let user init fresh
    rmSync(join(targetDir, '.git'), { recursive: true, force: true })
  } else {
    // Named example from theokit-examples repo — use degit pattern
    try {
      execSync(`npx --yes degit usetheodev/theokit-examples/${example} ${targetDir}`, {
        stdio: 'inherit',
      })
    } catch {
      throw new Error(
        `Example "${example}" not found. ` +
          `Browse available examples at https://github.com/usetheodev/theokit-examples`,
      )
    }
  }
}

// Auto-execute
main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
