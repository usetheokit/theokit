import type { ReactElement } from 'react'
import { Box, Text } from 'ink'

import { HookReviewPrompt, WorkspaceTrustPrompt } from '@theokit/tui'
import { APPROVAL_KEY_HINT } from '../formatting/index.js'

import type { ApprovalMode } from '../consent/index.js'
import type { ReasoningEffort } from '@theocode/agent/config'
import type { ToastPayload } from '../screen-types.js'
import type { Dispatch, SetStateAction } from 'react'
import { AGENT } from '@theocode/shared/agent'
import { workingDirectory } from '../working-directory.js'

type Consent = ReturnType<typeof import('../consent/index.js').useConsent>

const HOOK_WARNING =
  'This command runs on every matching tool call. Approve only what you recognise — ' +
  'declining leaves it inert, and you will be asked again next launch.'

export interface HooksGateProps {
  readonly consent: Consent
  readonly pendingHooks: Consent['pendingHooks']
  // B-040 — a persist failure the user cannot see is a persist failure that reads as success.
  readonly setToast: Dispatch<SetStateAction<ToastPayload | null>>
}

export function HooksGate({
  consent,
  pendingHooks,
  setToast,
}: HooksGateProps): ReactElement | null {
  const head = pendingHooks[0]
  if (!head) return null
  return (
    <Box flexDirection="column">
      <HookReviewPrompt
        hook={head}
        remaining={pendingHooks.length - 1}
        refuseLabel="No, leave it inert"
        onDecision={(decision) => {
          if (decision === 'refuse') {
            consent.refuseHook(head.fingerprint)
            return
          }
          // The gate stays OPEN on failure (the hook stays pending): an approval that did not
          // persist will not be in effect next launch.
          consent.approveHook(head.fingerprint).catch((err: unknown) => {
            setToast({
              message:
                `could not persist the hook approval: ${(err as Error).message} — the hook is still ` +
                'unapproved; approve again to retry',
              variant: 'error',
            })
          })
        }}
      />
      <Text dimColor>{HOOK_WARNING}</Text>
      <Text dimColor>{APPROVAL_KEY_HINT}</Text>
    </Box>
  )
}

export interface TrustGateProps {
  readonly consent: Consent
  readonly SESSION: {
    reloadConfig: () => void
    cfg: () => { approvalMode: ApprovalMode }
    effort: () => ReasoningEffort
  }
  readonly setToast: Dispatch<SetStateAction<ToastPayload | null>>
  readonly setApprovalMode: Dispatch<SetStateAction<ApprovalMode>>
  readonly setEffort: Dispatch<SetStateAction<ReasoningEffort>>
  readonly exit: () => void
}

export function TrustGate({
  consent,
  SESSION,
  setToast,
  setApprovalMode,
  setEffort,
  exit,
}: TrustGateProps): ReactElement {
  return (
    <Box flexDirection="column">
      <WorkspaceTrustPrompt
        dir={workingDirectory()}
        description={`${AGENT.name} will read files here and may run commands or apply patches. Trust only directories you control — an untrusted repo's AGENTS.md could try to hijack the agent. Approve to trust this directory (remembered); reject to quit.`}
        // Rejecting the trust gate QUITS — saying so on the button is the difference between an
        // informed refusal and a surprise exit.
        quitLabel="No, quit"
        onDecision={(decision) => {
          if (decision !== 'trust') {
            exit()
            return
          }
          consent.trust().then(
            () => {
              try {
                SESSION.reloadConfig()
                setApprovalMode(SESSION.cfg().approvalMode)
                setEffort(SESSION.effort())
              } catch (err: unknown) {
                setToast({
                  message: `trust granted, but the project settings.json could not be read: ${(err as Error).message} — fix it and restart; this session keeps the previous config`,
                  variant: 'error',
                })
                process.stderr.write(
                  `trust granted, but the project settings.json could not be read: ${(err as Error).message}\n`,
                )
              }
            },
            (err: unknown) => {
              // The framework has already rolled the optimistic trust back.
              setToast({
                message: `could not persist trust: ${(err as Error).message} — the directory is still untrusted; approve again to retry`,
                variant: 'error',
              })
              process.stderr.write(`could not persist trust: ${(err as Error).message}\n`)
            },
          )
        }}
      />
      <Text dimColor>{APPROVAL_KEY_HINT}</Text>
    </Box>
  )
}
