/**
 * M48 T3.2 — the boot-time fail-fast. Turns the per-request lazy `SDK_NOT_INSTALLED` event
 * (`sdk-adapter.ts:509`) into a LOUD boot failure when the installed `@theokit/sdk` is present but
 * outside the supported range. `resolveVersion` is injected so the test drives found/absent/below-floor
 * without mocking module resolution (DIP).
 */
import { describe, expect, it } from 'vitest'

import {
  assertSdkCompatible,
  SdkIncompatibleError,
} from '../../packages/theo/src/cli/commands/start/assert-sdk-compatible.js'

describe('assertSdkCompatible (M48 T3.2)', () => {
  it('test_no_throw_when_version_satisfies_floor', () => {
    expect(() => assertSdkCompatible({ resolveVersion: () => '4.0.2' })).not.toThrow()
  })

  it('test_throws_typed_error_when_below_floor', () => {
    let thrown: unknown
    try {
      assertSdkCompatible({ resolveVersion: () => '3.5.0' })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(SdkIncompatibleError)
    expect((thrown as SdkIncompatibleError).code).toBe('SDK_INCOMPATIBLE')
    expect((thrown as SdkIncompatibleError).found).toBe('3.5.0')
    expect((thrown as Error).message).toContain('3.5.0')
    expect((thrown as Error).message).toContain('^4.0.1')
  })

  it('test_no_throw_when_absent_and_not_required (api-only app, optional peer)', () => {
    expect(() => assertSdkCompatible({ resolveVersion: () => undefined })).not.toThrow()
  })

  it('test_throws_when_absent_and_required', () => {
    expect(() => assertSdkCompatible({ required: true, resolveVersion: () => undefined })).toThrow(
      SdkIncompatibleError,
    )
  })
})
