'use client'

import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'

interface Task {
  id: number
  title: string
  priority: 'high' | 'medium' | 'low'
  done: boolean
}
type Role = '' | 'user' | 'admin'
interface ChatMsg {
  role: 'user' | 'agent' | 'tool' | 'system' | 'error'
  text: string
}

export default function Page() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [role, setRole] = useState<Role>('user')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('medium')
  const [formError, setFormError] = useState('')
  const [chat, setChat] = useState<ChatMsg[]>([
    { role: 'system', text: 'Ask me to list, create, or complete tasks...' },
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  const hdrs = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (role) h['x-role'] = role
    return h
  }, [role])

  const loadTasks = useCallback(async () => {
    const res = await fetch('/api/tasks')
    if (res.ok) setTasks(await res.json())
  }, [])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  const createTask = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!title.trim()) return
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ title, priority }),
    })
    if (res.status === 403) {
      setFormError('403 — Need User role')
      return
    }
    if (!res.ok) {
      const b = await res.json()
      setFormError(b.error?.issues?.[0]?.message ?? `Error ${res.status}`)
      return
    }
    setTitle('')
    loadTasks()
  }

  const sendChat = async () => {
    const msg = chatInput.trim()
    if (!msg || chatBusy) return
    setChatInput('')
    setChat((c) => [...c, { role: 'user', text: msg }])
    setChatBusy(true)
    try {
      const res = await fetch('/api/agents/assistant/chat', {
        method: 'POST',
        headers: hdrs(),
        body: JSON.stringify({ message: msg, sessionId: 'session-' + Date.now() }),
      })
      if (res.status === 403) {
        setChat((c) => [...c, { role: 'error', text: '403 — Need User role' }])
        return
      }
      const reader = res.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let buf = '',
        agentText = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'text_delta') agentText += ev.content
            else if (ev.type === 'tool_call')
              setChat((c) => [...c, { role: 'tool', text: `🔧 ${ev.toolName}` }])
            else if (ev.type === 'tool_result')
              setChat((c) => [...c, { role: 'tool', text: `✅ ${(ev.output ?? '').slice(0, 80)}` }])
            else if (ev.type === 'error')
              setChat((c) => [...c, { role: 'error', text: ev.message }])
          } catch {
            /* partial */
          }
        }
      }
      if (agentText) setChat((c) => [...c, { role: 'agent', text: agentText }])
      loadTasks()
    } catch (err) {
      setChat((c) => [
        ...c,
        { role: 'error', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ])
    } finally {
      setChatBusy(false)
    }
  }

  useEffect(() => {
    chatRef.current?.scrollTo(0, chatRef.current.scrollHeight)
  }, [chat])

  return (
    <div className="page">
      <div className="main">
        {/* Hero */}
        <header className="hero">
          <img src="/logo.png" alt="TheoKit" width={72} height={72} className="hero-logo" />
          <h1>TheoKit</h1>
          <p className="tagline">Build the app your agent lives in.</p>
          <nav className="ctas">
            <a
              href="https://usetheo.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="btn primary"
            >
              Get Started
            </a>
            <a
              href="https://github.com/usetheodev/theokit"
              target="_blank"
              rel="noopener noreferrer"
              className="btn secondary"
            >
              Documentation
            </a>
          </nav>
          <p className="hint">
            Edit <code>app/page.tsx</code> to get started.
          </p>
        </header>

        {/* Role */}
        <div className="role-bar">
          <label htmlFor="role">Role:</label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="">None (public)</option>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        {/* Content */}
        <div className="grid">
          <section className="card">
            <h2>
              Tasks <span className="badge">@Controller</span>
            </h2>
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Priority</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className={t.done ? 'done' : ''}>
                    <td>
                      {t.done ? '✅ ' : '○ '}
                      {t.title}
                    </td>
                    <td>
                      <span className={`prio prio-${t.priority}`}>{t.priority}</span>
                    </td>
                    <td>{t.done ? 'Done' : 'To do'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form onSubmit={createTask} className="create-bar">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="New task..."
                required
                minLength={3}
              />
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Task['priority'])}
              >
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="low">Low</option>
              </select>
              <button type="submit">Add</button>
            </form>
            {formError && <p className="error">{formError}</p>}
          </section>

          <section className="card">
            <h2>
              AI Assistant <span className="badge badge-ai">@Agent + SSE</span>
            </h2>
            <div ref={chatRef} className="chat-box">
              {chat.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  {m.role === 'user' ? `You: ${m.text}` : m.text}
                </div>
              ))}
            </div>
            <div className="chat-bar">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                placeholder="Message the AI assistant..."
                disabled={chatBusy}
              />
              <button type="button" onClick={sendChat} disabled={chatBusy}>
                Send
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <footer className="footer">
          Powered by{' '}
          <a href="https://usetheo.dev" target="_blank" rel="noopener noreferrer">
            TheoKit
          </a>
          {' · '}
          <a href="https://github.com/usetheodev/theokit" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          {' · '}
          <a href="https://discord.usetheo.dev" target="_blank" rel="noopener noreferrer">
            Discord
          </a>
        </footer>
      </div>
    </div>
  )
}
