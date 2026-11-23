import { useCallback, useRef } from 'react'

import { useWorkspaceConsent, type ReviewableHook, type WorkspaceConsent } from '@theokit/tui'
import { resolveEffectiveConfig, resolveTrustPosture, trustDir } from '@theocode/agent/config'
import { approveHook, classifyHooks, parseHooks } from '@theocode/agent/hooks'

import { computePendingHooks } from './hook-consent.js'
import { workingDirectory } from '../working-directory.js'

export type Consent = WorkspaceConsent

type Classified = ReturnType<typeof computePendingHooks>

/**
 * The framework owns the consent state (optimistic trust with rollback, session refusals, pending
 * list). What stays here is product code: how trust is persisted, how hooks are classified, and
 * mapping the framework's fingerprint back to the spec `approveHook` persists.
 */
export function useConsent(cwd: string = workingDirectory()): Consent {
  const classified = useRef<Classified>([])

  const listPendingHooks = useCallback((): readonly ReviewableHook[] => {
    classified.current = computePendingHooks({
      cwd,
      declined: new Set(),
      resolveEffectiveConfig,
      parseHooks,
      classifyHooks,
      onError: (err) => process.stderr.write(`[hooks] consent check failed: ${String(err)}\n`),
    })
    return classified.current.map((h) => ({
      fingerprint: h.fingerprint,
      event: h.spec.event,
      command: h.spec.command,
      status: h.status === 'modified' ? 'modified' : 'new',
      ...(h.previousCommand === undefined ? {} : { previousCommand: h.previousCommand }),
    }))
  }, [cwd])

  return useWorkspaceConsent({
    workspaceKey: cwd,
    isTrusted: () => resolveTrustPosture(cwd).level === 'trusted',
    persistTrust: () => trustDir(cwd),
    listPendingHooks,
    approveHook: async (fingerprint) => {
      const hook = classified.current.find((h) => h.fingerprint === fingerprint)
      if (!hook) throw new Error('the hook is no longer pending; its configuration changed')
      await approveHook(cwd, hook.spec)
    },
  })
}
