/**
 * Actions tab — per-action-call telemetry (timestamp, name, status, duration).
 *
 * G3 plan T5.1 + ADR D7. Consumes `state.actionCalls` populated by
 * `dispatcher.onActionCall()` which is called from `server/http/action-execute.ts`
 * (or future consumers) in dev mode (tree-shaken in prod via __IS_DEV guard,
 * mirroring AgentsTab pattern).
 *
 * EC absorbed:
 * - EC-12 (PII mask heuristic): masked input/output rendered via maskPiiFields
 *   (password/token/secret/apiKey/credit_card/ssn/cpf/cnpj). Click-to-reveal
 *   per-record toggle stores the unmasked view in local component state
 *   (NEVER persisted; reset on tab close).
 * - EC-11 (tree-shake prod): the dispatcher emit path is __IS_DEV-guarded;
 *   in prod the entire telemetry module is dead-code-eliminated.
 *
 * NEVER use dangerouslySetInnerHTML in any devtools component — see plan EC-20.
 */
import { useState } from 'react'

import { useDevtoolsContext } from '../../hooks/useDevtoolsContext.js'
import { maskPiiFields } from '../../pii-mask.js'
import type { ActionCallRecord } from '../../shared.js'
import { tokens } from '../../styles/tokens.js'

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatPayload(value: unknown, reveal: boolean): string {
  const display = reveal ? value : maskPiiFields(value)
  try {
    return JSON.stringify(display, null, 2)
  } catch {
    return '<unserializable>'
  }
}

// Style builder extracted to keep ActionsTab's body under the line ceiling.
function buildActionsStyles(styles: ReturnType<typeof useDevtoolsContext>['styles']) {
  return {
    header: styles.css`
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: ${tokens.spacing.xs} ${tokens.spacing.sm};
      color: ${tokens.colors.textMuted};
      font-size: ${tokens.font.sizeXs};
      border-bottom: 1px solid ${tokens.colors.borderSubtle};
    `,
    clearBtn: styles.css`
      appearance: none;
      background: transparent;
      color: ${tokens.colors.textMuted};
      border: 1px solid ${tokens.colors.borderSubtle};
      padding: 2px 6px;
      border-radius: ${tokens.radius.sm};
      cursor: pointer;
      font-size: ${tokens.font.sizeXs};
      &:hover { color: ${tokens.colors.text}; }
    `,
    table: styles.css`
      width: 100%;
      border-collapse: collapse;
      font-size: ${tokens.font.sizeXs};
      th, td {
        text-align: left;
        padding: 4px 8px;
        border-bottom: 1px solid ${tokens.colors.borderSubtle};
      }
      th {
        color: ${tokens.colors.textMuted};
        font-weight: 500;
        font-size: ${tokens.font.sizeXs};
      }
      tr.status-error td { color: #c92a2a; }
      tr.selected td { background: ${tokens.colors.borderSubtle}; cursor: pointer; }
      tr { cursor: pointer; }
    `,
    detail: styles.css`
      padding: ${tokens.spacing.sm};
      border-top: 1px solid ${tokens.colors.borderSubtle};
      font-size: ${tokens.font.sizeXs};
      pre {
        margin: 0;
        padding: ${tokens.spacing.xs};
        background: ${tokens.colors.borderSubtle};
        border-radius: ${tokens.radius.sm};
        overflow: auto;
        max-height: 200px;
        font-family: ${tokens.font.mono};
      }
      .field-errors {
        margin-top: ${tokens.spacing.xs};
        color: #c92a2a;
      }
      .field-errors li { margin-left: ${tokens.spacing.md}; }
      button {
        appearance: none;
        background: transparent;
        color: ${tokens.colors.textMuted};
        border: 1px solid ${tokens.colors.borderSubtle};
        padding: 2px 8px;
        margin-bottom: ${tokens.spacing.xs};
        border-radius: ${tokens.radius.sm};
        cursor: pointer;
        font-size: ${tokens.font.sizeXs};
      }
    `,
  }
}

