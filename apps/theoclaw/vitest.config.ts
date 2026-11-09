import { configDefaults, defineConfig } from 'vitest/config'

/** Vitest matches excludes relative to each project's root, even for a root-level run. */
export function projectRelativeExcludes(argv: readonly string[]): string[] {
  const prefix = 'apps/theoclaw/'
  return argv.flatMap((argument, index) => {
    const pattern = argument === '--exclude' ? argv[index + 1] : undefined
    return pattern?.startsWith(prefix) ? [pattern.slice(prefix.length)] : []
  })
}

export default defineConfig({
  test: {
    // Related runs also start real TUI and control-client subprocesses with short deadlines.
    // Bound concurrency so those subprocesses get CPU time while sibling tests load the SDK.
    maxWorkers: 2,
    // Its own group: vitest refuses two projects with different maxWorkers in the same group, and the root
    // config's cap follows the runner's CPU count (8 on a 12-core machine).
    sequence: { groupOrder: 1 },
    // Named, so `--project theoclaw` selects it and the root runner reports it by name. A sibling's
    // config carries the same note and the reason it gives is measured: copying one without the
    // name produced a project that was in the list and matched no filter.
    name: 'theoclaw',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'tools/**/*.test.mjs'],
    // Preserve explicit factory exclusions when it supplies repository-relative paths.
    exclude: [...configDefaults.exclude, ...projectRelativeExcludes(process.argv)],
    environment: 'node',
    // Read only by a `--coverage` run, so the plain suite is unchanged. The control plane is the
    // code B-372 adds, and its plan bounds it at 90% on all three counters.
    coverage: {
      provider: 'v8',
      include: ['src/control-plane/**', 'src/webchat/**', 'src/control-client/**'],
      thresholds: { lines: 90, branches: 90, functions: 90 },
    },
  },
})
