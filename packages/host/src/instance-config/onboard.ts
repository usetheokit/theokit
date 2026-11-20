import { InstanceConfigError } from './errors.js'

import type { InstanceKey } from './index.js'

export interface OnboardIo {
  readonly stdin: NodeJS.ReadableStream & {
    isTTY?: boolean
    setRawMode?(mode: boolean): unknown
  }
  readonly stdout: NodeJS.WritableStream
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
}

export interface OnboardOptions<K extends string> {
  /** Non-interactive values; they take precedence over everything else. */
  readonly answers?: Partial<Record<K, string>>
  /** Key -> name of the environment variable holding its value (never the value itself). */
  readonly secretFromEnv?: Partial<Record<K, string>>
  readonly prompts?: Partial<Record<K, { question: string; default?: string }>>
  readonly validate?: (entries: Readonly<Record<K, string>>) => void
  readonly force?: boolean
  readonly interactive: boolean
}

/** Reads one line in raw mode; `echo` false writes nothing back. Raw mode is always turned off again. */
function readLine(io: OnboardIo, prompt: string, echo: boolean): Promise<string> {
  const input = io.stdin
  const setRawMode = input.setRawMode?.bind(input)
  if (setRawMode === undefined) return Promise.reject(needsTerminal())
  io.stdout.write(prompt)
  setRawMode(true)
  input.resume()
  return new Promise<string>((resolve, reject) => {
    let value = ''
    const cleanup = (): void => {
      input.removeListener('data', onData)
      input.removeListener('error', onError)
      try {
        setRawMode(false)
      } finally {
        input.pause()
        io.stdout.write('\n')
      }
    }
    const done = (settle: () => void): void => {
      cleanup()
      settle()
    }
    const onError = (error: Error): void => {
      done(() => {
        reject(
          new InstanceConfigError('instance_config_onboard_input', 'reading the answer failed', {
            cause: error,
          }),
        )
      })
    }
    const onData = (chunk: Buffer | string): void => {
      for (const character of chunk.toString()) {
        if (character === '\r' || character === '\n') {
          done(() => {
            resolve(value)
          })
          return
        }
        if (character === '\u0003') {
          done(() => {
            reject(
              new InstanceConfigError(
                'instance_config_onboard_interrupted',
                'onboarding was interrupted',
              ),
            )
          })
          return
        }
        if (character === '\u007f' || character === '\b') {
          if (echo && value.length > 0) io.stdout.write('\b \b')
          value = value.slice(0, -1)
        } else {
          value += character
          if (echo) io.stdout.write(character)
        }
      }
    }
    input.on('data', onData)
    input.on('error', onError)
  })
}

function needsTerminal(): InstanceConfigError {
  return new InstanceConfigError(
    'instance_config_onboard_no_terminal',
    'onboarding needs a terminal; pass the answers instead',
  )
}

function missing(key: string): InstanceConfigError {
  return new InstanceConfigError(
    'instance_config_onboard_missing_answer',
    `no answer was given for ${key}`,
  )
}

function fromEnv(key: string, variable: string, env: NodeJS.ProcessEnv): string {
  const value = env[variable]
  if (value === undefined || value === '') {
    throw new InstanceConfigError(
      'instance_config_onboard_env_unset',
      `${variable}, named for ${key}, is not set`,
      { variable },
    )
  }
  return value
}

export async function onboardInstanceConfig<K extends string>(
  keys: Readonly<Record<K, InstanceKey>>,
  resolvePath: (env: NodeJS.ProcessEnv, homeDir: string) => string,
  write: (
    path: string,
    entries: Readonly<Record<K, string>>,
    options: { force: boolean },
  ) => Promise<void>,
  io: OnboardIo,
  options: OnboardOptions<K>,
): Promise<{ path: string; written: readonly K[] }> {
  if (options.interactive && (io.stdin.isTTY !== true || io.stdin.setRawMode === undefined))
    throw needsTerminal()
  const path = resolvePath(io.env, io.homeDir)
  const names = Object.keys(keys) as K[]
  const entries = {} as Record<K, string>
  for (const key of names) {
    const given = options.answers?.[key]
    const variable = options.secretFromEnv?.[key]
    const prompt = options.prompts?.[key]
    if (given !== undefined) {
      entries[key] = given
    } else if (variable !== undefined) {
      entries[key] = fromEnv(key, variable, io.env)
    } else if (options.interactive) {
      const secret = keys[key].secret === true
      const fallback = prompt?.default
      // A secret's default is an unshown fallback; it is never printed.
      const shown = secret || fallback === undefined ? '' : ` [${fallback}]`
      const answer = (await readLine(io, `${prompt?.question ?? key}${shown}: `, !secret)).trim()
      if (answer !== '') entries[key] = answer
      else if (fallback !== undefined) entries[key] = fallback
      else throw missing(key)
    } else if (prompt?.default !== undefined) {
      entries[key] = prompt.default
    } else {
      throw missing(key)
    }
  }
  if (options.validate !== undefined) {
    try {
      options.validate(entries)
    } catch {
      // The callback's error may quote a value, so it is neither attached nor read.
      throw new InstanceConfigError(
        'instance_config_invalid_value',
        'the answers were refused by validate',
      )
    }
  }
  // write checks each key's parse and creates the path exclusively unless forced; no pre-check here.
  await write(path, entries, { force: options.force === true })
  return { path, written: names }
}
