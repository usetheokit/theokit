// B-386 — the QuickJS-WASM `Sandbox` for `createCodeMode`. The only entry that imports the VM:
// its two packages are optional peers, installed and loaded only by an app that imports this one.
export {
  CodeModeSandboxError,
  createQuickJsSandbox,
  type CodeModeSandboxErrorCode,
  type QuickJsSandboxOptions,
} from './code-mode/quickjs-sandbox.js'
