import { closeSync, constants, openSync, writeSync } from 'node:fs'

/**
 * Write a scaffolded file, refusing to follow a symlink at the final path component.
 *
 * ## Why this exists
 *
 * CodeQL flags every `writeFileSync` in this package under `js/insecure-temporary-file`, seven of
 * them at high severity. The finding is narrower than the rule's name suggests and it is real: the
 * scaffolder writes predictably-named files into `resolve(process.cwd(), projectName)`, and a person
 * who runs `npx create-theokit myapp` from inside a world-writable directory hands an attacker the
 * chance to pre-place a symlink at one of those names. The write then lands wherever the link points.
 *
 * `index.ts` already refuses a non-empty target directory, and a planted symlink counts as content —
 * so the attack needs the window between that check and the writes. This closes that window at the
 * only place it can be closed cheaply: the write itself.
 *
 * ## Why the flags rather than `wx`
 *
 * Exclusive create (`wx`) was the obvious answer and it is wrong here. Four of the flagged sites
 * OVERWRITE a file the scaffolder just produced — `bare-transform.ts` rewrites the `package.json` it
 * read, and materialising a `.tmpl` writes the destination then unlinks the source. `wx` fails when
 * the target exists, so it would not have closed the vector; it would have broken `--bare` and
 * `--surface` on their first run.
 *
 * `O_NOFOLLOW` keeps create-or-truncate semantics exactly and refuses only the case that matters.
 * Demonstrated rather than assumed: with these flags a write to a symlink fails `ELOOP` and the file
 * it pointed at is untouched; without them the same write replaces the target's contents.
 *
 * ## What it does not close
 *
 * `O_NOFOLLOW` applies to the FINAL component only — a symlinked parent directory is still followed.
 * Closing that needs `openat2` with `RESOLVE_NO_SYMLINKS`, which Node does not expose. Stated here so
 * the next reader knows the boundary rather than inferring a guarantee this does not give.
 */
const NO_FOLLOW = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW

/**
 * `writeFileSync` for scaffolded output. Same semantics, minus following a symlink.
 *
 * `openSync` rather than `writeFileSync`'s `flag` option, because that option is typed `string` and
 * these are numeric constants. A cast would compile and would hide the day somebody adds a flag the
 * string form cannot express.
 */
export function writeScaffoldFile(path: string, data: string): void {
  const fd = openSync(path, NO_FOLLOW)
  try {
    writeSync(fd, data)
  } finally {
    closeSync(fd)
  }
}
