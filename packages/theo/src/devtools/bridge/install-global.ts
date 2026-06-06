/**
 * Stable global pointer to the devtools dispatcher singleton.
 *
 * Mirrors the React DevTools pattern (`__REACT_DEVTOOLS_GLOBAL_HOOK__`):
 * a synchronously-readable handle on `window` that callers in another
 * package (e.g. the `@theo/actions` virtual module client facade) can
 * use to dispatch telemetry without a cross-package dynamic import.
 *
 * Invariant — INSTALL ONCE, NEVER UNINSTALL:
 *   The dispatcher is a module singleton with no lifecycle. The window
 *   pointer just exposes that singleton to other realms. Clearing the
 *   pointer on React unmount races with sibling mounts (StrictMode
 *   double-invoke, HMR module replace) and silently drops telemetry —
 *   the call-site reads `window.__theoDevtoolsDispatcher`, sees
 *   undefined, and no-ops. This was the c7906fa regression.
 *
 * Returned cleanup is therefore a NO-OP for the global; it exists only
 * to keep the React effect contract honest (effects return cleanups).
 *
 * NEVER use dangerouslySetInnerHTML in any devtools component — see plan EC-20.
 */
import { dispatcher } from './dispatcher.js'

interface WindowWithDispatcher {
  __theoDevtoolsDispatcher?: typeof dispatcher
}

// NO-OP cleanup. See module header: the global pointer is install-once
// for the page lifetime. Tearing it down on cleanup races with sibling
// mounts and was the root cause of the c7906fa Actions-tab silent-drop
// regression. Caller still gets a function so it conforms to the React
// effect-cleanup contract.
function noopCleanup(): void {
  // intentional no-op
}

export function installDispatcherGlobal(): () => void {
  if (typeof window === 'undefined') return noopCleanup
  const w = window as unknown as WindowWithDispatcher
  w.__theoDevtoolsDispatcher = dispatcher
  return noopCleanup
}
