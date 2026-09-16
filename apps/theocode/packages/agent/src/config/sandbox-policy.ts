import type { ApprovalPolicy, SandboxMode } from './config.js'

export interface WritePolicy {
  writes: boolean
  allowAbsolute: boolean
}

export function sandboxWritePolicy(mode: SandboxMode): WritePolicy {
  switch (mode) {
    case 'read-only':
      return { writes: false, allowAbsolute: false }
    case 'workspace-write':
      return { writes: true, allowAbsolute: false }
    case 'danger-full-access':
      return { writes: true, allowAbsolute: true }
  }
}

export function approvalModeFor(policy: ApprovalPolicy): 'suggest' | 'auto-edit' | 'full-auto' {
  switch (policy) {
    case 'untrusted':
    case 'on-request':
      return 'suggest'
    case 'never':
      return 'full-auto'
  }
}
