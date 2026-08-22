import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * usetheokit/theokit#397 — `create-theokit … --use-pnpm` ended with
 *
 *     ✗ Failed to install dependencies with pnpm
 *
 * on a run where the install had succeeded. The first command in the product's
 * own quickstart reported failure.
 *
 * pnpm 10 stopped reading the `pnpm` field in `package.json` and says so in the
 * first line of the run:
 *
 *     [WARN] The "pnpm" field in package.json is no longer read by pnpm.
 *            The following keys were ignored: "pnpm.onlyBuiltDependencies".
 *
 * The template declared its build-script allow-list there, so the list was
 * dropped, `esbuild` and `node-pty` were refused, `ERR_PNPM_IGNORED_BUILDS` set a
 * non-zero exit, and the scaffolder turned that into "Failed to install".
 *
 * The state left behind was worse than the message: pnpm wrote a
 * `pnpm-workspace.yaml` whose values are the sentence "set this to true or
 * false", which is a placeholder where a boolean belongs.
 *
 * So the allow-list moves to where pnpm 10 reads it, and leaves the place pnpm 10
 * ignores — otherwise every install prints the warning even once the builds work.
 */

const TEMPLATE = resolve(import.meta.dirname, '../../packages/create-theokit/templates/default')

/** Packages the default scaffold's tree genuinely needs build scripts for (#397's run). */
const NEEDS_A_BUILD = ['esbuild', 'node-pty']

describe('the scaffold declares build approvals where pnpm reads them (#397)', () => {
  it('test_the_workspace_file_exists', () => {
    expect(
      existsSync(resolve(TEMPLATE, 'pnpm-workspace.yaml')),
      'pnpm 10 reads build approvals from pnpm-workspace.yaml, and the scaffold ships none',
    ).toBe(true)
  })

  it.each(NEEDS_A_BUILD)('approves %s, which the install refuses without it', (pkg) => {
    const yaml = readFileSync(resolve(TEMPLATE, 'pnpm-workspace.yaml'), 'utf-8')
    // A boolean, not the placeholder sentence pnpm writes when it asks.
    expect(yaml).toMatch(new RegExp(`^\\s*${pkg}:\\s*true\\s*$`, 'mu'))
  })

  it('test_no_placeholder_survives_in_the_shipped_file', () => {
    // pnpm's own generated file carries "set this to true or false" as the value.
    // Shipping that would hand every new project a YAML file that reads like a
    // question nobody answered.
    const yaml = readFileSync(resolve(TEMPLATE, 'pnpm-workspace.yaml'), 'utf-8')
    expect(yaml).not.toContain('set this to true or false')
  })

  it('test_the_manifest_no_longer_declares_it_where_pnpm_ignores_it', () => {
    // Leaving it costs a WARN on every single install, for a setting that has no
    // effect — noise that trains people to skip the first line of the output.
    const manifest = readFileSync(resolve(TEMPLATE, 'package.json.tmpl'), 'utf-8')
    expect(manifest).not.toContain('onlyBuiltDependencies')
  })

  it('test_the_manifest_is_still_valid_json_after_the_removal', () => {
    // The field was the last key in the object; removing it is exactly where a
    // trailing comma gets left behind.
    const raw = readFileSync(resolve(TEMPLATE, 'package.json.tmpl'), 'utf-8')
    expect(() => JSON.parse(raw.replace(/\{\{[^}]+\}\}/gu, 'x')) as unknown).not.toThrow()
  })
})
