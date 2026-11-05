import { loadConfiguration } from './config-file.js'
import { requireModel } from './control-plane/settings.js'

/** A bounded credential probe. Provider bodies and thrown errors are never printed. */
export async function doctor(
  env: NodeJS.ProcessEnv,
  write: (line: string) => void,
  probe: typeof fetch = fetch,
): Promise<number> {
  try {
    const { modelKey } = requireModel(env)
    const response = await probe('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${modelKey}` },
      signal: AbortSignal.timeout(10_000),
    })
    await response.body?.cancel()
    if (!response.ok) throw new Error('credential rejected')
    write('doctor: credential accepted\n')
    return 0
  } catch {
    write('doctor: credential verification failed\n')
    return 1
  }
}

export async function doctorCommand(args: readonly string[], io: { env: NodeJS.ProcessEnv; homeDir: string; stdout: { write(text: string): unknown } }): Promise<number> {
  if (args.length > 0) return 2
  const env = { ...io.env }
  try { loadConfiguration(env, io.homeDir) } catch { io.stdout.write('doctor: configuration unavailable\n'); return 1 }
  return doctor(env, (line) => { io.stdout.write(line) })
}
