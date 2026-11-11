/** The WebChat language for the tab's life: `sessionStorage`, falling back to memory where storage is refused. */
const KEY = 'theoclaw.webchat.locale'
const SUPPORTED = ['en', 'sv']

let inMemory = 'en'

export function readLocale(): string {
  try {
    const stored = sessionStorage.getItem(KEY)
    if (stored !== null && SUPPORTED.includes(stored)) return stored
  } catch {
    // Storage refused: the in-memory copy is all there is.
  }
  return inMemory
}

export function writeLocale(locale: string): void {
  if (!SUPPORTED.includes(locale)) return
  inMemory = locale
  try {
    sessionStorage.setItem(KEY, locale)
  } catch {
    // Storage refused: the choice lives in memory until the page closes.
  }
}
