import { describe, expect, it } from 'vitest'

import { teamReportJob, type ReportFetch } from '../src/scheduler/team-report.js'

describe('team report', () => {
  it('is off when unset and builds a prompt naming merged PRs', async () => {
    expect(teamReportJob({}, ['telegram'])).toBeUndefined()
    const urls: string[] = []
    const fetcher: ReportFetch = (url) => {
      urls.push(url)
      const body = url.includes('github')
        ? { items: [{ number: 7, title: 'Fix login', user: { login: 'ana' } }] }
        : [{ content: 'shipped it', timestamp: '2026-11-10T10:00:00Z', author: { username: 'bo' } }]
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    }
    const job = teamReportJob(
      {
        THEOCLAW_TEAM_REPORT: '0 8 * * * telegram:42',
        THEOCLAW_TEAM_REPORT_GITHUB_REPO: 'a/b',
        THEOCLAW_TEAM_REPORT_DISCORD_CHANNEL: '9',
        THEOCLAW_TEAM_REPORT_DISCORD_TOKEN: 't',
      },
      ['telegram'],
      fetcher,
      () => new Date('2026-11-11T08:00:00Z'),
    )
    expect(job?.target).toEqual({ platform: 'telegram', channelId: '42' })
    const prompt = await job?.prompt()
    expect(prompt).toContain('#7 Fix login (by ana)')
    expect(prompt).toContain('bo: shipped it')
    expect(urls[0]).toContain('merged%3A%3E%3D2026-11-10T08%3A00%3A00Z')
  })

  it('refuses a missing repo', () => {
    expect(() =>
      teamReportJob({ THEOCLAW_TEAM_REPORT: '0 8 * * * telegram:42' }, ['telegram']),
    ).toThrow(/GITHUB_REPO/)
  })
})
