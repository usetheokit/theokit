import { HostError } from './host-error.js'

export interface HostService {
  readonly name: string
  start(): void | Promise<void>
  stop(): void | Promise<void>
}

export interface HostLifecycle {
  /** Starts services in order. If one fails, the ones already started are stopped in reverse and the error is rethrown as a HostError. */
  start(): Promise<void>
  /** Stops started services in reverse order. Every stop runs; failures are collected into one HostError. */
  stop(): Promise<void>
}

export function createHostLifecycle(services: readonly HostService[]): HostLifecycle {
  const started: HostService[] = []

  async function stopAll(): Promise<unknown[]> {
    const failures: unknown[] = []
    while (started.length > 0) {
      const service = started.pop() as HostService
      try {
        await service.stop()
      } catch (error) {
        failures.push(error)
      }
    }
    return failures
  }

  return {
    async start() {
      if (started.length > 0) throw new HostError('host_already_started', 'Host already started')
      for (const service of services) {
        try {
          await service.start()
          started.push(service)
        } catch (error) {
          await stopAll()
          throw new HostError('host_start_failed', `Service "${service.name}" failed to start`, {
            cause: error,
          })
        }
      }
    },
    async stop() {
      const failures = await stopAll()
      if (failures.length > 0) {
        throw new HostError('host_stop_failed', `${failures.length} service(s) failed to stop`, {
          cause: new AggregateError(failures),
        })
      }
    },
  }
}
