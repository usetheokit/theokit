// B-386 — `createCodeMode` on its own subpath: the permission-gated restricted API an agent's
// script calls, over an injected `Sandbox`. The VM lives on `./code-mode-quickjs`, so importing
// this subpath loads no WASM.
export {
  CodeModePermissionDeniedError,
  createCodeMode,
  type CodeModeApi,
  type CodeModeConfig,
  type CodeModePermission,
  type Sandbox,
} from './code-mode/code-mode.js'
