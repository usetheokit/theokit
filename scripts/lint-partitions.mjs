// The full-repository lint, split so no single eslint process holds the whole type-aware program.
//
// One `eslint .` reached 3.4–3.8 GiB resident (2026-10-06, killed by earlyoom, exit 143, reported by
// run_validation as lint failures with no findings). Each partition below is its own process, run one
// after another, so the peak is that of the largest partition. Nothing is dropped from what is
// checked: the last partition is `.` minus every path named above it, so a directory added later
// still gets linted, and `eslint.config.js` (rules and ignores) is untouched.

/** Path groups linted in their own process. Order is irrelevant; each must be a literal glob/dir. */
export const PARTITIONS = [
  ['packages/agents'],
  ['packages/theo'],
  ['tests'],
  ['packages/http', 'packages/presenter', 'packages/create-theokit', 'packages/tauri', 'packages/agents-pty'],
]

/** The eslint argument lists to run, in order. The last one is the remainder of the repository. */
export function lintInvocations(partitions = PARTITIONS) {
  const flat = partitions.flat()
  const rest = ['.', ...flat.flatMap((p) => ['--ignore-pattern', `${p}/**`])]
  return [...partitions.map((paths) => [...paths]), rest]
}

/** Heap ceiling per process, MiB. Keeps V8 collecting instead of growing toward the old 8 GiB cap. */
export const MAX_OLD_SPACE_MB = 1536
