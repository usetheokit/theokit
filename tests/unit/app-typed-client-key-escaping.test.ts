import { describe, it, expect } from 'vitest'

import { generateClientDts } from '../../packages/theo/src/vite-plugin/app-typed-client.js'
import type { TheoManifest } from '../../packages/theo/src/server/scan/manifest.js'

/**
 * #428 follow-up — a route segment that is not a plain identifier is emitted as a quoted property
 * key, and the quoting has to survive whatever the segment actually contains. A backslash is legal
 * in a POSIX filename, so it reaches this code from `server/routes/`.
 */
function manifestWithSegment(segment: string): TheoManifest {
  return {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    routes: [
      {
        filePath: `server/routes/${segment}/get.ts`,
        routePath: `/${segment}/thing`,
        paramNames: [],
        methods: ['GET'],
      },
    ],
    actions: [],
    websockets: [],
  }
}

function emit(segment: string): string {
  return generateClientDts({
    manifest: manifestWithSegment(segment),
    dtsOutPath: '/proj/.theokit/app-client.d.ts',
    serverDir: '/proj/server',
  })
}

describe('generateClientDts — quoted property keys', () => {
  it('Given a segment containing a single quote, Then the quote is escaped', () => {
    const dts = emit("we're")
    expect(dts).toContain("'we\\'re'")
  })

  // A backslash escaped nothing before this: `back\` became `'back\'`, whose trailing backslash
  // escapes the closing quote and swallows the rest of the line.
  it('Given a segment containing a backslash, Then the backslash is escaped too', () => {
    const dts = emit('back\\slash')
    expect(dts).toContain("'back\\\\slash'")
  })

  it('Given a segment ending in a backslash, Then the emitted key still terminates', () => {
    const dts = emit('trail\\')
    expect(dts).toContain("'trail\\\\'")
    expect(dts).not.toContain("'trail\\'")
  })
})