function ActionsEmptyState() {
  return (
    <div style={{ color: tokens.colors.textMuted, padding: tokens.spacing.md }}>
      No action calls yet. Trigger a server action (via <code>useAction</code> or direct{' '}
      <code>POST /_actions/&lt;name&gt;</code>) to see it here. Production builds tree-shake this
      telemetry path.
    </div>
  )
}

export function ActionsTab() {
  const { state, dispatch, styles } = useDevtoolsContext()
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (state.actionCalls.length === 0) return <ActionsEmptyState />

  const cls = buildActionsStyles(styles)

  const selected: ActionCallRecord | undefined =
    selectedId !== null ? state.actionCalls.find((r) => r.id === selectedId) : state.actionCalls[0]

  const toggleReveal = (id: string): void => {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div data-testid="devtools-actions-tab">
      <ActionsHeader
        className={cls.header}
        clearBtnClass={cls.clearBtn}
        count={state.actionCalls.length}
        onClear={() => {
          dispatch({ type: 'RESET_ACTION_CALLS' })
          setSelectedId(null)
          setRevealedIds(new Set())
        }}
      />
      <ActionsTable
        className={cls.table}
        records={state.actionCalls}
        selectedId={selected?.id}
        onSelect={setSelectedId}
      />
      {selected && (
        <ActionDetail
          className={cls.detail}
          record={selected}
          revealed={revealedIds.has(selected.id)}
          onToggleReveal={() => {
            toggleReveal(selected.id)
          }}
        />
      )}
    </div>
  )
}

function ActionsHeader({
  className,
  clearBtnClass,
  count,
  onClear,
}: Readonly<{ className: string; clearBtnClass: string; count: number; onClear: () => void }>) {
  return (
    <div className={className}>
      <span>
        {count} call{count === 1 ? '' : 's'}
      </span>
      <button type="button" className={clearBtnClass} onClick={onClear}>
        Clear
      </button>
    </div>
  )
}

function ActionsTable({
  className,
  records,
  selectedId,
  onSelect,
}: Readonly<{
  className: string
  records: readonly ActionCallRecord[]
  selectedId: string | undefined
  onSelect: (id: string) => void
}>) {
  return (
    <table className={className}>
      <thead>
        <tr>
          <th>Time</th>
          <th>Action</th>
          <th>Status</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr
            key={r.id}
            className={`status-${r.status} ${r.id === selectedId ? 'selected' : ''}`}
            onClick={() => {
              onSelect(r.id)
            }}
          >
            <td>{formatTime(r.timestamp)}</td>
            <td>{r.name}</td>
            <td>{r.status}</td>
            <td>{r.durationMs}ms</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ActionDetail({
  className,
  record,
  revealed,
  onToggleReveal,
}: Readonly<{
  className: string
  record: ActionCallRecord
  revealed: boolean
  onToggleReveal: () => void
}>) {
  return (
    <div className={className}>
      <button type="button" onClick={onToggleReveal}>
        {revealed ? 'Hide values' : 'Reveal values'}
      </button>
      <div>
        <strong>Input</strong>
        <pre>{formatPayload(record.input, revealed)}</pre>
      </div>
      {record.status === 'success' && record.output !== undefined && (
        <div>
          <strong>Output</strong>
          <pre>{formatPayload(record.output, revealed)}</pre>
        </div>
      )}
      {record.status === 'error' && record.error && <ActionDetailError error={record.error} />}
    </div>
  )
}

function ActionDetailError({ error }: Readonly<{ error: NonNullable<ActionCallRecord['error']> }>) {
  return (
    <div>
      <strong>Error: {error.code}</strong>
      <p>{error.message}</p>
      {error.fields && Object.keys(error.fields).length > 0 && (
        <ul className="field-errors">
          {Object.entries(error.fields).map(([field, msgs]) => (
            <li key={field}>
              <strong>{field || '(root)'}:</strong> {msgs.join('; ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
