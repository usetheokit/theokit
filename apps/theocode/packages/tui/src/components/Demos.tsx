import { Box, Text } from 'ink'
import { type ReactElement, useEffect, useState } from 'react'
import {
  MultiStepProgress,
  PlanApproval,
  ProgressActivity,
  ProgressBar,
  QuestionPrompt,
  SelectList,
  type SelectListItem,
  type TodoItem,
} from '@theokit/tui'

import type { Mode, ToastPayload } from '../screen-types.js'

const DEMO_PLAN = [
  '## Proposed plan',
  '',
  '1. Scaffold the `reports` route',
  '2. Add the `generateReport` server action',
  '3. Stream results into the dashboard',
].join('\n')

const DEMO_ASK_OPTIONS: readonly SelectListItem[] = [
  {
    value: 'python',
    label: 'Python (FastAPI)',
    description: 'polyglot service via --backend python',
  },
  { value: 'node', label: 'Node (Hono)', description: 'fetch-handler service' },
  { value: 'none', label: 'TypeScript only', description: 'no external backend' },
]

const DEMO_SELECT_ITEMS: readonly SelectListItem[] = [
  { value: 'auth', label: 'Auth', description: 'sessions + requireAuth' },
  { value: 'db', label: 'Database', description: 'SQLite by default' },
  { value: 'ws', label: 'WebSocket', description: 'realtime channel' },
  { value: 'deploy', label: 'Deploy', description: 'TheoCloud target' },
]

const DEMO_STEP_LABELS = ['Plan', 'Generate', 'Validate', 'Ship'] as const

function ProgressDemo({
  elapsed,
  tokens,
  onComplete,
  onToast,
}: {
  elapsed: number
  tokens: number | undefined
  onComplete: () => void
  onToast: (t: ToastPayload) => void
}): ReactElement {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (step >= DEMO_STEP_LABELS.length) {
      const done = setTimeout(() => {
        onComplete()
        onToast({ message: 'Task complete', variant: 'success' })
      }, 600)
      return () => clearTimeout(done)
    }
    const tick = setTimeout(() => setStep((s) => s + 1), 700)
    return () => clearTimeout(tick)
  }, [step, onComplete, onToast])

  const steps: readonly TodoItem[] = DEMO_STEP_LABELS.map((label, i) => ({
    id: label,
    label,
    status: i < step ? 'done' : i === step ? 'active' : 'pending',
  }))
  const percent = Math.min(100, Math.round((step / DEMO_STEP_LABELS.length) * 100))

  return (
    <Box flexDirection="column">
      {/* Rows are tight by default (the Claude-Code menu look). Add `gap={1}` to any list/menu below
          (MultiStepProgress / QuestionPrompt / SelectList) for a blank line between items — @theokit/tui ^0.41.0. */}
      <MultiStepProgress steps={steps} current={step} groupLabel="Demo task" />
      <ProgressActivity
        label="Working…"
        percent={percent}
        elapsedSeconds={elapsed}
        tokens={tokens}
        tokenDirection="up"
      />
      <ProgressBar percent={percent} />
      <Text dimColor>esc to exit</Text>
    </Box>
  )
}

interface DemoProps {
  mode: Exclude<Mode, 'chat'>
  elapsed: number
  tokens: number | undefined
  onComplete: () => void
  onToast: (t: ToastPayload) => void
}

function demoBody({ mode, elapsed, tokens, onComplete, onToast }: DemoProps): ReactElement {
  switch (mode) {
    case 'plan':
      return (
        <PlanApproval
          plan={DEMO_PLAN}
          onDecision={(d) => {
            onComplete()
            onToast({
              message:
                d.kind === 'approve'
                  ? 'Plan approved'
                  : `Revision requested${d.feedback ? `: ${d.feedback}` : ''}`,
              variant: 'success',
            })
          }}
        />
      )
    case 'ask':
      return (
        <QuestionPrompt
          header="Backend"
          question="Which backend should the app ship next to?"
          options={DEMO_ASK_OPTIONS}
          allowFreeText
          onAnswer={(a) => {
            onComplete()
            onToast({
              message: `Answered: ${a.values.join(', ')}${a.text ? ` (${a.text})` : ''}`,
              variant: 'info',
            })
          }}
        />
      )
    case 'select':
      return (
        <SelectList
          items={DEMO_SELECT_ITEMS}
          multi
          autoFocus
          onSubmit={(values) => {
            onComplete()
            onToast({ message: `Selected: ${values.join(', ') || '(none)'}`, variant: 'info' })
          }}
        />
      )
    case 'progress':
      return (
        <ProgressDemo elapsed={elapsed} tokens={tokens} onComplete={onComplete} onToast={onToast} />
      )
  }
}

export function DemoSurface(props: DemoProps): ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={1}>
      {demoBody(props)}
    </Box>
  )
}
