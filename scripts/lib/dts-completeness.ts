/**
 * Is a built `dist` usable by a SIBLING package, or does it carry JavaScript with none of the types
 * it promises?
 *
 * ## The measurement (2026-09-24)
 *
 * `packages/theo/tsup.config.ts` builds with `clean: true`, so the previous `.d.ts` files are
 * removed before the DTS worker writes the new ones — and that worker is the expensive step: 73,193
 * ms and a large heap for `packages/theo`. A clean `pnpm build:packages` taken by SIGTERM (exit 143;
 * the log goes from `DTS Build start` straight to `Terminated`) leaves `packages/theo/dist` with 201
 * `.js` files and 0 `.d.ts`.
 *
 * A KILL is not the only way to reach that shape, measured the same day and it corrected this
 * file. A real `pnpm --filter theokit build` here exited **1** with `DTS Build error` and
 * `TS2307: Cannot find module '@theokit/agents/config'` — that workspace dependency was not built
 * yet — and left **201 `.js` and 0 `.d.ts`**, byte for byte what the kill leaves. So the artifact
 * does not record why, and {@link describeDtsFinding} names every cause and points at the exit code
 * instead of asserting one. A guard that picked one would misattribute, which is this item's own
 * defect pointed the other way.
 *
 * A THIRD cause corrected it again on 2026-09-24, and it is the one the first two hid between them:
 * the DTS runs in a worker THREAD, so a thread that exhausts its heap is reported to the parent as
 * `ERR_WORKER_OUT_OF_MEMORY` and tsup exits **1**. A memory event therefore wears the FAILURE exit
 * code, and the table above mapped exit 1 onto "read the `error TS…`" — sending the reader after a
 * defect that does not exist. Reproduced without signalling anything, by capping the heap of a real
 * build (`NODE_OPTIONS=--max-old-space-size=256` on `packages/http`, whose DTS step is 59.8s against
 * 2.0s for its ESM). Counted in that log: `ERR_WORKER_OUT_OF_MEMORY` 2, `DTS Build start` 1, and
 * `DTS Build error` 0, `error TS` 0, `Terminated` 0 — it matches the KILLED row in every observable
 * respect and carries the FAILED row's exit code. The discriminator inside exit 1 is whether a TS
 * error was PRINTED.
 *
 * That run is also what measured the window: it took `packages/http/dist` from 10 `.d.ts` to 0. The
 * wipe is tsup's own `tsup:clean` rollup plugin, which removes every declaration file under the
 * outDir in rollup's `buildStart` hook
 * — so the destructive window is the whole DTS build. At `--max-old-space-size=128` the worker died
 * BEFORE that hook and all 10 `.d.ts` survived, which is why a build that does not finish only
 * sometimes poisons the tree.
 *
 * Nothing named that state, and the next reader was told the wrong thing. Measured against a
 * deliberately poisoned dist in this repository:
 *
 *     tsc --noEmit -p packages/tauri/tsconfig.json   → exit 2
 *     src/sidecar.ts(7,8): error TS7016: Could not find a declaration file for module
 *                          'theokit/server/agent'
 *
 * The error is LOCATED at the consumer's source, which did not change. `packages/tauri/tsconfig.json`
 * declares no `paths`, so it resolves `theokit` through the workspace symlink
 * (`packages/tauri/node_modules/theokit → ../../theo`) and honours the `exports` of `packages/theo`,
 * every entry of which points into `dist`.
 *
 * The root typecheck is IMMUNE and that is why this survives: the root `tsconfig.json` maps
 * `theokit/*` onto `packages/theo/src`, measured at TS7016 = 0. So `pnpm typecheck:only` — the
 * pre-push typecheck stage — never surfaces it, and `dist` is gitignored, so the poisoned tree sits
 * there silently until a per-package read meets it.
 *
 * The misattribution already cost a wrong diagnosis: B-290 was filed against build ORDERING on the
 * strength of this symptom, and the ordering was measured to be correct — `theo` waits 73s for its
 * own DTS worker before `tauri` starts.
 *
 * ## Why the DECLARED surface, and not "does the dist contain any .d.ts"
 *
 * Measured the same day: `packages/create-theokit/dist` holds 1 `.js` and 0 `.d.ts`, and that is
 * correct — it has no `types` field and no `types` condition in `exports`; it is a pure `bin`. A
 * guard asking "JS but no `.d.ts`" reports it on every run forever, and a gate that is wrong every
 * time is a gate somebody switches off. So the contract each package states about ITSELF is the
 * standard it is held to.
 *
 * ## Why not `publint`, which already checks file existence
 *
 * It is installed here and wired as `pnpm validate:publint`, and against the poisoned dist it does
 * fire — 3.7s, naming the package and every missing entry. It is deliberately NOT the mechanism for
 * this, for two measured reasons.
 *
 * It answers a different question. publint runs `pnpm pack` and audits the PUBLISHABLE tarball,
 * which honours `files`; the failure here is on the local workspace-symlink path, where a sibling
 * reads `dist` directly and no tarball exists. The two surfaces are not the same, and the pack costs
 * one per package.
 *
 * And it cannot express the fact that matters. Measured on the poisoned dist, publint reported 28
 * missing `.types` entries and 25 missing `.import` entries as one flat list — so it cannot say *the
 * JavaScript is all there and only the types are gone*, which is the shape that identifies an
 * unfinished DTS worker rather than a broken source tree. Zero lines of its output mention a kill.
 * That distinction is the whole reason this file exists, so what is added here is the discrimination,
 * not a second copy of an existence check.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** Extensions tsup can emit as the runtime half of an entry point. */
