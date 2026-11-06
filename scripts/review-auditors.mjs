import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const policy = JSON.parse(readFileSync(new URL('../rules/review-auditors.txt', import.meta.url), 'utf8'))

// Every path has an owner. Unknown paths receive delivery review; they are never silently skipped.
export function selectAuditors(files) {
  const selected = new Set()
  for (const file of files) {
    const owners = policy.auditors.filter(a => !a.fallbackOnly && !(a.name === 'loop-surface-closure' && /(^|\/)(tests?|__tests__)\/|\.(test|spec)\./.test(file)) && a.patterns.some(p => new RegExp(p, 'i').test(file)))
    for (const auditor of owners.length ? owners : policy.auditors.filter(a => a.fallbackOnly)) selected.add(auditor.name)
  }
  return policy.auditors.filter(a => selected.has(a.name))
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

export function runReview({ item, base, head = 'HEAD', statePath, invoke = (name, args) => execFileSync(name, args, { stdio: 'inherit' }) }) {
  if (!item || !base || !statePath) throw new Error('item, base and statePath are required')
  // One writer per item, including while a model is running. A stale lock requires inspection.
  const lock = openSync(`${statePath}.lock`, 'wx')
  try {
    const baseSha = git('rev-parse', '--verify', `${base}^{commit}`)
    const headSha = git('rev-parse', '--verify', `${head}^{commit}`)
    let state
    try { state = JSON.parse(readFileSync(statePath, 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      state = { item, base: baseSha, reservedUsd: 0, passes: [] }
    }
    if (state.item !== item || state.base !== baseSha) throw new Error('State belongs to a different item or base')
    if (!Number.isFinite(state.reservedUsd) || state.reservedUsd < 0 || !Array.isArray(state.passes)) throw new Error('Invalid budget state')
    const previous = state.lastHead ?? baseSha
    git('merge-base', '--is-ancestor', previous, headSha)
    const files = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', previous, headSha], { encoding: 'utf8' }).split('\0').filter(Boolean)
    const auditors = selectAuditors(files)
    const reservedUsd = auditors.reduce((sum, a) => sum + a.budgetUsd, 0)
    if (state.reservedUsd + reservedUsd > policy.itemCeilingUsd) throw new Error(`Item audit ceiling $${policy.itemCeilingUsd} exhausted`)
    // Reserve the entire pass durably before launching. Failed/crashed runs retain their reservation.
    state.reservedUsd += reservedUsd
    const pass = { head: headSha, since: previous, files, auditors: auditors.map(a => a.name), reservedUsd, status: 'running' }
    state.passes.push(pass)
    const save = () => writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
    save()
    for (const auditor of auditors) {
      invoke('claude', ['-p', `/${auditor.name} Review item ${item}, committed diff ${baseSha}..${headSha}. Own only your specialist domain. Report findings or explicitly report an incomplete audit when the budget runs out.`, '--max-budget-usd', String(auditor.budgetUsd)])
    }
    pass.status = 'completed'
    state.lastHead = headSha
    save()
    return pass
  } finally {
    closeSync(lock)
    unlinkSync(`${statePath}.lock`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [item, base, statePath, head] = process.argv.slice(2)
  console.log(JSON.stringify(runReview({ item, base, statePath, head }), null, 2))
}
