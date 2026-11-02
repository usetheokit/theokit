import type { DevicePairing } from './device-pairing.js'

/**
 * The frames that manage paired devices (OC-91), answered on the owner's socket only: `pair_code`
 * issues a setup code, `pending_devices` lists the requests waiting, `approve_device` approves one
 * by id. A socket opened with a device's token gets `forbidden`, and without a pairing store these
 * frames are not known at all, so the caller answers `bad_frame` as before.
 *
 * Returns the answer, or `undefined` when the frame is not a device frame.
 */
export function handleDeviceFrame(
  devices: DevicePairing | undefined,
  owner: boolean,
  frame: { type?: unknown; id?: unknown } | undefined,
): Promise<Record<string, unknown>> | undefined {
  if (devices === undefined || frame === undefined) return undefined
  if (frame.type !== 'pair_code' && frame.type !== 'pending_devices' && frame.type !== 'approve_device') return undefined
  if (!owner) return Promise.resolve({ type: 'error', code: 'forbidden' })
  if (frame.type === 'pair_code') return Promise.resolve({ type: 'pair_code', code: devices.issueSetupCode() })
  if (frame.type === 'pending_devices') return Promise.resolve({ type: 'pending_devices', devices: devices.pending() })
  if (typeof frame.id !== 'string') return Promise.resolve({ type: 'error', code: 'bad_frame' })
  return devices.approve(frame.id).then((result) =>
    result.ok
      ? { type: 'device_approved', id: frame.id, name: result.name }
      : { type: 'error', code: 'approve_failed', reason: result.reason },
  )
}
