import { useCallback, useMemo, useState } from 'react'

import { resolveEffectiveConfig, resolveTrustPosture } from '@theocode/agent/config'
import { approveHook, classifyHooks, parseHooks } from '@theocode/agent/hooks'

import {
  persistedApproval,
  trust as trustInState,
  distrust as distrustInState,
  initialState,
  markReviewed as markReviewedInState,
  refuseHook as refuseHookInState,
  type ConsentState,
} from './consent-state.js'
import { computePendingHooks } from './hook-consent.js'
import { workingDirectory } from '../working-directory.js'

export interface Consent {
  readonly trusted: boolean
  readonly hooksReviewed: boolean
  readonly pendingHooks: ReturnType<typeof computePendingHooks>

  readonly trust: () => void
  readonly distrust: () => void

  /**
   * B-040 — returns a promise so the caller can sequence on it. It used to take an on-failure
   * callback, which let the gate run `markReviewed()` synchronously while the persist was still in
   * flight and close as if it had succeeded.
   */
  readonly approveHookConsent: (spec: unknown) => Promise<void>
  readonly refuseHook: (fingerprint: string) => void
  readonly markReviewed: () => void
}

export function useConsent(cwd: string = workingDirectory()): Consent {
  const [state, setState] = useState<ConsentState>(() =>
    initialState(resolveTrustPosture(cwd).level === 'trusted'),
  )
  const { trusted, hooksReviewed, declined, epoch } = state

  const pendingHooks = useMemo(() => {
    void epoch
    return computePendingHooks({
      cwd,
      declined: declined,
      resolveEffectiveConfig,
      parseHooks,
      classifyHooks,
      onError: (err) => process.stderr.write(`[hooks] consent check failed: ${String(err)}\n`),
    })
  }, [cwd, declined, epoch])

  const approveHookConsent = useCallback(
    async (spec: unknown): Promise<void> => {
      await approveHook(cwd, spec as Parameters<typeof approveHook>[1])
      setState(persistedApproval)
    },
    [cwd],
  )

  return {
    trusted,
    hooksReviewed,
    pendingHooks,
    trust: useCallback(() => {
      setState(trustInState)
    }, []),
    distrust: useCallback(() => {
      setState(distrustInState)
    }, []),
    approveHookConsent,
    refuseHook: useCallback((fingerprint: string) => {
      setState((current) => refuseHookInState(current, fingerprint))
    }, []),
    markReviewed: useCallback(() => {
      setState(markReviewedInState)
    }, []),
  }
}
