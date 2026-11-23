/**
 * `@theokit/agents/foreign-setup` — read a Claude Code or Hermes setup as data. A subpath, not the root:
 * it carries filesystem and YAML code most apps never need.
 */
export { readForeignSetup } from './foreign-setup/index.js'
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
