import { randomUUID } from 'node:crypto'

import { afterEach, describe, expect, it } from 'vitest'

import { createBonjourPublisher } from '../../src/discovery/bonjour-publisher.js'
import type { ServicePublisher, TheoClawDiscoveryError } from '../../src/discovery/publisher.js'

/**
 * Plan D5 (B-513): announcements and probe queries send through callbacks the library ignores, so
 * only the adapter's `send` wrap can report their failure. `ip: 255.255.255.255` makes every send
 * fail with EACCES. No query is sent here and the name is run-unique, so the response packets that
 * fail are this service's own announcements. Runs only with THEOCLAW_LIVE=1.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const DEADLINE_MS = 5000

let publisher: ServicePublisher | undefined

afterEach(async () => {
  await publisher?.destroy()
  publisher = undefined
})

/** Publish a run-unique service on a host that cannot send, and record every error in arrival order. */
function publishUnsendable(): { readonly errors: TheoClawDiscoveryError[]; firstAnnouncement: Promise<void> } {
  const errors: TheoClawDiscoveryError[] = []
  let timer: NodeJS.Timeout | undefined
  const firstAnnouncement = new Promise<void>((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no EACCES with route send-respond within ${DEADLINE_MS} ms: ${JSON.stringify(errors)}`)),
      DEADLINE_MS,
    )
    publisher = createBonjourPublisher({
      ip: '255.255.255.255',
      onError: (error) => {
        errors.push(error)
        if (error.route === 'send-respond') resolve()
      },
    })
  }).finally(() => clearTimeout(timer))
  publisher?.publish({
    name: `announce-route-${randomUUID()}`,
    type: 'theoclaw',
    port: 40000,
    txt: { path: '/control' },
  })
  return { errors, firstAnnouncement }
}

describe.skipIf(!LIVE)('the adapter observes every send', () => {
  it('an announcement send failure reaches onError and the process lives', async () => {
    const { errors, firstAnnouncement } = publishUnsendable()

    await firstAnnouncement

    const announcement = errors.findIndex((error) => error.route === 'send-respond')
    expect(errors[announcement]?.code).toBe('EACCES')
    // The probe's queries go out, and fail, before the first announcement.
    const probe = errors.findIndex((error) => error.route === 'send-query')
    expect(probe).toBeGreaterThanOrEqual(0)
    expect(probe).toBeLessThan(announcement)
    expect(errors[probe]?.code).toBe('EACCES')
  })

  it('a goodbye send failure rejects unpublishAll', async () => {
    const { firstAnnouncement } = publishUnsendable()
    // A goodbye is sent only for a service the library marked active, after its first announcement.
    await firstAnnouncement

    await expect(publisher?.unpublishAll()).rejects.toMatchObject({ name: 'TheoClawDiscoveryError', code: 'EACCES' })
  })
})
