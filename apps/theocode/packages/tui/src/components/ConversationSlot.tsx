import type { Dispatch, ReactElement, SetStateAction } from 'react'
import { homedir } from 'node:os'

import {
  type ChatComposerCommand,
  type SurfaceLayer,
  ChatComposer,
  FreeTextInput,
  selectSurface,
} from '@theokit/tui'

import { abandonQuestion, answerQuestion } from '@theocode/agent/ask'
import { login } from '@theocode/agent/auth'
import { BUILTIN_COMMANDS } from '../commands/index.js'
import { submittableSecret } from './secret-buffer.js'
import { PLACEHOLDER } from '../theme/theme.js'
import { DemoSurface } from './Demos.js'
import type { Mode, ToastPayload } from '../screen-types.js'

function CredentialField({
  provider,
  setToast,
  setLoginProvider,
}: {
  provider: string
  setToast: Dispatch<SetStateAction<ToastPayload | null>>
  setLoginProvider: Dispatch<SetStateAction<string | undefined>>
}): ReactElement {
  return (
    <FreeTextInput
      label={`API key for ${provider} — nothing is echoed`}
      // `mask` is the framework's since @theokit/tui@0.53.0 — it renders a placeholder and strips a
      // pasted newline, which is what the local `SecretInput` existed to do.
      mask
      onSubmit={(raw) => {
        // Trim and empty-cancel stay HERE: they are product policy, not rendering, and
        // `submittableSecret` carries both with the reason and the test they were written with.
        const key = submittableSecret(raw)
        if (key === undefined) {
          setLoginProvider(undefined)
          setToast({ message: 'Login cancelled — no key was saved', variant: 'info' })
          return
        }
        setLoginProvider(undefined)
        try {
          const r = login(key, homedir(), { provider: provider as never })
          setToast({
            message: `Key saved for ${r.provider} at ${r.path}`,
            variant: 'success',
          })
        } catch (e) {
          setToast({ message: `Login failed: ${(e as Error).message}`, variant: 'error' })
        }
      }}
      onCancel={() => {
        setLoginProvider(undefined)
        setToast({ message: 'Login cancelled — no key was saved', variant: 'info' })
      }}
    />
  )
}

function AgentQuestion({
  question,
  currentSessionId,
  setPendingQuestion,
}: {
  question: string
  currentSessionId: () => string
  setPendingQuestion: Dispatch<SetStateAction<string | undefined>>
}): ReactElement {
  return (
    <FreeTextInput
      label={question}
      onSubmit={(text) => {
        if (answerQuestion(text, currentSessionId())) setPendingQuestion(undefined)
      }}
      onCancel={() => {
        abandonQuestion(currentSessionId())
        setPendingQuestion(undefined)
      }}
    />
  )
}

/**
 * B-011 — every command the composer can route, builtins and user-defined alike.
 *
 * Custom commands were routable and listed in the `?` panel, but were never handed to the composer,
 * so the `/` menu did not offer them: discoverable only by reading the help. The SDK filters this
 * list by prefix — it simply was never given them.
 */
function composerCommands(
  custom: ReadonlyMap<string, { name: string; description?: string }>,
): readonly ChatComposerCommand[] {
  return [
    ...BUILTIN_COMMANDS,
    ...[...custom.values()].map((c) => ({
      name: c.name,
      description: c.description ?? 'custom command',
    })),
  ]
}

export interface ConversationSlotProps {
  readonly customCommands: ReadonlyMap<string, { name: string; description?: string }>
  readonly loginProvider: string | undefined
  readonly pendingQuestion: string | undefined
  readonly mode: Mode
  readonly elapsed: number
  readonly exitArmed: boolean
  readonly clearEpoch: number
  readonly lastUsage: { totalTokens?: number } | undefined
  readonly backtrack: { composerSeed: string }
  readonly currentSessionId: () => string
  readonly handleSubmit: (text: string) => void
  readonly backToChat: () => void
  readonly setToast: Dispatch<SetStateAction<ToastPayload | null>>
  readonly setComposerText: Dispatch<SetStateAction<string>>
  readonly setPendingQuestion: Dispatch<SetStateAction<string | undefined>>
  readonly setLoginProvider: Dispatch<SetStateAction<string | undefined>>
  readonly setShowHelp: Dispatch<SetStateAction<boolean>>
}

/**
 * Which surface the conversation slot draws, in precedence order — read top to bottom.
 *
 * B-008 — the inner half of the same rewrite as `INPUT_LAYERS`. All three conditions are
 * independent props, so ANY pair can hold at once and the order is the only thing that decides.
 * That is exactly the case a nested ternary answers silently.
 *
 * Two lists rather than one flat list of seven (ADR D2): this component receives a narrower prop
 * set, and flattening would force the outer file to know these props. The nesting survives as one
 * declared hop — the outer list's last layer renders this component.
 */
/**
 * `DemoSurface` takes `Exclude<Mode, 'chat'>`, and a TYPE GUARD is what carries that across the
 * layer boundary.
 *
 * The ternary got this narrowing for free: `mode !== 'chat' ? <DemoSurface mode={mode} …>` told
 * TypeScript, in one expression, both that the branch applies and what `mode` is inside it. A
 * layer splits those into two functions, and `SurfaceLayer.when` is typed `(state: S) => boolean`
 * — a boolean carries no narrowing, so `render` still sees the wide `Mode`.
 *
 * Naming the guard once and using it on BOTH sides keeps the invariant checked rather than cast.
 * The `null` branch in `render` is unreachable while `when` uses the same guard; it is written
 * out instead of asserted away because an `as` there would be the one place a future edit to
 * `when` could silently produce a `DemoSurface` with `mode === 'chat'`.
 */
const isDemoMode = (mode: Mode): mode is Exclude<Mode, 'chat'> => mode !== 'chat'

export const CONVERSATION_LAYERS: readonly SurfaceLayer<ConversationSlotProps>[] = [
  {
    name: 'credential',
    when: (p) => p.loginProvider !== undefined,
    render: (p) => (
      <CredentialField
        provider={p.loginProvider as string}
        setToast={p.setToast}
        setLoginProvider={p.setLoginProvider}
      />
    ),
  },
  {
    name: 'question',
    when: (p) => p.pendingQuestion !== undefined,
    render: (p) => (
      <AgentQuestion
        question={p.pendingQuestion as string}
        currentSessionId={p.currentSessionId}
        setPendingQuestion={p.setPendingQuestion}
      />
    ),
  },
  {
    name: 'demo',
    when: (p) => isDemoMode(p.mode),
    render: (p) =>
      isDemoMode(p.mode) ? (
        <DemoSurface
          mode={p.mode}
          elapsed={p.elapsed}
          tokens={p.lastUsage?.totalTokens}
          onComplete={p.backToChat}
          onToast={p.setToast}
        />
      ) : null,
  },
  {
    name: 'composer',
    when: () => true,
    render: (p) => (
      <ChatComposer
        key={p.clearEpoch}
        initialValue={p.backtrack.composerSeed}
        onChange={p.setComposerText}
        placeholder={PLACEHOLDER}
        bordered
        hint={p.exitArmed ? 'Press Ctrl+C again to quit' : undefined}
        commands={composerCommands(p.customCommands)}
        onHelpToggle={() => p.setShowHelp((h) => !h)}
        onSubmit={p.handleSubmit}
      />
    ),
  },
]

export function ConversationSlot(props: ConversationSlotProps): ReactElement {
  return <>{selectSurface(CONVERSATION_LAYERS, props).render()}</>
}
