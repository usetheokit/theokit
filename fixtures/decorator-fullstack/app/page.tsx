'use client'

import { useEffect, useState } from 'react'

interface Task {
  id: number
  title: string
  done: boolean
  priority: string
}

interface Stats {
  total: number
  done: number
  pending: number
}

export default function TaskManagerPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/tasks').then(r => r.ok ? r.json() : []),
      fetch('/api/tasks/stats').then(r => r.ok ? r.json() : null),
    ]).then(([t, s]) => {
      setTasks(Array.isArray(t) ? t : [])
      setStats(s)
      setLoading(false)
    })
  }, [])

  if (loading) return <p>Loading...</p>

  return (
    <div>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
        TheoKit Task Manager
      </h1>
      <p style={{ color: '#888', marginBottom: '2rem' }}>
        Full-stack: React frontend + <code>@theokit/http-decorators</code> backend
      </p>

      {stats && (
        <div style={{ display: 'flex', gap: '2rem', marginBottom: '2rem' }}>
          <div><strong style={{ fontSize: '2rem', color: '#60a5fa' }}>{stats.total}</strong><br /><span style={{ color: '#888' }}>Total</span></div>
          <div><strong style={{ fontSize: '2rem', color: '#4ade80' }}>{stats.done}</strong><br /><span style={{ color: '#888' }}>Done</span></div>
          <div><strong style={{ fontSize: '2rem', color: '#fbbf24' }}>{stats.pending}</strong><br /><span style={{ color: '#888' }}>Pending</span></div>
        </div>
      )}

      <div style={{ background: '#171717', border: '1px solid #333', borderRadius: '12px', padding: '1.5rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Tasks</h2>
        {tasks.length === 0 && <p style={{ color: '#666' }}>No tasks yet</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {tasks.map(task => (
            <li key={task.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.5rem 0', borderBottom: '1px solid #333',
            }}>
              <span>{task.done ? '✅' : '⬜'}</span>
              <span style={{ flex: 1, textDecoration: task.done ? 'line-through' : 'none', color: task.done ? '#666' : '#e5e5e5' }}>
                {task.title}
              </span>
              <span style={{
                padding: '2px 8px', borderRadius: '9999px', fontSize: '0.75rem',
                background: task.priority === 'high' ? '#451a03' : task.priority === 'medium' ? '#172554' : '#052e16',
                color: task.priority === 'high' ? '#fbbf24' : task.priority === 'medium' ? '#60a5fa' : '#4ade80',
                border: `1px solid ${task.priority === 'high' ? '#78350f' : task.priority === 'medium' ? '#1e3a5f' : '#14532d'}`,
              }}>
                {task.priority}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ background: '#171717', border: '1px solid #333', borderRadius: '12px', padding: '1.5rem', marginTop: '1rem' }}>
        <h2>API Endpoints</h2>
        <p style={{ color: '#888', fontSize: '0.85rem', marginTop: '0.5rem' }}>
          Backend uses <code>defineRoute</code> (file-based) — add <code>httpDecoratorsPlugin</code> to switch to <code>@Controller</code> style.
        </p>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '0.5rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>
          <li><span style={{ color: '#4ade80', fontWeight: 700 }}>GET</span> /api/tasks</li>
          <li><span style={{ color: '#4ade80', fontWeight: 700 }}>GET</span> /api/tasks/stats</li>
        </ul>
      </div>
    </div>
  )
}
