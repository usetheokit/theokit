import { sandboxWritePolicy } from '@theokit/agents/tool-scope'
import { createSandboxBackend } from '@theokit/agents/sandbox'
import type { AgentConfig } from '../config/index.js'
import type { ToolScope } from './registry.js'

export function resolveToolScope(cfg: Pick<AgentConfig, 'sandbox_mode'>, cwd: string): ToolScope {
  return {
    cwd,
    writeRoot: sandboxWritePolicy(cfg.sandbox_mode, cwd).allowAbsolute ? '/' : cwd,
    sandbox: createSandboxBackend({ mode: cfg.sandbox_mode, workDir: cwd }),
  }
}
