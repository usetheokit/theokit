/**
 * Where the page keeps the WebChat token for the tab's life: `sessionStorage`, which ends with the
 * tab, falling back to memory where storage is refused (a private window, blocked site data).
 */
const KEY = 'theoclaw.webchat.token'

let inMemory: string | undefined

export function readToken(): string | undefined {
  try {
    return sessionStorage.getItem(KEY) ?? inMemory
  } catch {
    // Storage refused: the in-memory copy is all there is.
    return inMemory
  }
}

export function writeToken(token: string): void {
  inMemory = token
  try {
    sessionStorage.setItem(KEY, token)
  } catch {
    // Storage refused: the token lives in memory until the page closes.
  }
}
