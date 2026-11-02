// The verification of the money-ledger task. The first five cases are the spec's requirements; the
// last four probe PAST the spec's one example (0.1 + 0.2), which is how the 2026-08-25 run caught a
// solution that hard-coded two decimal places.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Ledger } from './ledger.mjs'

const ledgerOf = (...deposits) => {
  const ledger = new Ledger()
  for (const amount of deposits) ledger.deposit(amount)
  return ledger
}

test('a deposit raises the balance', () => assert.equal(ledgerOf(5).balance(), 5))
test('a non-positive deposit is refused', () => {
  assert.throws(() => new Ledger().deposit(0), RangeError)
  assert.throws(() => new Ledger().deposit(-1), RangeError)
})
test('a withdrawal above the balance is refused and changes nothing', () => {
  const ledger = ledgerOf(5)
  assert.throws(() => ledger.withdraw(6), RangeError)
  assert.equal(ledger.balance(), 5)
})
test('0.1 + 0.2 is exactly 0.3', () => assert.equal(ledgerOf(0.1, 0.2).balance(), 0.3))
test('history lists accepted operations in order', () => {
  const ledger = ledgerOf(5)
  ledger.withdraw(2)
  assert.deepEqual(ledger.history(), [
    { type: 'deposit', amount: 5 },
    { type: 'withdraw', amount: 2 },
  ])
})
test('probe: 0.001 + 0.002 is 0.003', () => assert.equal(ledgerOf(0.001, 0.002).balance(), 0.003))
test('probe: 0.005 + 0.005 is 0.01', () => assert.equal(ledgerOf(0.005, 0.005).balance(), 0.01))
test('probe: 0.0001 three times is 0.0003', () =>
  assert.equal(ledgerOf(0.0001, 0.0001, 0.0001).balance(), 0.0003))
test('probe: withdrawing 0.3 after 0.1 + 0.2 leaves 0', () => {
  const ledger = ledgerOf(0.1, 0.2)
  ledger.withdraw(0.3)
  assert.equal(ledger.balance(), 0)
})
