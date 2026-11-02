import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createCart } from './cart.mjs'
import { applyCoupon } from './coupon.mjs'

test('two carts do not share their items', () => {
  const first = createCart()
  const second = createCart()
  first.add('book', 30)
  second.add('pen', 2)
  assert.equal(first.total(), 30)
  assert.equal(second.total(), 2)
})

test('a 10% coupon on 50 leaves 45', () => assert.equal(applyCoupon(50, 10), 45))

test('a coupon above 100% never makes the total negative', () => assert.equal(applyCoupon(50, 150), 0))
