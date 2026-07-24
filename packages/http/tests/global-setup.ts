import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * Build `dist/` ONCE for the whole run.
 *
 * `dist-build-validation` used to rebuild inside its own `beforeAll` while `bundle-size` read the
 * same directory from another worker — so the two raced and either could fail depending on timing.
 * A flaky test is a bug (rules/testing.md § 3), and the cause here was duplicated work, not the
 * assertions. Building once removes the race and the duplication.
 */
export default function setup(): void {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- the suite validates real build output
  execSync('npx tsup', { cwd: resolve(import.meta.dirname, '..'), stdio: 'pipe' })
}
