export interface ConsentState {
  readonly trusted: boolean
  readonly hooksReviewed: boolean
  readonly declined: ReadonlySet<string>
  readonly epoch: number
}

export function initialState(trusted: boolean): ConsentState {
  return { trusted, hooksReviewed: false, declined: new Set(), epoch: 0 }
}

export function trust(e: ConsentState): ConsentState {
  return { ...e, trusted: true, epoch: e.epoch + 1 }
}

export function distrust(e: ConsentState): ConsentState {
  return { ...e, trusted: false }
}

export function refuseHook(e: ConsentState, fingerprint: string): ConsentState {
  return { ...e, declined: new Set([...e.declined, fingerprint]) }
}

export function persistedApproval(e: ConsentState): ConsentState {
  return { ...e, epoch: e.epoch + 1 }
}

export function markReviewed(e: ConsentState): ConsentState {
  return { ...e, hooksReviewed: true }
}
