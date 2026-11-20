import type { ApprovalPolicy } from './config.js'

export function approvalModeFor(policy: ApprovalPolicy): 'suggest' | 'auto-edit' | 'full-auto' {
  switch (policy) {
    case 'untrusted':
    case 'on-request':
      return 'suggest'
    case 'never':
      return 'full-auto'
  }
}
