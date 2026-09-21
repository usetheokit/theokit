/**
 * Reading helpers for the B-228 bundle assertion, split out so the test file states properties and
 * this file states how they are measured.
 */
import { readdirSync } from 'node:fs'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'

/** Where a built scaffold's client assets may be read from. */
const ALLOWED_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')

/**
 * Every emitted client entry chunk. A glob rather than one name: the hash changes every build.
 *
 * The directory is validated before it is read. `security/detect-non-literal-fs-filename` is right
 * to flag a non-literal path into `readdirSync`, and the honest answer is a check rather than a
 * suppression: a caller passing `../../../etc` would otherwise have this helper read it.
 */
export function clientAssets(dir: string): string[] {
  const target = normalize(resolve(dir))
  // `+ sep` and not a bare prefix: `startsWith(ALLOWED_ROOT)` also accepts a SIBLING whose name
  // merely begins with the root's — `theokit-evil` passed, measured. That is the same defect class
  // this file's own subject carries at `config-hook.ts:80-85` (#377, a prefix-matching alias), and
  // introducing it in the guard written to answer a security lint would be worse than the warning.
  const inside = target === ALLOWED_ROOT || target.startsWith(ALLOWED_ROOT + sep)
  if (!isAbsolute(target) || !inside) {
    throw new Error(`refusing to read outside the repository: ${dir}`)
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- validated against ALLOWED_ROOT on the line above
  return readdirSync(target)
    .filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .map((f) => join(target, f))
}

/** Occurrences of a literal — `split` and not a regex, so no character in the needle is special. */
export function countLiteral(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}
