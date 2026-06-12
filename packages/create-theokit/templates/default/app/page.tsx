'use client'

import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'

interface Task {
  id: string
  title: string
  priority: 'high' | 'medium' | 'low'
  done: boolean
}

type Role = '' | 'user' | 'admin'

interface ChatMessage {
  type: 'user' | 'agent' | 'tool' | 'system' | 'error'
  content: string
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function Page() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [role, setRole] = useState<Role>('user')
  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium')
  const [formError, setFormError] = useState('')

  const [messages, setMessages] = useState<ChatMessage[]>([
    { type: 'system', content: 'Ask me to list, create, or complete tasks...' },
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatCost, setChatCost] = useState('')
  const chatBoxRef = useRef<HTMLDivElement>(null)
  const sessionId = useRef(`session-${Date.now()}`)

  const headers = useCallback(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (role) h['x-role'] = role
    return h
  }, [role])

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks')
      if (res.ok) {
        const data = await res.json()
        setTasks(data)
      }
    } catch {
      // Network error — silently ignore on initial load
    }
  }, [])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight
    }
  }, [messages])

  const handleCreateTask = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    const title = newTitle.trim()
    if (!title) return

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ title, priority: newPriority }),
    })

    if (res.status === 403) {
      setFormError('403 — Need User role')
      return
    }

    if (!res.ok) {
      const data = await res.json()
      setFormError(data.error?.issues?.[0]?.message ?? `Error ${res.status}`)
      return
    }

    setNewTitle('')
    loadTasks()
  }

  const handleSendChat = async () => {
    const msg = chatInput.trim()
    if (!msg || chatSending) return
    setChatInput('')
    setChatSending(true)

    setMessages((prev) => [...prev, { type: 'user', content: `You: ${msg}` }])

    try {
      const res = await fetch('/api/agents/assistant/chat', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ message: msg, sessionId: sessionId.current }),
      })

      if (res.status === 403) {
        setMessages((prev) => [
          ...prev,
          { type: 'system', content: '403 — Need User role to chat' },
        ])
        setChatSending(false)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        setChatSending(false)
        return
      }

      const decoder = new TextDecoder()
      let buf = ''
      let agentText = ''

      setMessages((prev) => [...prev, { type: 'agent', content: '' }])

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
            if (ev.type === 'text_delta') {
              agentText += ev.content
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = { type: 'agent', content: agentText }
                return updated
              })
            } else if (ev.type === 'tool_call') {
              setMessages((prev) => {
                const inserted = [...prev]
                inserted.splice(inserted.length - 1, 0, {
                  type: 'tool',
                  content: `\uD83D\uDD27 ${ev.toolName}`,
                })
                return inserted
              })
            } else if (ev.type === 'tool_result') {
              setMessages((prev) => {
                const inserted = [...prev]
                inserted.splice(inserted.length - 1, 0, {
                  type: 'tool',
                  content: `\u2705 ${(ev.output ?? '').substring(0, 80)}`,
                })
                return inserted
              })
            } else if (ev.type === 'thinking') {
              setMessages((prev) => {
                const inserted = [...prev]
                inserted.splice(inserted.length - 1, 0, {
                  type: 'system',
                  content: `\uD83D\uDCAD ${ev.content}`,
                })
                return inserted
              })
            } else if (ev.type === 'done') {
              const tokens = ev.usage?.totalTokens ?? 0
              const costStr = ev.cost ? ` \u00B7 $${ev.cost.toFixed(6)}` : ''
              setChatCost(`${tokens} tokens \u00B7 ${ev.durationMs}ms${costStr}`)
            } else if (ev.type === 'error') {
              setMessages((prev) => [...prev, { type: 'error', content: ev.message }])
            }
          } catch {
            /* partial JSON — skip */
          }
        }
      }

      loadTasks()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setMessages((prev) => [...prev, { type: 'error', content: `Error: ${message}` }])
    }

    setChatSending(false)
  }

  return (
    <div className="container">
      <header>
        <h1>
          <span className="accent">TheoKit</span> Task Manager
        </h1>
        <p className="subtitle">
          HTTP Controllers + AI Agent — same guards, distinct pipelines. Edit <code>server/</code>{' '}
          to get started.
        </p>
        <div className="role-bar">
          <label htmlFor="role">Role:</label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="">None (public only)</option>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </header>

      <main className="grid">
        {/* Left: CRUD Panel */}
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
              {tasks.map((task) => (
                <tr key={task.id} className={task.done ? 'done' : ''}>
                  <td>
                    {task.done ? '\u2705 ' : '\u25CB '}
                    {escapeHtml(task.title)}
                  </td>
                  <td>
                    <span
                      className={`prio ${
                        task.priority === 'high'
                          ? 'prio-high'
                          : task.priority === 'low'
                            ? 'prio-low'
                            : 'prio-med'
                      }`}
                    >
                      {task.priority}
                    </span>
                  </td>
                  <td>{task.done ? 'Done' : 'To do'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form onSubmit={handleCreateTask} className="create-bar">
            <input
              placeholder="New task..."
              required
              minLength={3}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as 'high' | 'medium' | 'low')}
            >
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
            <button type="submit">Add</button>
          </form>
          {formError && <p className="error">{formError}</p>}
        </section>

        {/* Right: AI Chat */}
        <section className="card">
          <h2>
            AI Assistant <span className="badge badge-ai">@Agent + SSE</span>
          </h2>
          <div ref={chatBoxRef} className="chat-box">
            {messages.map((msg, i) => (
              <div key={i} className={`msg ${msg.type}`}>
                {msg.content}
              </div>
            ))}
          </div>
          <div className="chat-bar">
            <input
              placeholder="Message the AI assistant..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendChat()
              }}
            />
            <button type="button" onClick={handleSendChat} disabled={chatSending}>
              Send
            </button>
          </div>
          {chatCost && <p className="cost">{chatCost}</p>}
        </section>
      </main>
    </div>
  )
}
