export interface NextApproval {
  approvalId: string
  toolName: string
  input?: unknown
}

export interface ApprovalPartLike {
  state?: unknown
  approval?: { id?: unknown }
  toolCallId?: unknown
  toolName?: unknown
  input?: unknown
}

export interface MessageLike {
  parts?: readonly unknown[]
}

export function resolveApprovalId(p: ApprovalPartLike): string | undefined {
  if (typeof p.approval?.id === 'string') return p.approval.id
  if (typeof p.toolCallId === 'string') return p.toolCallId
  return undefined
}
