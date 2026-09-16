#!/usr/bin/env node
/**
 * Report whether the upstream gaps four open issues wait on are still real.
 *
 * Those issues carry a `blocked` label and a comment naming what unblocks each. That naming is
 * prose: it is true when written and nothing re-checks it, so the day upstream publishes, the label
 * keeps saying "blocked" until a person happens to look. This repository has paid for that shape
 * before — a guarantee living only in a Definition of Done is not a gate.
 *
 * So the blocker is a QUESTION asked of the installed tree, not a sentence about it:
 *
 *     resolve the symlink, read the type, report present or absent
 *
 * Resolving the symlink first is the practice the `theokit` session arrived at after reporting a
 * type as absent from a version it was not reading — two trees, one package name. `readlink -f` is
 * one line and it is what makes the answer about the artifact rather than about the path.
 *
 * ADVISORY by design: exit 0 whatever it finds. A blocker that is still real is not a failure — it
 * is the expected state, and failing the build on someone else's release schedule would make this a
 * gate people disable. It prints, and `--json` lets a caller decide.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

/** Each blocker: the issue it holds, and the string whose presence in the installed types settles it. */
const BLOCKERS = [
  {
    issue: 83,
    what: 'compatSources on DiscoverSubagentsOptions',
    file: 'dist/subagents-loader.d.ts',
    // The whole block, not the file: `compatSources` appears in prose elsewhere, and a match in a
    // docblock would report a door that is not in the signature.
    within: 'interface DiscoverSubagentsOptions',
    needle: 'compatSources',
  },
  {
    issue: 65,
    what: 'loadSkillInstructions',
    file: 'dist/skills.d.ts',
    needle: 'loadSkillInstructions',
  },
  {
    issue: 80,
    what: 'withheldBuiltinTools on SubAgentSpec',
    file: 'dist/a2a/subagent.d.ts',
    within: 'interface SubAgentSpec',
    needle: 'withheldBuiltinTools',
  },
]

function blockOf(text, header) {
  const start = text.indexOf(header)
  if (start < 0) return ''
  const end = text.indexOf('\n}', start)
  return end < 0 ? text.slice(start) : text.slice(start, end)
}

// A path may be given so the check can be pointed at a candidate build — which is also how it was
// proven to report the other state before being trusted. Flags are skipped, never treated as a path.
const given = process.argv.slice(2).find((a) => !a.startsWith('--'))
const root = realpathSync(given ?? 'node_modules/@theokit/sdk')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

const results = BLOCKERS.map((b) => {
  const path = join(root, b.file)
  if (!existsSync(path)) return { ...b, present: false, note: 'file absent' }
  const text = readFileSync(path, 'utf8')
  const scope = b.within === undefined ? text : blockOf(text, b.within)
  return { ...b, present: scope.includes(b.needle) }
})

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ sdk: version, blockers: results }, null, 2)}\n`)
} else {
  process.stdout.write(`@theokit/sdk resolves to ${version}\n`)
  for (const r of results) {
    const mark = r.present ? 'LANDED  ' : 'blocked '
    process.stdout.write(`  ${mark} #${String(r.issue)}  ${r.what}\n`)
  }
  const landed = results.filter((r) => r.present)
  process.stdout.write(
    landed.length === 0
      ? '\nAll upstream gaps are still real. The `blocked` labels are accurate.\n'
      : `\n${String(landed.length)} landed — re-measure and close: ${landed.map((r) => `#${String(r.issue)}`).join(', ')}\n`,
  )
}
