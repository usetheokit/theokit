import { describe, expect, it } from 'vitest'

import { plistFor } from '../src/daemon-launchd.js'
import { taskXml } from '../src/daemon-schtasks.js'

// Moved from daemon-launchd.test.ts when B-728 removed the local XML escaper.
describe('framework escaping in daemon definitions', () => {
  it('escapes plist text without escaping generated entities twice', () => {
    const escaped = plistFor({
      label: 'l',
      configPath: '/a&b/<c>',
      workingDirectory: '/it\'s "w"',
      nodePath: '/n',
      entryPath: '/e',
      logFile: '/log',
    })
    expect(escaped).toContain('<string>/a&amp;b/&lt;c&gt;</string>')
    expect(escaped).toContain('<string>/it&#39;s &quot;w&quot;</string>')
    expect(escaped).not.toContain('&amp;amp;')
  })

  it('escapes Windows task text, including the principal and quoted arguments', () => {
    const xml = taskXml({
      label: 'a<b>',
      user: "DOMAIN\\O'Reilly & co",
      nodePath: '/n',
      entryPath: '/e',
      configPath: '/a&b/<c>',
      workingDirectory: '/it\'s "w"',
    })
    expect(xml).toContain('<UserId>DOMAIN\\O&#39;Reilly &amp; co</UserId>')
    expect(xml).toContain('<Description>TheoClaw (a&lt;b&gt;)</Description>')
    expect(xml).toContain('&quot;/a&amp;b/&lt;c&gt;&quot;')
    expect(xml).toContain('<WorkingDirectory>/it&#39;s &quot;w&quot;</WorkingDirectory>')
    expect(xml).not.toContain('&amp;amp;')
  })
})
