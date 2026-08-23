import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A temporary directory that looks like a real theokit project (usetheokit/theokit#418).
 *
 * ## Why the `package.json` is load-bearing
 *
 * Framework code imports user-authored `.ts` at runtime — `theo.config.ts`, `server/jobs/*.ts`,
 * `server/context.ts` — through `config/import-user-module.ts`, which falls back to tsx's
 * `tsImport()` when Node cannot load a `.ts` natively.
 *
 * tsx decides CJS-vs-ESM from the NEAREST `package.json`. A fixture without one is compiled as
 * CommonJS, so the output references `__filename`, and evaluating that as ESM throws
 * `__filename is not defined in ES module scope`.
 *
 * Above Node 22.18 none of this happens: native type stripping loads the `.ts` directly and the
 * fallback never runs. So a fixture missing this file passes on a developer's machine and fails on
 * the version `engines.node` DECLARES — which is how `>=22.12.0` came to be a promise nobody had
 * executed.
 *
 * Every real theokit project has it: `create-theokit`'s template declares `"type": "module"`. A
 * fixture without it is not a smaller project, it is a DIFFERENT one, and testing against it tests
 * a shape the framework does not ship.
 */
export function makeFixtureProject(prefix: string): string {
  return markEsmProject(mkdtempSync(join(tmpdir(), prefix)))
}

/**
 * Mark an EXISTING directory as an ESM project, for a fixture built with `mkdirSync`.
 *
 * The nearest-`package.json` lookup walks UP, so marking the root of a fixture tree covers every
 * directory beneath it — one file rather than one per case.
 *
 * @returns the directory, so it composes into an assignment.
 */
export function markEsmProject(dir: string): string {
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }')
  return dir
}
