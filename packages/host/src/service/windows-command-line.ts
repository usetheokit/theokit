/**
 * Quote one argument so `CommandLineToArgvW` (and the C runtime) give back exactly `arg`:
 * backslashes are literal except before a `"`, where they are doubled, and `"` becomes `\"`.
 */
export function quoteWindowsArg(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg
  let out = '"'
  let backslashes = 0
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++
    } else if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"'
      backslashes = 0
    } else {
      out += '\\'.repeat(backslashes) + ch
      backslashes = 0
    }
  }
  return out + '\\'.repeat(backslashes * 2) + '"'
}

/** The arguments of a command line, each quoted by `quoteWindowsArg`. */
export function windowsCommandLine(args: readonly string[]): string {
  return args.map(quoteWindowsArg).join(' ')
}

/** A PowerShell single-quoted string literal: the only way a value enters a script. */
export function quotePowerShell(text: string): string {
  return `'${text.replaceAll("'", "''")}'`
}
