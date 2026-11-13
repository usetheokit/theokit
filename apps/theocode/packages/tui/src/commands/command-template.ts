const SHELL_REGEX = /!`([^`]+)`/g
const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g
const PLACEHOLDER_REGEX = /\$(\d+)/g
const ARGS_REGEX = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const QUOTE_TRIM_REGEX = /^["']|["']$/g

const FILE_INLINE_CAP = 64 * 1024

interface ShellResult {
  text: string
  ok: boolean
}

export interface TemplateDeps {
  shell: (cmd: string) => Promise<ShellResult>
  readFile: (name: string) => string | undefined
  warn: (message: string) => void
}

function splitArgs(rawArgs: string): string[] {
  const raw = rawArgs.match(ARGS_REGEX) ?? []
  return raw.map((arg) => arg.replace(QUOTE_TRIM_REGEX, ''))
}

export function hints(template: string): string[] {
  const result: string[] = []
  const numbered = template.match(/\$\d+/g)
  if (numbered) {
    for (const match of [...new Set(numbered)].sort()) result.push(match)
  }
  if (template.includes('$ARGUMENTS')) result.push('$ARGUMENTS')
  return result
}

async function injectShell(text: string, deps: TemplateDeps): Promise<string> {
  const shellMatches = Array.from(text.matchAll(SHELL_REGEX))
  if (shellMatches.length === 0) return text
  const results = await Promise.all(
    shellMatches.map(async ([, cmd]) => {
      const result = await deps.shell(cmd ?? '')
      if (!result.ok)
        deps.warn(`[custom-command] shell \`${cmd}\` failed — injecting its output as-is`)
      return result.text
    }),
  )
  let index = 0
  return text.replace(SHELL_REGEX, () => results[index++] ?? '')
}

function inlineFiles(text: string, deps: TemplateDeps): string {
  const fileMatches = Array.from(text.matchAll(FILE_REGEX))
  if (fileMatches.length === 0) return text
  const contentByName = new Map<string, string | undefined>()
  const resolveContent = (name: string): string | undefined => {
    if (contentByName.has(name)) return contentByName.get(name)
    let content = deps.readFile(name)
    if (content !== undefined && content.length > FILE_INLINE_CAP) {
      content = content.slice(0, FILE_INLINE_CAP)
      deps.warn(`[custom-command] @${name} truncated to ${FILE_INLINE_CAP} UTF-16 code units`)
    }
    contentByName.set(name, content)
    return content
  }
  const segments: string[] = []
  let cursor = 0
  for (const match of fileMatches) {
    const name = match[1]
    const start = match.index ?? 0
    if (!name) continue
    const content = resolveContent(name)
    if (content === undefined) continue
    segments.push(text.slice(cursor, start))
    segments.push(`@${name}\n\`\`\`${name}\n${content}\n\`\`\``)
    cursor = start + match[0].length
  }
  segments.push(text.slice(cursor))
  return segments.join('')
}

export async function expandTemplate(
  template: string,
  rawArgs: string,
  deps: TemplateDeps,
): Promise<string> {
  const args = splitArgs(rawArgs)

  const placeholders = template.match(PLACEHOLDER_REGEX) ?? []
  let last = 0
  for (const item of placeholders) {
    const value = Number(item.slice(1))
    if (value > last) last = value
  }
  const withArgs = template.replaceAll(PLACEHOLDER_REGEX, (_, index: string) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ''
    if (position === last) return args.slice(argIndex).join(' ')
    return args[argIndex] ?? ''
  })

  const usesArgumentsPlaceholder = template.includes('$ARGUMENTS')
  let expanded = withArgs.replaceAll('$ARGUMENTS', rawArgs)
  if (placeholders.length === 0 && !usesArgumentsPlaceholder && rawArgs.trim()) {
    expanded = `${expanded}\n\n${rawArgs}`
  }

  expanded = await injectShell(expanded, deps)
  expanded = inlineFiles(expanded, deps)

  return expanded.trim()
}
