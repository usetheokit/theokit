#!/usr/bin/env node
/**
 * The two places that pin `@theokit/sdk` must agree.
 *
 * #69 — `package.json` carried an npm-style `overrides` block pinning `^4.63.3` while the tree
 * actually resolved `5.0.0-next.1`. Under pnpm that block is INERT (pnpm reads
 * `pnpm-workspace.yaml`), so the number sat there being wrong and reading as a control that works.
 *
 * Three declarations now, all load-bearing:
 *
 *   - the root devDependency, because `tools/build-cli.mjs` copies `provider-catalog.json` out of
 *     the SDK, and pnpm is right not to hoist what nobody declared;
 *   - the `pnpm-workspace.yaml` override, because it decides what the WHOLE tree resolves to;
 *   - any `packages/*` manifest that declares it, because since #70 one of them imports the SDK
 *     directly — `readSessionMessages` is the read side of a resumed session and
 *     `@theokit/agents@12.1.0` does not forward it.
 *
 * They pin the same fact. Nothing makes them move together, so this does. The third one was added
 * the moment it became possible to drift, rather than after it had: a pin nobody checks is what #69
 * was, and adding a declaration without extending the guard would have re-created it deliberately.
 *
 * A CHECK THAT FAILS, not a corrected number — the acceptance criterion the issue names, because a
 * number someone fixes by hand drifts back the next time either file is edited.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

const PKG = 'package.json'
const WS = 'pnpm-workspace.yaml'
const NAME = '@theokit/sdk'

/**
 * What disagrees, or `undefined` when nothing does.
 *
 * Takes the file CONTENTS so the rule is testable without a filesystem — the guard that has no test
 * is the one that reports clean over anything.
 */
