/**
 * B-085 — the session bundle, lifted out of the composition root.
 *
 * It was LOCAL to `use-tui-composition.ts`, and that is what made `composerDeps` unextractable:
 * anything referencing `ReturnType<typeof useTuiSession>` had to live in the same file, so the root
 * could only grow. Adding a single field to the composer bundle put the root past two lint budgets
 * at once, which is what blocked B-075.
 *
 * Both move here, together. Extracting `composerDeps` ALONE is what would have created the cycle
 * `depcruise` refuses — measured, not assumed: with both moved, the graph stays acyclic and nothing
 * imports back into the root.
 */
import { useApp, useStdout } from 'ink'
import { useCallback, useRef, useState } from 'react'

import { useTurnElapsed } from '@theokit/tui'
import { useAgent } from '@theokit/agents/client/react'

import { getTuiRoot } from '../agent-session/index.js'
import type { ReasoningEffort } from '@theocode/agent/config'

export function useTuiSession() {
  const ROOT = getTuiRoot()
  const SESSION = ROOT.session
  const GOAL_POINTER = ROOT.goalPointer
  const customCommands = ROOT.customCommands
  const customCommandNames = ROOT.customCommandNames
  const ptyOwner = ROOT.ptyOwner
  const resetSession = ROOT.resetSession
  const forkCurrentSession = ROOT.sessionFork
  const setSessionAndPersist = ROOT.pointToSession
  const currentSessionId = useCallback((): string => SESSION.session(), [SESSION])
  const agent = useAgent<{ message: string }>(ROOT.transport)
  const agentRef = useRef(agent)
  agentRef.current = agent
  const streaming = agent.status === 'streaming'
  const elapsed = useTurnElapsed(streaming)
  const { exit } = useApp()
  // Both halves of Ink's stdout context. `stdout` is the raw stream (`/clear` addresses the
  // screen through it); `write` is the seam that puts text above the live frame, which is what
  // `/raw` needs and what a raw-stream write would have had erased by the next repaint.
  const { stdout, write: writeToScrollback } = useStdout()
  const [effort, setEffort] = useState<ReasoningEffort>(SESSION.effort())
  return {
    ROOT,
    SESSION,
    GOAL_POINTER,
    customCommands,
    customCommandNames,
    ptyOwner,
    resetSession,
    forkCurrentSession,
    setSessionAndPersist,
    currentSessionId,
    agent,
    agentRef,
    streaming,
    elapsed,
    exit,
    stdout,
    writeToScrollback,
    effort,
    setEffort,
  }
}
