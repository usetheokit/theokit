import { describe, expect, it } from 'vitest'

import { scheduledTaskXml, ServiceDefinitionError } from '../../src/service/index.js'
import { quotePowerShell, quoteWindowsArg } from '../../src/service/windows-command-line.js'

const spec = {
  label: 'my-agent',
  command: 'C:\\Program Files\\nodejs\\node.exe',
  args: ['C:\\app\\main.js', '--profile', 'a b'],
  workingDirectory: 'C:\\app\\',
}

/** CommandLineToArgvW for a line of quoted arguments (the post-1997 rules). */
function parse(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  let started = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '\\') {
      let n = 0
      while (line[i] === '\\') (n++, i++)
      if (line[i] === '"') {
        cur += '\\'.repeat(n >> 1)
        if (n % 2 === 1) cur += '"'
        else inQuote = !inQuote
      } else {
        cur += '\\'.repeat(n)
        i--
      }
      started = true
    } else if (ch === '"') {
      inQuote = !inQuote
      started = true
    } else if (/\s/.test(ch) && !inQuote) {
      if (started) out.push(cur)
      cur = ''
      started = false
    } else {
      cur += ch
      started = true
    }
  }
  if (started) out.push(cur)
  return out
}

describe('scheduledTaskXml', () => {
  it('declares UTF-16 and carries the task settings', () => {
    const xml = scheduledTaskXml(spec, { user: 'HOST\\me' })
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>')).toBe(true)
    expect(xml).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>')
    expect(xml).toContain('<LogonType>InteractiveToken</LogonType>')
    expect(xml).toContain('<RunLevel>LeastPrivilege</RunLevel>')
    expect(xml).toContain('<Interval>PT1M</Interval>')
    expect(xml).toContain('<WorkingDirectory>C:\\app\\</WorkingDirectory>')
  })

  it('escapes every value', () => {
    const xml = scheduledTaskXml(
      { ...spec, description: '<d>&', args: ['a"<b>&\''] },
      { user: 'a<b>&"\'' },
    )
    expect(xml).toContain('<Description>&lt;d&gt;&amp;</Description>')
    expect(xml).toContain('<UserId>a&lt;b&gt;&amp;&quot;&apos;</UserId>')
    expect(xml).toContain('&lt;b&gt;&amp;&apos;')
    expect(xml).not.toMatch(/<b>/)
  })

  it('rejects a label with a quote', () => {
    expect(() => scheduledTaskXml({ ...spec, label: "a'b" }, { user: 'u' })).toThrow(
      ServiceDefinitionError,
    )
  })
})

describe('quoteWindowsArg', () => {
  const cases = [
    'plain',
    '',
    'a b',
    'say "hi"',
    'C:\\dir with space\\',
    'C:\\dir\\',
    'a\\"b',
    'a\\\\"b c',
    'tab\there',
    '--profile=x y',
  ]
  it.each(cases)('round-trips %j', (arg) => {
    expect(parse(quoteWindowsArg(arg))).toEqual([arg])
  })

  it('quotes a space and a quote, leaves a plain word', () => {
    expect(quoteWindowsArg('a b')).toBe('"a b"')
    expect(quoteWindowsArg('a"b')).toBe('"a\\"b"')
    expect(quoteWindowsArg('plain')).toBe('plain')
  })

  it('doubles the quote in a PowerShell literal', () => {
    expect(quotePowerShell("a'b")).toBe("'a''b'")
  })
})
