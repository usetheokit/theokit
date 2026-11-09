import { isSupportedRuntime } from './runtime-support.js'

/** SQLite's online backup API first shipped in Node 22.16 and 23.8. */
export function assertSupportedRuntime(version = process.versions.node): void {
  if (!isSupportedRuntime(version)) {
    throw new Error(`TheoClaw requires Node 22.16.0 or later in Node 22, or Node 23.8.0 or later (found ${version}); SQLite backups require node:sqlite's backup API`)
  }
}

assertSupportedRuntime()
