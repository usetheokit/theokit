import { readFile } from 'node:fs/promises'

export interface LogsOptions {
  /** How many trailing lines to return; a positive integer, default 200. */
  readonly lines?: number
}

export const DEFAULT_LOG_LINES = 200

export function logLines(options: LogsOptions | undefined): number {
  const lines = options?.lines ?? DEFAULT_LOG_LINES
  if (!Number.isInteger(lines) || lines < 1)
    throw new RangeError('lines must be a positive integer')
  return lines
}

/** The last `lines` lines of a file; '' when the file does not exist. */
export async function tailFile(path: string, lines: number): Promise<string> {
  let text: string
  try {
    // The path is the log file the caller configured.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
  const all = text.split('\n')
  if (all.at(-1) === '') all.pop()
  return all.slice(-lines).join('\n')
}
