import { describe, expect, it } from 'vitest'
import { composeInstructions } from '../../src/config/compose-instructions.js'

describe('composeInstructions trim policies', () => {
  it('blocks-from-start drops whole blocks and never cuts inside one', () => {
    const rules = 'aaaa\n\n---\n\nbbbb\n\n---\n\ncccc'
    const r = composeInstructions(
      'B',
      [
        {
          name: 'rules',
          content: rules,
          trim: { kind: 'blocks-from-start', separator: '\n\n---\n\n' },
        },
      ],
      { maxChars: 12 },
    )
    expect(r.text).toBe('B\n\ncccc')
    expect(r.cuts).toEqual([{ name: 'rules', from: rules.length, to: 4 }])
  })

  it('keep-tail keeps the end of the source', () => {
    const r = composeInstructions(
      'B',
      [{ name: 'a', content: '0123456789', trim: { kind: 'keep-tail' } }],
      { maxChars: 8 },
    )
    expect(r.text).toBe('B\n\n56789')
    expect(r.trimmed).toBe('a')
  })

  it('a source content containing the separator text is not split unless its policy is blocks-from-start', () => {
    const content = 'top\n\n---\n\nnear the cwd'
    const r = composeInstructions('B', [{ name: 'agents', content, trim: { kind: 'keep-tail' } }], {
      maxChars: 16,
    })
    expect(r.text.endsWith('cwd')).toBe(true)
    expect(r.cuts.map((c) => c.name)).toEqual(['agents'])
  })

  it('cuts reports name, from and to for every source that lost characters, and nothing for one that fit', () => {
    const r = composeInstructions(
      'B',
      [
        { name: 'fits', content: 'ok' },
        { name: 'tail', content: 'abcdefgh', trim: { kind: 'keep-tail' } },
        { name: 'gone', content: 'xxxxxxxxxxxx' },
      ],
      { maxChars: 14 },
    )
    expect(r.dropped).toEqual(['gone'])
    expect(r.cuts).toEqual([
      { name: 'gone', from: 12, to: 0 },
      { name: 'tail', from: 8, to: 7 },
    ])
    expect(composeInstructions('B', [{ name: 'a', content: 'x' }], { maxChars: 100 }).cuts).toEqual(
      [],
    )
  })

  it('sources without trim compose exactly as before', () => {
    const r = composeInstructions(
      'B',
      [
        { name: 'a', content: 'aa' },
        { name: 'b', content: '0123456789' },
      ],
      { maxChars: 10 },
    )
    expect(r.text).toBe('B\n\naa\n\n012')
    expect(r.trimmed).toBe('b')
    expect(r.dropped).toEqual([])
  })
})
