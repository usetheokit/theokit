/** SQLite's online backup API first shipped in Node 22.16 and 23.8. No side effects: the root vitest config imports this. */
export function isSupportedRuntime(version = process.versions.node): boolean {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  return (
    Number.isInteger(major) &&
    Number.isInteger(minor) &&
    Number.isInteger(patch) &&
    ((major === 22 && minor >= 16) || (major === 23 && minor >= 8) || major >= 24)
  )
}
