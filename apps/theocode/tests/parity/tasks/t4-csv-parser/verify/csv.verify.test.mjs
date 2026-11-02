// The verification of the CSV task: one case per spec rule, then four probes the spec never states.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseCsv } from './csv.mjs'

test('rule 1: commas separate fields', () => assert.deepEqual(parseCsv('a,b,c'), [['a', 'b', 'c']]))
test('rule 2: CRLF and LF separate records', () =>
  assert.deepEqual(parseCsv('a,b\r\nc,d\ne,f'), [['a', 'b'], ['c', 'd'], ['e', 'f']]))
test('rule 3: a quoted field keeps its comma and line break', () =>
  assert.deepEqual(parseCsv('"a,b","c\nd"'), [['a,b', 'c\nd']]))
test('rule 4: a doubled quote is one quote', () =>
  assert.deepEqual(parseCsv('"say ""hi"""'), [['say "hi"']]))
test('rule 5: a trailing line break adds no record', () =>
  assert.deepEqual(parseCsv('a,b\n'), [['a', 'b']]))
test('probe: empty fields survive', () => assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']]))
test('probe: a quoted empty field is an empty string', () =>
  assert.deepEqual(parseCsv('"",x'), [['', 'x']]))
test('probe: a CRLF inside quotes is kept as written', () =>
  assert.deepEqual(parseCsv('"a\r\nb",c'), [['a\r\nb', 'c']]))
test('probe: a trailing comma ends with an empty field', () =>
  assert.deepEqual(parseCsv('a,b,'), [['a', 'b', '']]))
