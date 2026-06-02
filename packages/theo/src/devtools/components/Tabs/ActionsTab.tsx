/**
 * Actions tab — per-action-call telemetry (timestamp, name, status, duration).
 *
 * G3 plan T5.1 + ADR D7. Consumes `state.actionCalls` populated by
 * `dispatcher.onActionCall()`.
 *
 * UX: row-level inline expand/collapse, mirroring RequestsTab. Each row
 * is a click-to-toggle button; details render inline under the expanded
 * row. Multiple rows can be expanded simultaneously. JSONExplorer is
 * used for input/output bodies (nested collapsibility).
 *
 * EC absorbed:
 * - EC-12 (PII mask heuristic): bodies pass through maskPiiFields when
 *   not revealed (password/token/secret/apiKey/credit_card/ssn/cpf/cnpj).
 *   Click-to-reveal per-record toggle stores the unmasked view in local
 *   component state (NEVER persisted; reset on tab close).
 * - EC-11 (tree-shake prod): the dispatcher emit path is __IS_DEV-guarded;
 *   in prod the entire telemetry module is dead-code-eliminated.
 *
 * NEVER use dangerouslySetInnerHTML in any devtools component — see plan EC-20.
 */
import { useState } from 'react'

import { toggleExpandedIds } from '../../actions-row-state.js'
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
    rowContainer: styles.css`
      border-bottom: 1px solid ${tokens.colors.borderSubtle};
      font-size: ${tokens.font.sizeXs};
    `,
    rowSummary: styles.css`
      display: grid;
      grid-template-columns: 24px 80px 1fr 80px 80px;
      gap: ${tokens.spacing.sm};
      align-items: center;
      width: 100%;
      padding: ${tokens.spacing.xs} ${tokens.spacing.sm};
      background: transparent;
      border: none;
      color: ${tokens.colors.text};
      text-align: left;
      cursor: pointer;
      font-family: ${tokens.font.family};
      font-size: ${tokens.font.sizeXs};
      &:hover { background: ${tokens.colors.bgPanelHover}; }
      &[aria-expanded='true'] { background: ${tokens.colors.bgPanelHover}; }
      .chev { color: ${tokens.colors.textMuted}; font-family: ${tokens.font.mono}; }
      .name { font-family: ${tokens.font.mono}; }
      .time { color: ${tokens.colors.textMuted}; font-family: ${tokens.font.mono}; }
      .status-success { color: ${tokens.colors.accent}; }
      .status-error { color: #c92a2a; }
      .duration { color: ${tokens.colors.textMuted}; text-align: right; }
    `,
    detail: styles.css`
      padding: ${tokens.spacing.sm} ${tokens.spacing.md};
      background: ${tokens.colors.bgPanelHover};
      border-top: 1px dashed ${tokens.colors.borderSubtle};
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
      .reveal-btn {
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
      .reveal-btn:hover { color: ${tokens.colors.text}; }
      .section { margin-top: ${tokens.spacing.sm}; }
      .field-errors { margin-top: ${tokens.spacing.xs}; color: #c92a2a; }
      .field-errors li { margin-left: ${tokens.spacing.md}; }
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  if (state.actionCalls.length === 0) return <ActionsEmptyState />

  const cls = buildActionsStyles(styles)

  const toggleReveal = (id: string): void => {
    setRevealedIds((prev) => toggleExpandedIds(prev, id))
  }
  const toggleExpand = (id: string): void => {
    setExpandedIds((prev) => toggleExpandedIds(prev, id))
  }

  return (
    <div data-testid="devtools-actions-tab">
      <ActionsHeader
        className={cls.header}
        clearBtnClass={cls.clearBtn}
        count={state.actionCalls.length}
        onClear={() => {
          dispatch({ type: 'RESET_ACTION_CALLS' })
          setRevealedIds(new Set())
          setExpandedIds(new Set())
        }}
      />
      <div>
        {state.actionCalls.map((r) => (
          <ActionRow
            key={r.id}
            record={r}
            containerClass={cls.rowContainer}
            summaryClass={cls.rowSummary}
            detailClass={cls.detail}
            expanded={expandedIds.has(r.id)}
            revealed={revealedIds.has(r.id)}
            onToggleExpand={() => {
              toggleExpand(r.id)
            }}
            onToggleReveal={() => {
              toggleReveal(r.id)
            }}
          />
        ))}
      </div>
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

function ActionRow({
  record,
  containerClass,
  summaryClass,
  detailClass,
  expanded,
  revealed,
  onToggleExpand,
  onToggleReveal,
}: Readonly<{
  record: ActionCallRecord
  containerClass: string
  summaryClass: string
  detailClass: string
  expanded: boolean
  revealed: boolean
  onToggleExpand: () => void
  onToggleReveal: () => void
}>) {
  const statusClass = record.status === 'success' ? 'status-success' : 'status-error'
  return (
    <div className={containerClass} data-testid="devtools-action-row">
      <button
        type="button"
        className={summaryClass}
        onClick={onToggleExpand}
        aria-expanded={expanded}
        title={`${record.name} — click to ${expanded ? 'collapse' : 'expand'} details`}
      >
        <span className="chev">{expanded ? '▼' : '▶'}</span>
        <span className="time">{formatTime(record.timestamp)}</span>
        <span className="name">{record.name}</span>
        <span className={statusClass}>{record.status}</span>
        <span className="duration">{record.durationMs}ms</span>
      </button>
      {expanded && (
        <div className={detailClass}>
          <button type="button" className="reveal-btn" onClick={onToggleReveal}>
            {revealed ? 'Hide values' : 'Reveal values'}
          </button>
          <div className="section">
            <strong>Input</strong>
            <pre>{formatPayload(record.input, revealed)}</pre>
          </div>
          {record.status === 'success' && record.output !== undefined && (
            <div className="section">
              <strong>Output</strong>
              <pre>{formatPayload(record.output, revealed)}</pre>
            </div>
          )}
          {record.status === 'error' && record.error && <ActionDetailError error={record.error} />}
        </div>
      )}
    </div>
  )
}

function ActionDetailError({ error }: Readonly<{ error: NonNullable<ActionCallRecord['error']> }>) {
  return (
    <div className="section">
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
