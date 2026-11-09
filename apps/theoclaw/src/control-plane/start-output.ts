import { isIPv6 } from 'node:net'

import type { ControlPlaneSettings } from './settings.js'

/** The lines a start writes about the control plane: where it listens and which surfaces are off. */

/** One line for each owner surface left off because its token is unset. */
export function reportSurfacesOff(
  settings: ControlPlaneSettings,
  stdout: (line: string) => void,
): void {
  if (settings.controlToken === undefined) {
    stdout('theoclaw: control socket off (THEOCLAW_CONTROL_TOKEN unset)')
  }
  if (settings.webchatToken === undefined) {
    stdout('theoclaw: webchat off (THEOCLAW_WEBCHAT_TOKEN unset)')
  }
}

/** A bound address as the listening line writes it, an IPv6 host in brackets. */
export function formatAddress(address: { readonly host: string; readonly port: number }): string {
  return isIPv6(address.host) ? `[${address.host}]:${address.port}` : `${address.host}:${address.port}`
}
