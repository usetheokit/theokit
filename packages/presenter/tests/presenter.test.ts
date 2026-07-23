import { describe, expect, it } from 'vitest'

import type { AgentOutputEvent } from '../src/agent-output-event.js'
import { type Presenter, PresenterRegistry, UnknownPresenterError } from '../src/presenter.js'

// A trivial presenter: text → the raw string, everything else → nothing. Proves the contract shape.
const echoText: Presenter<string> = {
  surface: 'echo',
  present: (e: AgentOutputEvent) => (e.type === 'text' ? [e.text] : []),
}

describe('Presenter contract + registry (M49)', () => {
  it('a presenter maps a canonical event to zero-or-more surface chunks', () => {
    expect(echoText.present({ type: 'text', text: 'hello' })).toEqual(['hello'])
    expect(echoText.present({ type: 'finish' })).toEqual([])
  })

  it('registry resolves a registered presenter by surface key', () => {
    const reg = new PresenterRegistry().register(echoText)
    expect(reg.has('echo')).toBe(true)
    expect(reg.surfaces()).toEqual(['echo'])
    expect(reg.resolve<string>('echo')).toBe(echoText)
  })

  it('registry throws a typed error for an unknown surface (fail-fast, never undefined)', () => {
    const reg = new PresenterRegistry().register(echoText)
    expect(() => reg.resolve('nope')).toThrow(UnknownPresenterError)
    expect(() => reg.resolve('nope')).toThrow(/No presenter registered for surface "nope".*echo/)
  })

  it('register replaces on the same surface key (Open/Closed — swap without editing callers)', () => {
    const upper: Presenter<string> = {
      surface: 'echo',
      present: (e) => (e.type === 'text' ? [e.text.toUpperCase()] : []),
    }
    const reg = new PresenterRegistry().register(echoText).register(upper)
    expect(reg.resolve<string>('echo')).toBe(upper)
    expect(reg.surfaces()).toEqual(['echo']) // no duplicate key
  })
})
