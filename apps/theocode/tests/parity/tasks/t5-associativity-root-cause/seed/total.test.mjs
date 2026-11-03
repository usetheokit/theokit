import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyDiscount } from './discount.mjs'
import { applyTax } from './tax.mjs'
import { total } from './total.mjs'

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

test('a 10% discount on 100 is 90', () => near(applyDiscount(100, 0.1), 90))
test('no tax on zero', () => near(applyTax(0, 0.2), 0))
test('10% tax on 100 is 110', () => near(applyTax(100, 0.1), 110))
test('100 with 10% off and 10% tax is 99', () => near(total(100, 0.1, 0.1), 99))
test('200 with 50% off and 20% tax is 120', () => near(total(200, 0.5, 0.2), 120))
