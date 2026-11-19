import { execFile } from 'node:child_process'

export interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Resolves with the exit code; never rejects on a non-zero exit. A command that cannot start is code 127. */
export type Runner = (command: string, args: readonly string[]) => Promise<RunResult>

/** The runner of the real process: `execFile`. */
export const runCommand: Runner = (command, args) =>
  new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr })
          return
        }
        const code = typeof error.code === 'number' ? error.code : 127
        resolve({ code, stdout, stderr: stderr || error.message })
      },
    )
  })
