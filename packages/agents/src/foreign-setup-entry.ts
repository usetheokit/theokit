/**
 * `@theokit/agents/foreign-setup` — read a Claude Code or Hermes setup as data, and store it for the next start. A subpath, not the root:
 * it carries filesystem and YAML code most apps never need.
 */
export { readForeignSetup } from './foreign-setup/index.js'
export {
  ForeignImportError,
  plannedForeignImportFiles,
  readForeignImport,
  writeForeignImport,
} from './foreign-setup/store.js'
export type {
  ForeignImportCounts,
  ForeignImportErrorReason,
  ForeignImportMcpServers,
  StoredForeignImport,
} from './foreign-setup/store.js'
export type {
  ForeignHook,
  ForeignMcpServer,
  ForeignSetup,
  ForeignSetupKind,
  ForeignSkill,
  ForeignTextFile,
  ReadForeignSetupOptions,
  UntranslatedEntry,
} from './foreign-setup/types.js'
