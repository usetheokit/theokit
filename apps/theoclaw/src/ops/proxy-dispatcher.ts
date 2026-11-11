import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici'

/**
 * Sends this process's global `fetch` through `THEOCLAW_PROXY_URL` (OC-131), explicitly, so it holds
 * on every supported Node 22 (`NODE_USE_ENV_PROXY` is only honoured from 22.21). Loopback stays direct.
 */
const direct = new Agent()

export function installProxyFromEnv(env: NodeJS.ProcessEnv): boolean {
  const url = env.THEOCLAW_PROXY_URL?.trim()
  if (!url) return false
  const proxy = new ProxyAgent(url)
  setGlobalDispatcher(
    proxy.compose((dispatch) => (opts, handler) => {
      const host = typeof opts.origin === 'string' ? new URL(opts.origin).hostname : String(opts.origin?.valueOf() ?? '')
      return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' ? direct.dispatch(opts, handler) : dispatch(opts, handler)
    }),
  )
  return true
}
