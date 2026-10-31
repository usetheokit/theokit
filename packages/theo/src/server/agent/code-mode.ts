/**
 * M29 (ADR-0041) — `createCodeMode` and its types. A pass-through, not a copy (B-386): the module
 * lives in `@theokit/agents/code-mode`, where an app that depends on `@theokit/agents` alone reaches
 * it, and every name `theokit/server/agent` exported is still exported from here.
 *
 * The isolation boundary stays injected; `node:vm` is NOT a security boundary. The vetted
 * QuickJS-WASM sandbox is `@theokit/agents/code-mode-quickjs`.
 */
export {
  CodeModePermissionDeniedError,
  createCodeMode,
  type CodeModeApi,
  type CodeModeConfig,
  type CodeModePermission,
  type Sandbox,
} from '@theokit/agents/code-mode'
