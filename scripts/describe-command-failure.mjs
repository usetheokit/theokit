/**
 * Helpers for release gates that shell out (`check-pack-entry-points-load.mjs`), so a failed
 * command says WHY it failed.
 *
 * `execFileSync` throws an error whose `message` starts with `Command failed: ` and the whole argv.
 * For `npm install` of several tarballs the argv alone runs past any fixed cut, and the gate that
 * printed the first 110 characters of `message` showed the paths and none of npm's error (release
 * run 38473703093). The child's own output is in `err.stderr`, and that is what a reader needs.
 */

/**
 * Describe a failed `execFileSync` call: its exit code or signal, then every line of the child's
 * stderr. With no stderr captured (a spawn error, a timeout) it falls back to the whole message.
 * @param {unknown} err
 * @returns {string}
 */
export function describeCommandFailure(err) {
  const e =
    /** @type {{ stderr?: unknown, status?: unknown, signal?: unknown, message?: unknown }} */ (
      err ?? {}
    )
  const stderr = e.stderr === undefined || e.stderr === null ? '' : String(e.stderr).trim()
  let head = 'no exit code'
  if (typeof e.status === 'number') head = `exit code ${String(e.status)}`
  else if (typeof e.signal === 'string') head = `killed by ${e.signal}`
  const body = stderr === '' ? String(e.message ?? err).trim() : stderr
  return `${head}\n${body}`
}

/**
 * Run `attempt`, and run it once more if it throws. A failure that the retry clears is written to
 * `log` in full, so a transient registry error stays on the record without failing the gate. A
 * failure that repeats is thrown as one error carrying both descriptions.
 * @template T
 * @param {() => T} attempt
 * @param {(line: string) => void} log
 * @returns {T}
 */
export function runWithOneRetry(attempt, log) {
  let first
  try {
    return attempt()
  } catch (err) {
    first = describeCommandFailure(err)
  }
  try {
    const result = attempt()
    log(`retry succeeded; the first attempt failed with:\n${indent(first)}`)
    return result
  } catch (err) {
    throw new Error(
      `failed twice.\nfirst attempt: ${indent(first)}\nsecond attempt: ${indent(describeCommandFailure(err))}`,
      { cause: err },
    )
  }
}

/** @param {string} text */
function indent(text) {
  return text.replaceAll('\n', '\n      ')
}

/**
 * The `npm install` specs for the peers a consumer owes a package, so the probe does not accuse it
 * of what the consumer must supply.
 *
 * Third-party peers install at their declared floor (`>=18` -> `18`). A required `@theokit/*` peer
 * that this run does not pack (`@theokit/sdk`) installs at its declared range: left to npm it
 * resolves to whatever an OPTIONAL peer's range drags in (`@theokit/host` -> `@theokit/gateway`
 * -> sdk 9.x), which conflicts with the host's own `>=12 <14` and fails the install with ERESOLVE.
 * Optional `@theokit/*` peers and packed siblings are not installed here; see `specForMissing`.
 * @param {{ peerDependencies?: Record<string, string>, peerDependenciesMeta?: Record<string, { optional?: boolean }> }} manifest
 * @param {ReadonlySet<string>} siblings names packed by this run
 * @returns {string[]}
 */
export function peerSpecs(manifest, siblings) {
  return Object.entries(manifest.peerDependencies ?? {}).flatMap(([n, r]) => {
    if (!n.startsWith('@theokit/')) return [`${n}@${String(r).replace(/^>=/, '')}`]
    if (siblings.has(n) || manifest.peerDependenciesMeta?.[n]?.optional === true) return []
    return [`${n}@${String(r)}`]
  })
}

/**
 * The package an import failed to find, from node's stderr (`Cannot find package 'x' imported
 * from ...`), or undefined for any other failure.
 * @param {string} stderr
 * @returns {string | undefined}
 */
export function missingPackage(stderr) {
  return /Cannot find package '([^']+)'/.exec(stderr)?.[1]
}

/**
 * What to install so an entry that imports `name` can load, or undefined when `name` is nobody's to
 * supply: an OPTIONAL peer the package declares (`@theokit/host/channel-assistant` imports
 * `@theokit/gateway`) at its declared range, or a package this run packs (a peer of that peer,
 * `@theokit/presenter`) from its tarball. Anything else is a real undeclared dependency.
 * @param {string} name
 * @param {{ peerDependencies?: Record<string, string>, peerDependenciesMeta?: Record<string, { optional?: boolean }> }} manifest
 * @param {ReadonlyMap<string, string>} tarballs packed siblings by name
 * @returns {string | undefined}
 */
export function specForMissing(name, manifest, tarballs) {
  if (manifest.peerDependenciesMeta?.[name]?.optional === true) {
    return `${name}@${manifest.peerDependencies?.[name] ?? ''}`
  }
  return tarballs.get(name)
}
