// B-396 — the durable store behind the scheduler. The SDK `Cron` keeps its jobs in a process
// `Map`, so a job created there is gone on the next start; this file is what survives it.
/* eslint-disable security/detect-non-literal-fs-filename --
   every path here is the one store file the caller chose (the app passes `<workspace>/.theoclaw/schedules.json`)
   or its temporary sibling; nothing in a path comes from a job, a prompt or a model answer */
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { TheokitAgentError } from '@theokit/sdk/errors'

/** Where a scheduled job's answer is sent: one platform and one channel on it. */
export interface ScheduleTarget {
  platform: string
  channelId: string
}

/** One durable scheduled job, as kept in the store's file. */
export interface ScheduledJob {
  id: string
  name?: string
  /** A 5-field cron expression or a shorthand (`@hourly`, `@daily`, ...). */
  cron: string
  /** An IANA timezone; the SDK's default (`UTC`) when absent. */
  timezone?: string
  prompt: string
  target: ScheduleTarget
  /** The last run's answer, carried into the next run's prompt. */
  previousOutput?: string
  createdAt: number
}

/** The durable job store: reads are synchronous over the loaded state, writes are saved in order. */
export interface JobStore {
  list(): ScheduledJob[]
  get(id: string): ScheduledJob | undefined
  put(job: ScheduledJob): Promise<void>
  /** Resolves `true` when the job was held and is now gone. */
  remove(id: string): Promise<boolean>
  /** Resolves `false`, and changes nothing, when the job is no longer held (a cancel won the race). */
  setPreviousOutput(id: string, text: string): Promise<boolean>
}

/**
 * A store file that cannot be read as jobs. The message names the file and what is wrong. Not
 * retryable: the same file is refused the same way until somebody edits it.
 */
export class ScheduleStoreError extends TheokitAgentError {
  override readonly name = 'ScheduleStoreError'
  readonly file: string

  constructor(file: string, detail: string) {
    super(`${file}: ${detail}`, { code: 'SCHEDULE_STORE_INVALID', isRetryable: false })
    this.file = file
  }
}

const STORE_VERSION = 1
const FILE_MODE = 0o600
const DIRECTORY_MODE = 0o700

let tempCounter = 0

/**
 * Open the store at `filePath`. An absent file is an empty store; a file that does not parse, has
 * another version, or holds a job missing a required field raises {@link ScheduleStoreError}.
 * Every mutation writes a temporary file with mode 0600 beside it and renames it over the file, and
 * mutations run one after another, so the file is always whole.
 */
export async function createJobStore(filePath: string): Promise<JobStore> {
  const jobs = new Map<string, ScheduledJob>()
  for (const job of await loadJobs(filePath)) jobs.set(job.id, job)

  let chain: Promise<unknown> = Promise.resolve()
  const serialized = <T>(mutation: () => T): Promise<T> => {
    const next = chain.then(async () => {
      const result = mutation()
      await saveJobs(filePath, [...jobs.values()])
      return result
    })
    chain = next.catch(() => undefined)
    return next
  }

  return {
    list: () => [...jobs.values()],
    get: (id) => jobs.get(id),
    put: (job) =>
      serialized(() => {
        jobs.set(job.id, job)
      }),
    remove: (id) => serialized(() => jobs.delete(id)),
    setPreviousOutput: (id, text) =>
      serialized(() => {
        const held = jobs.get(id)
        if (held === undefined) return false
        jobs.set(id, { ...held, previousOutput: text })
        return true
      }),
  }
}

async function loadJobs(filePath: string): Promise<ScheduledJob[]> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ScheduleStoreError(filePath, `not JSON (${(error as Error).message})`)
  }
  if (!isRecord(parsed)) throw new ScheduleStoreError(filePath, 'not a JSON object')
  if (parsed.version !== STORE_VERSION) {
    throw new ScheduleStoreError(
      filePath,
      `unknown store version ${JSON.stringify(parsed.version)} (expected ${String(STORE_VERSION)})`,
    )
  }
  if (!Array.isArray(parsed.jobs)) throw new ScheduleStoreError(filePath, 'has no jobs array')
  return parsed.jobs.map((raw, index) => readJob(filePath, raw, index))
}

function readJob(filePath: string, raw: unknown, index: number): ScheduledJob {
  const fail = (detail: string): never => {
    throw new ScheduleStoreError(filePath, `job ${String(index)} ${detail}`)
  }
  if (!isRecord(raw)) return fail('is not an object')
  for (const key of ['id', 'cron', 'prompt'] as const) {
    if (!isNonEmptyString(raw[key])) fail(`has no ${key}`)
  }
  const target = raw.target
  if (!isRecord(target)) return fail('has no target')
  if (!isNonEmptyString(target.platform)) fail('has no target.platform')
  if (!isNonEmptyString(target.channelId)) fail('has no target.channelId')
  for (const key of ['name', 'timezone', 'previousOutput'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string')
      fail(`has a ${key} that is not a string`)
  }
  if (typeof raw.createdAt !== 'number') fail('has no createdAt')
  return raw as unknown as ScheduledJob
}

async function saveJobs(filePath: string, jobs: ScheduledJob[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: DIRECTORY_MODE })
  tempCounter += 1
  const temp = `${filePath}.${String(process.pid)}.${String(tempCounter)}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify({ version: STORE_VERSION, jobs }, null, 2)}\n`, {
      mode: FILE_MODE,
    })
    // `mode` on writeFile is masked by the umask; the store holds prompts and outputs, so 0600 is set.
    await chmod(temp, FILE_MODE)
    await rename(temp, filePath)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
