import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseDuration } from './duration.mjs'

test('seconds', () => assert.equal(parseDuration('45s'), 45_000))
test('minutes', () => assert.equal(parseDuration('2m'), 120_000))
test('hours', () => assert.equal(parseDuration('1h'), 3_600_000))
test('days', () => assert.equal(parseDuration('1d'), 86_400_000))
test('milliseconds', () => assert.equal(parseDuration('250ms'), 250))
test('hours and minutes', () => assert.equal(parseDuration('1h30m'), 5_400_000))
test('a zero unit in the middle', () => assert.equal(parseDuration('1h0m5s'), 3_605_000))
test('spaces between units', () => assert.equal(parseDuration('1h 30m'), 5_400_000))
test('an empty string is refused', () => assert.throws(() => parseDuration(''), RangeError))
test('an unknown unit is refused', () => assert.throws(() => parseDuration('5x'), RangeError))
