/** SQLite's online backup API first shipped in Node 22.16 and 23.8. */
export function assertSupportedRuntime(version = process.versions.node): void {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch) ||
      !((major === 22 && minor >= 16) || (major === 23 && minor >= 8) || major >= 24)) {
    throw new Error(`TheoClaw requires Node 22.16.0 or later in Node 22, or Node 23.8.0 or later (found ${version}); SQLite backups require node:sqlite's backup API`)
  }
}

assertSupportedRuntime()
