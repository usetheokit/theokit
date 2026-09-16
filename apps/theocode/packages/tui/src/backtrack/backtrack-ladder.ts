import { SENTINEL } from './backtrack-select.js'

export interface LadderState {
  readonly armed: boolean
  readonly nth: number
  readonly total: number
  readonly previews: readonly string[]
}

export const CLOSED_LADDER: Required<LadderState> = {
  armed: false,
  nth: SENTINEL,
  total: 0,
  previews: [],
}

export function armLadder(previews: readonly string[], total: number): LadderState {
  return { armed: true, nth: SENTINEL, total, previews }
}

export function selectTurn(state: LadderState, next: number): LadderState {
  return { ...state, nth: next }
}
