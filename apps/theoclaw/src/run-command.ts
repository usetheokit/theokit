import { execFile } from 'node:child_process'

import { describeError } from './control-plane/errors.js'

/**
 * The process port of the `theoclaw` command (B-374): `daemon` drives systemctl and loginctl
 * through it, `update` drives git and install.sh, and the tests inject their own.
 */

export interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Runs one command and resolves with its exit code and output; it never rejects on a non-zero exit. */
export type Runner = (command: string, args: readonly string[]) => Promise<RunResult>

/** The command runner of the real process: `execFile`, with a command that cannot start as 127. */
export const runCommand: Runner = (command, args) =>
  new Promise((settle) => {
    // 64 MiB: `update` runs install.sh through this runner, and pnpm's install output is long.
    execFile(command, [...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) return settle({ code: 0, stdout, stderr })
      const code = typeof error.code === 'number' ? error.code : 127
      settle({ code, stdout, stderr: stderr || describeError(error) })
    })
  })
