import { describe, expect, it } from 'vitest'

import { prepareJobBackend } from '../../packages/theo/src/cli/commands/start/job-bootstrap.js'
import type { JobBackend } from '../../packages/theo/src/server/jobs/job-backend.js'

/**
 * A boot that cannot create the job table fails (usetheokit/theokit#1072), and the message has to
 * say why. `pg` connecting to `localhost` tries `::1` and `127.0.0.1` and rejects with an
 * `AggregateError` whose own message is empty, so on the CI runner the boot printed
 * "could not create its storage at boot: ." and nothing else.
 */
function backendFailingWith(err: Error): JobBackend {
  return {
    name: 'postgres',
    enqueue: () => Promise.resolve({ jobId: 'x' }),
    dequeue: () => Promise.resolve([]),
    ack: () => Promise.resolve(),
    nack: () => Promise.resolve(),
    migrate: () => Promise.reject(err),
  }
}

describe('a failed job backend setup names its cause', () => {
  it('test_an_aggregate_connection_error_lists_each_attempt', async () => {
    const refused = new AggregateError(
      [new Error('connect ECONNREFUSED ::1:1'), new Error('connect ECONNREFUSED 127.0.0.1:1')],
      // eslint-disable-next-line unicorn/error-message -- the empty message is what pg rejects with
      '',
    )
    const boot = prepareJobBackend({ jobs: { backend: backendFailingWith(refused) } as never })
    await expect(boot).rejects.toMatchObject({ code: 'JOB_BACKEND_SETUP_FAILED' })
    await expect(boot).rejects.toThrow(
      /connect ECONNREFUSED ::1:1; connect ECONNREFUSED 127\.0\.0\.1:1/,
    )
  })

  it('test_an_error_without_a_message_falls_back_to_its_code', async () => {
    // eslint-disable-next-line unicorn/error-message -- an error that carries only a code
    const coded = Object.assign(new Error(''), { code: 'ECONNRESET' })
    await expect(
      prepareJobBackend({ jobs: { backend: backendFailingWith(coded) } as never }),
    ).rejects.toThrow(/ECONNRESET/)
  })
})
