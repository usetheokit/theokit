import { describe, expect, it } from 'vitest'

import { launchdPlist, scheduledTaskXml } from '@theokit/host/service'

// Moved from daemon-launchd.test.ts when B-728 removed the local XML escaper.
describe('framework escaping in daemon definitions', () => {
  it('escapes plist text without escaping generated entities twice', () => {
    const escaped = launchdPlist(
      { label: 'l', command: '/n', args: ['/e'], env: { THEOCLAW_CONFIG: '/a&b/<c>' }, workingDirectory: '/it\'s "w"' },
      { logFile: '/log' },
    )
    expect(escaped).toContain('<string>/a&amp;b/&lt;c&gt;</string>')
    expect(escaped).toContain('<string>/it&apos;s &quot;w&quot;</string>')
    expect(escaped).not.toContain('&amp;amp;')
  })

  it('escapes Windows task text, including the principal and quoted arguments', () => {
    const xml = scheduledTaskXml(
      { label: 'a-b', description: 'TheoClaw (a<b>)', command: 'C:\\n', args: ['C:\\e', '--config', 'C:\\a&b\\<c> d'], workingDirectory: "C:\\it's \"w\"" },
      { user: "DOMAIN\\O'Reilly & co" },
    )
    expect(xml).toContain('<UserId>DOMAIN\\O&apos;Reilly &amp; co</UserId>')
    expect(xml).toContain('<Description>TheoClaw (a&lt;b&gt;)</Description>')
    expect(xml).toContain('&quot;C:\\a&amp;b\\&lt;c&gt; d&quot;')
    expect(xml).toContain('<WorkingDirectory>C:\\it&apos;s &quot;w&quot;</WorkingDirectory>')
    expect(xml).not.toContain('&amp;amp;')
  })
})
