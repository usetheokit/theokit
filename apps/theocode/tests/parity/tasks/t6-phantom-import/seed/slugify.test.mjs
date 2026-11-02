import assert from 'node:assert/strict'
import { test } from 'node:test'

import { slugify } from 'text-slugify'

test('slugify lowercases, drops punctuation and joins words with dashes', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world')
  assert.equal(slugify('  Many   spaces here  '), 'many-spaces-here')
})