export function disagreement(pkgJson, workspaceYaml, workspaceManifests = []) {
  const pkg = JSON.parse(pkgJson)
  const declared = pkg.devDependencies?.[NAME] ?? pkg.dependencies?.[NAME]
  const npmOverride = pkg.overrides?.[NAME]
  // The captured value is UNQUOTED before comparing. YAML accepts `'5.0.0-next.1'` and
  // `5.0.0-next.1` as the same string, and comparing the raw capture to the JSON value reported a
  // disagreement between a version and itself — caught by running the guard rather than by reading
  // it, on the very commit that introduced it.
  // Comment lines are dropped BEFORE the scan. The regex takes the first match in the file, and a
  // comment recording why the override exists routinely names the package with a version — so prose
  // twenty lines above outranked the override itself. Measured in CI 2026-09-13: the gate compared
  // 5.6.0 against a string captured out of a sentence, trailing backtick included. Dropping comments
  // rather than tightening the pattern, because the defect is WHERE it looked, not what it matched.
  const yamlBody = workspaceYaml
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
  const raw = new RegExp(`'?${NAME.replace('/', '\\/')}'?:\\s*(\\S+)`).exec(yamlBody)?.[1]
  const wsOverride = raw?.replace(/^['"]|['"]$/g, '')

  // ANY npm `overrides` block, not only this package's.
  //
  // The rule is about the FILE, not the entry: this repository declares `packageManager: pnpm`, and
  // pnpm reads its overrides from pnpm-workspace.yaml. Every key in a `package.json` overrides block
  // is therefore inert here — #69 was one of them being inert AND wrong, but a redundant one is the
  // same defect with a luckier value: it reads as a control that works.
  const names = Object.keys(pkg.overrides ?? {})
  if (names.length > 0) {
    const shown = npmOverride === undefined ? names.join(', ') : `${NAME} (${npmOverride})`
    return (
      `${PKG} has an npm \`overrides\` block — ${shown}. pnpm does not read it, so it is inert; ` +
      `${WS} is the one that decides. Delete the block and pin there if the pin is wanted.`
    )
  }
  if (declared === undefined) return undefined
  if (wsOverride === undefined) {
    return `${PKG} declares ${NAME}@${declared} and ${WS} has no \`${NAME}\` override to hold the whole tree to it`
  }
  if (declared !== wsOverride) {
    return `${PKG} declares ${NAME}@${declared} while ${WS} overrides the tree to ${wsOverride} — the build would read a different copy than everything else`
  }

  // A workspace that does NOT name the SDK is silent, not wrong: three of the four packages reach it
  // only through `@theokit/agents`, and forcing them to declare a dependency they do not import would
  // be the redundant pin this guard exists to refuse.
  for (const { path, json } of workspaceManifests) {
    const manifest = JSON.parse(json)
    const pin = manifest.dependencies?.[NAME] ?? manifest.devDependencies?.[NAME]
    if (pin === undefined) continue
    if (pin !== wsOverride) {
      return `${path} declares ${NAME}@${pin} while ${WS} overrides the tree to ${wsOverride} — that package would typecheck against one copy and run against another`
    }
  }
  return undefined
}

/**
 * #120 — an EXACT pin must equal the copy the tree actually resolved.
 *
 * The three checks above reconcile DECLARATIONS with each other. All three can agree and all three
 * can be wrong about the tree, which is what happened:
 *
 *   package.json          @theokit/agents  13.0.0-next.3
 *   pnpm-workspace.yaml   @theokit/agents  13.0.0-next.3
 *   node_modules          @theokit/agents  13.0.0-next.2      ← what ran
 *
 * `pnpm install --force` printed a normal successful run and left the older copy in place: the
 * `minimumReleaseAge` supply-chain policy rejected the newer lockfile entry and the default path
 * swallowed the rejection. Only `--no-frozen-lockfile` surfaced it.
 *
 * It matters here because every upstream verification in this repository begins with *raise the
 * pin, then measure*. A pin that silently does not move makes the next measurement answer about
 * the wrong artifact, while the files and the operator both believe otherwise. It was caught by a
 * habit — `readlink -f` immediately after a bump — and a habit is not a gate.
 *
 * ## Only EXACT pins
 *
 * Three of the five `@theokit/*` declarations here are ranges (`^0.2.1`, `^0.8.0`, `^0.80.0`). A
 * range resolving above its floor is the range working, not drift, so equality would make this
 * guard noise — and a noisy guard is one people switch off. Only a pin that asserts identity is
 * held to identity.
 *
 * ## Absence is not agreement
 *
 * A package with no resolved copy is REPORTED, not skipped. Skipping it passes an equality check
 * over nothing and reads as "the pin is honoured", which is the direction this guard exists to
 * refuse.
 *
 * Filesystem-free, like `disagreement` above and for the same reason: the guard with no test is the
 * one that reports clean over anything.
 */
export function resolvedDisagreement(declarations, resolved) {
  for (const { path, name, version } of declarations) {
    // Detected POSITIVELY: an exact version is `1.2.3` with an optional prerelease or build suffix.
    // Everything else — `^0.80.0`, `~1.2`, `>=2`, `1.x`, `a || b` — describes a set, and a set
    // resolving above its floor is the range working rather than drift.
    //
    // The first cut tested for range CHARACTERS and included `x` as a wildcard. `13.0.0-next.3`
    // contains an `x`, in "next", so every prerelease pin was silently treated as a range and the
    // guard reported clean over exactly the case it was written for. Caught by its own arm.
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) continue

    const actual = resolved.get(name)
    if (actual === undefined) {
      return `${path} pins ${name}@${version} and the tree has no resolved copy — not installed, so nothing is holding the build to that pin`
    }
    if (actual !== version) {
      return (
        `${path} pins ${name}@${version} while the tree resolved ${actual}. ` +
        `An install can report success and leave the old copy in place — run ` +
        `\`pnpm install --no-frozen-lockfile\` and read the output, which names the reason.`
      )
    }
  }
  return undefined
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Read from disk here rather than inside `disagreement`, which stays filesystem-free so the rule
  // is testable — the guard with no test is the one that reports clean over anything.
  const manifests = readdirSync('packages', { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join('packages', e.name, 'package.json'))
    .filter((p) => existsSync(p))
    .map((p) => ({ path: p, json: readFileSync(p, 'utf8') }))
  const problem = disagreement(readFileSync(PKG, 'utf8'), readFileSync(WS, 'utf8'), manifests)
  if (problem !== undefined) {
    process.stderr.write(`${problem}\n`)
    process.exit(1)
  }

  // #120 — and now the tree itself, which every check above can agree about and be wrong about.
  const declarations = [{ path: PKG, json: readFileSync(PKG, 'utf8') }, ...manifests].flatMap(
    ({ path, json }) => {
      const j = JSON.parse(json)
      const deps = { ...j.dependencies, ...j.devDependencies }
      return Object.entries(deps)
        .filter(([name]) => name.startsWith('@theokit/'))
        .map(([name, version]) => ({ path, name, version }))
    },
  )
  // `realpathSync`, not the symlink: two trees under one package name is how a version was once
  // reported absent from a copy nobody was reading. The path is resolved BEFORE the version is read.
  const resolved = new Map(
    [...new Set(declarations.map((d) => d.name))].flatMap((name) => {
      for (const base of ['node_modules', ...manifests.map((m) => m.path.replace(/package\.json$/, 'node_modules'))]) {
        const link = join(base, name)
        if (!existsSync(link)) continue
        const real = realpathSync(link)
        return [[name, JSON.parse(readFileSync(join(real, 'package.json'), 'utf8')).version]]
      }
      return []
    }),
  )
  const drift = resolvedDisagreement(declarations, resolved)
  if (drift !== undefined) {
    process.stderr.write(`${drift}\n`)
    process.exit(1)
  }
  if (!process.argv.includes('--quiet')) {
    // Counted, not assumed: `manifests.length` would report every package scanned, including the
    // three that correctly say nothing about the SDK — a number that grows when a package is added
    // and means less each time.
    const naming = manifests.filter((m) => {
      const j = JSON.parse(m.json)
      return (j.dependencies?.[NAME] ?? j.devDependencies?.[NAME]) !== undefined
    })
    const where = [PKG, WS, ...naming.map((m) => m.path)].join(', ')
    process.stdout.write(`${NAME}: one pin, agreed in ${where}\n`)
  }
}
