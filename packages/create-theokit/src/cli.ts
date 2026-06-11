import { resolve } from 'node:path'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, renameSync, existsSync } from 'node:fs'

import { runInstall } from './install.js'
import { detectPkgManager } from './pkg-manager.js'
import { assertNodeVersion } from './preflight-node.js'
import { parseBackendFlags, scaffoldServices, type BackendKind } from './scaffold-services.js'
import { scaffold } from './index.js'
import { runPrompts, getDefaults, type ProjectOptions } from './prompts.js'

export async function main(): Promise<void> {
  try {
    assertNodeVersion(process.version)
  } catch (err) {
    console.error('')
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const positionalArgs = args.filter((a) => !a.startsWith('--'))
  const projectName = positionalArgs[0]

  if (!projectName) {
    console.error('Usage: create-theokit <project-name> [--yes] [--template=name] [--bare] [--skip-install]')
    console.error('')
    console.error('Options:')
    console.error('  --yes              Use recommended defaults (skip prompts)')
    console.error('  --template=name    Template: default')
    console.error('  --bare             Minimal app (no @theokit/* deps)')
    console.error('  --skip-install     Scaffold only, skip npm install')
    console.error('')
    console.error('Examples:')
    console.error('  npx create-theokit my-app --yes')
    console.error('  npx create-theokit my-app')
    console.error('  npx create-theokit my-app --bare --skip-install')
    process.exit(1)
  }

  const templateFlag = args.find((a) => a.startsWith('--template='))
  const templateName = templateFlag ? templateFlag.split('=')[1] : 'default'
  const bare = args.includes('--bare')
  const skipInstall = args.includes('--skip-install')
  const useDefaults = args.includes('--yes')

  let backends: BackendKind[] = []
  try {
    backends = parseBackendFlags(args)
  } catch (err) {
    console.error('')
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  // Interactive prompts (skipped with --yes or --bare)
  let options: ProjectOptions
  if (useDefaults || bare) {
    options = getDefaults(projectName)
  } else {
    options = await runPrompts(projectName)
  }

  const targetDir = resolve(process.cwd(), projectName)

  try {
    const suffix = bare ? ' [--bare]' : ''
    const backendsSuffix = backends.length > 0 ? ` [+services: ${backends.join(', ')}]` : ''
    console.log(`\nCreating TheoKit project "${projectName}" (template: ${templateName})${suffix}${backendsSuffix}...\n`)

    scaffold(targetDir, projectName, templateName, { bare })

    // Post-scaffold: apply user options
    applyOptions(targetDir, options)

    if (backends.length > 0) {
      scaffoldServices({ targetDir, projectName, backends })
      console.log(`  ✓ Scaffolded ${String(backends.length)} service(s): ${backends.join(', ')}\n`)
    }

    const pkgManager = detectPkgManager()
    if (skipInstall) {
      console.log(`Skipping install (--skip-install). Run \`${pkgManager} install\` manually.\n`)
    } else {
      console.log(`Installing dependencies with ${pkgManager}...\n`)
      runInstall(targetDir, pkgManager)
    }

    console.log(`\n  ✓ Project created at ${targetDir}\n`)
    console.log('  Next steps:\n')
    console.log(`    cd ${projectName}`)
    if (skipInstall) {
      console.log(`    ${pkgManager} install`)
    }
    console.log(`    ${pkgManager === 'npm' ? 'npm run' : pkgManager} dev\n`)
  } catch (err) {
    console.error(`\n  ✗ ${(err as Error).message}\n`)
    process.exit(1)
  }
}

function applyOptions(targetDir: string, options: ProjectOptions): void {
  if (!options.eslint) {
    const eslintPath = resolve(targetDir, 'eslint.config.mjs')
    if (existsSync(eslintPath)) unlinkSync(eslintPath)
    const pkgPath = resolve(targetDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    delete pkg.scripts.lint
    delete pkg.scripts['lint:fix']
    delete pkg.devDependencies.eslint
    delete pkg.devDependencies['eslint-config-prettier']
    delete pkg.devDependencies['typescript-eslint']
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }

  if (options.tailwind) {
    const pkgPath = resolve(targetDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    pkg.devDependencies = pkg.devDependencies || {}
    pkg.devDependencies['tailwindcss'] = '^4.0.0'
    pkg.devDependencies['@tailwindcss/vite'] = '^4.0.0'
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    writeFileSync(resolve(targetDir, 'app/globals.css'), '@import "tailwindcss";\n')
  }

  if (options.srcDir) {
    const srcDir = resolve(targetDir, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const dir of ['app', 'server']) {
      const from = resolve(targetDir, dir)
      const to = resolve(srcDir, dir)
      if (existsSync(from)) renameSync(from, to)
    }
    const appFrom = resolve(targetDir, 'app.ts')
    if (existsSync(appFrom)) renameSync(appFrom, resolve(srcDir, 'app.ts'))

    const tscPath = resolve(targetDir, 'tsconfig.json')
    const tsc = JSON.parse(readFileSync(tscPath, 'utf-8'))
    tsc.compilerOptions.baseUrl = 'src'
    tsc.compilerOptions.paths = { '@/*': ['./*'], '@/server/*': ['./server/*'], '@/app/*': ['./app/*'] }
    tsc.include = ['src/**/*.ts', 'src/**/*.tsx']
    writeFileSync(tscPath, JSON.stringify(tsc, null, 2) + '\n')

    const pkgPath = resolve(targetDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    pkg.scripts.dev = 'npx tsx --watch src/app.ts'
    pkg.scripts['dev:bun'] = 'bun --watch src/app.ts'
    pkg.scripts.build = 'npx tsup src/app.ts --format esm --out-dir dist'
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }

  if (!options.aliases) {
    const tscPath = resolve(targetDir, 'tsconfig.json')
    const tsc = JSON.parse(readFileSync(tscPath, 'utf-8'))
    delete tsc.compilerOptions.baseUrl
    delete tsc.compilerOptions.paths
    writeFileSync(tscPath, JSON.stringify(tsc, null, 2) + '\n')
  }

  if (!options.agentsMd) {
    const agentsPath = resolve(targetDir, 'AGENTS.md')
    if (existsSync(agentsPath)) unlinkSync(agentsPath)
  }
}

// Auto-execute
main().catch((err) => {
  console.error(err)
  process.exit(1)
})