const JS_EXTENSIONS = ['.js', '.mjs', '.cjs'] as const

interface DtsFindingShape {
  /** The package's own `name`, so the report names the package rather than a directory. */
  readonly pkg: string
  /** Where it lives, relative to the repository root when it is under one. */
  readonly dir: string
}

export type DtsFinding =
  /** Every type entry the package declares is on disk. */
  | (DtsFindingShape & { readonly kind: 'complete'; readonly declared: number })
  /**
   * The package declares no types at all. `create-theokit` is this, on purpose — reporting it would
   * make the guard wrong on every run.
   */
  | (DtsFindingShape & { readonly kind: 'types-not-declared' })
  /**
   * Nothing was emitted, so there is no incomplete artifact to judge. Distinct from the finding
   * below: a tree nobody has built yet is not a tree whose build died.
   */
  | (DtsFindingShape & { readonly kind: 'not-built' })
  /** JavaScript was emitted and at least one declared type entry is absent. */
  | (DtsFindingShape & {
      readonly kind: 'types-missing'
      readonly declared: number
      readonly missing: readonly string[]
      readonly jsFiles: number
    })

/**
 * Every path the manifest promises a type declaration at: the top-level `types`, plus every `types`
 * condition anywhere in `exports`.
 *
 * `Object.hasOwn` rather than `in`, so a key like `constructor` cannot resolve through the prototype
 * — the manifest is JSON somebody else wrote, and this walks it untyped.
 */
export const declaredTypeEntries = (manifest: unknown): readonly string[] => {
  const found: string[] = []

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const record = node as Record<string, unknown>
    if (Object.hasOwn(record, 'types') && typeof record.types === 'string') {
      found.push(record.types)
    }
    for (const key of Object.keys(record)) {
      if (key !== 'types') walk(record[key])
    }
  }

  if (typeof manifest === 'object' && manifest !== null) {
    const record = manifest as Record<string, unknown>
    if (Object.hasOwn(record, 'types') && typeof record.types === 'string') {
      found.push(record.types)
    }
    if (Object.hasOwn(record, 'exports')) walk(record.exports)
  }

  return [...new Set(found)]
}

/** Recursive count of emitted JavaScript under `dir`; 0 when the directory is absent. */
const countJsFiles = (dir: string): number => {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += countJsFiles(full)
      continue
    }
    if (JS_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) total += 1
  }
  return total
}

/**
 * Hold one package to the type surface it declares about itself.
 *
 * `repoRoot` only shortens the reported directory; the audit itself is entirely local to
 * `packageDir`, so this works on a fixture as well as on a workspace package.
 */
