import { describe, it, expect } from 'vitest'

describe('Tasks API', () => {
  it('GET /api/tasks returns array', async () => {
    const res = await fetch('http://localhost:3000/api/tasks')
    expect(res.status).toBe(200)
    const tasks = await res.json()
    expect(Array.isArray(tasks)).toBe(true)
  })
})
