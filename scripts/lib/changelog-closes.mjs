/**
 * Does a change that closes a registered consumer gap SAY SO where the consumer will read it?
 *
 * The consumer's register lists 8 gaps as open; verified, none is fully open. Five closures reached
 * them by accident — same maintainer on both sides. A customer without that overlap keeps reading
 * "open" against capabilities that ship, and keeps rebuilding them. The absence of a channel is the
 * defect, and it is why the same measurement keeps finding the same waste.
 *
 * The channel is one line: touch a file a registered gap points at, and name the gap in
 * `[Unreleased]`. Deliberately not a notification system — it makes the closure DISCOVERABLE in the
 * artifact the consumer already reads. It does not push.
 */

/**
 * @typedef {{ id: string, files: string[], summary: string }} GapEntry
 * @typedef {{ id: string, summary: string, files: string[] }} MissingClose
 */

/** Everything above the first released heading. Released entries are never edited (Rule 6). */
function unreleasedSection(changelog) {
  const start = changelog.indexOf('## [Unreleased]')
  if (start === -1) return ''
  const rest = changelog.slice(start + '## [Unreleased]'.length)
  const nextHeading = rest.search(/^## \[/m)
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading)
}

/**
 * Registered gaps whose files this change touches and whose id `[Unreleased]` does not name.
 *
 * @param {{ changedFiles: string[], changelog: string, registry: GapEntry[] }} input
 * @returns {MissingClose[]}
 */
export function missingCloses(input) {
  const section = unreleasedSection(input.changelog)
  // An absent `[Unreleased]` means a repo mid-release, which has just emptied it. Firing then would
  // fire on every release cut, and a check that fires on every release cut gets disabled (EC-19).
  if (section.trim() === '') return []

  /** @type {MissingClose[]} */
  const missing = []
  for (const gap of input.registry) {
    const touched = input.changedFiles.filter((file) =>
      // A trailing slash means an AREA: some gaps are about a directory, not a file, and enumerating
      // a moving target in the registry is how a registry goes stale.
      gap.files.some((target) =>
        target.endsWith('/') ? file.startsWith(target) : file === target,
      ),
    )
    if (touched.length === 0) continue
    // Whole-token match: a bare `includes('U-1')` is satisfied by a `U-10` in the text, which is the
    // wrong tool for an id with a numeric tail.
    const named = new RegExp(`\\b${gap.id}\\b`).test(section)
    if (named) continue
    missing.push({ id: gap.id, summary: gap.summary, files: touched })
  }
  return missing
}
