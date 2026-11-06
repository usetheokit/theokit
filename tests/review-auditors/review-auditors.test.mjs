import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { policy, selectAuditors, runReview } from '../../scripts/review-auditors.mjs'

const names = (files) => selectAuditors(files).map((a) => a.name)

test('six specialists reserve $10, below the reasoned $20 lifetime ceiling', () => {
  assert.equal(policy.itemCeilingUsd, 20)
  assert.match(policy.reason, /B-420/)
  assert.equal(
    policy.auditors.reduce((sum, a) => sum + a.budgetUsd, 0),
    10,
  )
  assert.ok(policy.auditors.every((a) => a.budgetUsd > 0))
  assert.ok(!policy.auditors.some((a) => a.name === 'loop-code-review'))
})

test('test fixes select tests alone; mixed and unknown paths retain their owners', () => {
  assert.deepEqual(names(['tests/unit/example.test.ts']), ['loop-test-audit'])
  assert.deepEqual(names(['packages/agents/tests/unit/example.test.ts']), ['loop-test-audit'])
  assert.deepEqual(names(['src/auth.ts', 'scripts/build.mjs']), [
    'loop-security-audit',
    'loop-infra-audit',
  ])
  assert.deepEqual(names(['README.md']), ['loop-delivery-audit'])
  assert.deepEqual(names([]), [])
})

test('real B-429 test-only fix selects only test auditor, reserves before invocation and skips unchanged head', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-auditors-'))
  const statePath = join(dir, 'item.json')
  try {
    const calls = []
    const options = {
      item: 'B-429',
      base: 'e3d90dc3^',
      head: 'e3d90dc3',
      statePath,
      invoke: (command, args) => {
        const state = JSON.parse(readFileSync(statePath, 'utf8'))
        assert.equal(state.reservedUsd, 2)
        assert.equal(state.passes[0].status, 'running')
        calls.push({ command, args })
      },
    }
    const pass = runReview(options)
    assert.deepEqual(pass.auditors, ['loop-test-audit'])
    assert.ok(pass.files.length > 0)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].command, 'claude')
    assert.deepEqual(calls[0].args.slice(-2), ['--max-budget-usd', '2'])
    runReview(options)
    assert.equal(calls.length, 1)
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.reservedUsd = 20
    delete state.lastHead
    writeFileSync(statePath, JSON.stringify(state))
    assert.throws(() => runReview(options), /ceiling/)
    assert.equal(calls.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('failed invocations keep their reservation and do not advance the successful head', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-auditors-'))
  const statePath = join(dir, 'item.json')
  try {
    const options = {
      item: 'B-429',
      base: 'e3d90dc3^',
      head: 'e3d90dc3',
      statePath,
      invoke: () => {
        throw new Error('offline failure')
      },
    }
    assert.throws(() => runReview(options), /offline failure/)
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(state.reservedUsd, 2)
    assert.equal(state.lastHead, undefined)
    assert.throws(() => runReview({ ...options, item: 'other' }), /different item/)
    assert.throws(() => runReview(options), /offline failure/)
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).reservedUsd, 4)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a completed prior pass is followed by only the B-429 fix domain, not the original auditor set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-auditors-'))
  const statePath = join(dir, 'item.json')
  try {
    const calls = []
    const options = {
      item: 'B-429-replay',
      base: 'e3d90dc3^^',
      statePath,
      invoke: (_command, args) => calls.push(args[1]),
    }
    runReview({ ...options, head: 'e3d90dc3^' })
    calls.length = 0
    const fix = runReview({ ...options, head: 'e3d90dc3' })
    assert.deepEqual(fix.auditors, ['loop-test-audit'])
    assert.equal(fix.reservedUsd, 2)
    assert.equal(calls.length, 1)
    assert.match(calls[0], /^\/loop-test-audit /)
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).passes.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
