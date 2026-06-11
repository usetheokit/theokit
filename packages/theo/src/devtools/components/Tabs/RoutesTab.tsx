/**
 * Routes tab — file tree of app/** with active highlight (Phase 3 — T3.1).
 *
 * NEVER use dangerouslySetInnerHTML in any devtools component — see plan EC-20.
 */
import { useDevtoolsContext } from '../../hooks/useDevtoolsContext.js'
import { tokens } from '../../styles/tokens.js'

export function RoutesTab() {
  const { state, styles } = useDevtoolsContext()

  if (!state.routeManifest || state.routeManifest.routes.length === 0) {
    return (
      <div style={{ color: tokens.colors.textMuted, padding: tokens.spacing.md }}>
        Routes will appear when the manifest loads.
      </div>
    )
  }

  const rowClass = styles.css`
    display: flex;
    align-items: center;
    gap: ${tokens.spacing.sm};
    padding: ${tokens.spacing.xs} ${tokens.spacing.sm};
    color: ${tokens.colors.text};
    font-family: ${tokens.font.mono};
    font-size: ${tokens.font.sizeXs};
    cursor: pointer;
    border-bottom: 1px solid ${tokens.colors.borderSubtle};
    &:hover { background: ${tokens.colors.bgPanelHover}; }
    &[data-active='true'] {
      background: ${tokens.colors.bgPanelHover};
      border-left: 2px solid ${tokens.colors.accent};
    }
  `

  function openInEditor(file: string): void {
    fetch(`/__open-in-editor?file=${encodeURIComponent(file)}`)
      .then((res) => {
        if (!res.ok) {
          console.warn(
            '[theo devtools] Editor not configured — set VITE_EDITOR=code (or your editor) in your env',
          )
        }
      })
      .catch(() => {
        console.warn('[theo devtools] Editor not configured')
      })
  }

  return (
    <div data-testid="devtools-routes-tab">
      <a
        href="/__theo/openapi/docs"
        target="_blank"
        rel="noopener noreferrer"
        className={styles.css`
          display: inline-block;
          margin-bottom: 8px;
          padding: 4px 10px;
          font-size: ${tokens.font.sizeSm};
          color: ${tokens.colors.accent};
          border: 1px solid ${tokens.colors.accent};
          border-radius: 4px;
          text-decoration: none;
          &:hover { background: ${tokens.colors.accent}22; }
        `}
      >
        📖 View API Docs
      </a>
      {state.routeManifest.routes.map((route) => {
        const active =
          state.activeRoutePath === route.path || state.activeChain.includes(route.absoluteFilePath)
        return (
          <button
            key={route.absoluteFilePath}
            type="button"
            className={rowClass}
            data-active={active}
            onClick={() => {
              openInEditor(route.absoluteFilePath)
            }}
            title={`Open ${route.absoluteFilePath} in editor`}
          >
            <span
              style={{
                color: active ? tokens.colors.accent : tokens.colors.textMuted,
                minWidth: 12,
              }}
            >
              {active ? '▸' : ' '}
            </span>
            <span style={{ flex: 1 }}>{route.path}</span>
            <span style={{ color: tokens.colors.textDim, fontSize: tokens.font.sizeXs }}>
              {route.absoluteFilePath.split('/').slice(-2).join('/')}
            </span>
          </button>
        )
      })}
    </div>
  )
}