export const auditPackageDts = (packageDir: string, repoRoot?: string): DtsFinding => {
  const manifestPath = join(packageDir, 'package.json')
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const name =
    typeof manifest === 'object' &&
    manifest !== null &&
    typeof (manifest as { name?: unknown }).name === 'string'
      ? (manifest as { name: string }).name
      : packageDir
  const dir = repoRoot === undefined ? packageDir : relative(repoRoot, packageDir)
  const shape: DtsFindingShape = { pkg: name, dir }

  const declared = declaredTypeEntries(manifest)
  if (declared.length === 0) return { ...shape, kind: 'types-not-declared' }

  const jsFiles = countJsFiles(join(packageDir, 'dist'))
  if (jsFiles === 0) return { ...shape, kind: 'not-built' }

  const missing = declared.filter((entry) => !existsSync(resolve(packageDir, entry)))
  if (missing.length === 0) return { ...shape, kind: 'complete', declared: declared.length }

  return { ...shape, kind: 'types-missing', declared: declared.length, missing, jsFiles }
}

/** Every package under `packages/` that has a manifest, audited in directory order. */
export const auditWorkspaceDts = (repoRoot: string): readonly DtsFinding[] => {
  const packagesDir = join(repoRoot, 'packages')
  if (!existsSync(packagesDir)) return []

  const findings: DtsFinding[] = []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const dir = join(packagesDir, entry.name)
    if (!entry.isDirectory() && !(entry.isSymbolicLink() && statSync(dir).isDirectory())) continue
    if (!existsSync(join(dir, 'package.json'))) continue
    findings.push(auditPackageDts(dir, repoRoot))
  }
  return findings
}

/**
 * What a human is told when a dist carries JavaScript and not its types.
 *
 * The message's job is to move the reader's attention to the package whose build did not finish, and
 * away from the consumer whose source `tsc` is about to blame. It therefore names both facts that
 * the measurement showed a reader cannot otherwise separate: the emitted/declared counts, and that
 * this shape is an unfinished build rather than a defect.
 */
export const describeDtsFinding = (finding: DtsFinding): string => {
  if (finding.kind !== 'types-missing') {
    return `${finding.pkg} (${finding.dir}): ${finding.kind}`
  }

  const { pkg, dir, declared, missing, jsFiles } = finding
  const shown = missing.slice(0, 5)
  const rest = missing.length - shown.length

  return [
    `✗ ${pkg} (${dir}) emitted JavaScript without the types it declares.`,
    ``,
    `  ${String(jsFiles)} JavaScript file(s) present, and ${String(missing.length)} of ${String(declared)} declared type entr(ies) absent:`,
    ...shown.map((entry) => `    - ${entry}`),
    ...(rest > 0 ? [`    … and ${String(rest)} more`] : []),
    ``,
    `  This cannot tell you WHY, because THREE different things leave this exact shape and the`,
    `  artifact does not record which — read the build's EXIT CODE and output to tell them apart.`,
    `  Only the last of them implicates any code:`,
    ``,
    `    the DTS worker was KILLED    exit 143 (SIGTERM) or 137 (SIGKILL), no error printed, the log`,
    `                                 stopping at \`DTS Build start\`. This repository's DTS worker holds`,
    `                                 a large heap, so a machine short on memory reaches this`,
    `                                 routinely. No source is implicated at all.`,
    `    it RAN OUT OF MEMORY         exit 1 with \`ERR_WORKER_OUT_OF_MEMORY\` and no \`error TS\``,
    `                                 anywhere. The DTS runs in a worker THREAD, and a thread that`,
    `                                 exhausts its heap is reported to the parent as an error rather`,
    `                                 than as a signal — so a memory event wears the failure exit`,
    `                                 code. Measured 2026-09-24 by capping a real build's heap: the`,
    `                                 log stops at \`DTS Build start\` exactly as a kill does. No`,
    `                                 source is implicated here either.`,
    `    the DTS worker FAILED        exit 1 with \`DTS Build error\` and an \`error TS….\` PRINTED above`,
    `                                 it — that printed error is what separates this from the row`,
    `                                 above. Measured 2026-09-24: a workspace dependency that is not`,
    `                                 built yet does this — \`@theokit/agents\` absent gave TS2307 and`,
    `                                 left 201 \`.js\` with 0 \`.d.ts\`, byte for byte what the kill`,
    `                                 leaves.`,
    ``,
    `  Either way \`clean: true\` had already removed the previous types, so what is on disk now is`,
    `  unusable. What is NOT implicated is the source of whichever package IMPORTS ${pkg}: left in`,
    `  place, the next per-package typecheck reports TS7016 against a CONSUMER file that did not`,
    `  change, and the investigation starts in the wrong package.`,
    ``,
    `  Rebuild it:  pnpm --filter ${pkg} build`,
  ].join('\n')
}
