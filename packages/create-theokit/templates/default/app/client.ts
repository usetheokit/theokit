/**
 * Client-side interactivity — loaded via inline <script> in page.tsx.
 *
 * Handles: task CRUD via fetch, AI chat via SSE streaming.
 * No build step required — runs directly in the browser.
 */

const getRole = () => (document.getElementById('role') as HTMLSelectElement).value
const headers = () => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const r = getRole()
  if (r) h['x-role'] = r
  return h
}

// ─── Tasks CRUD ─────────────────────────────────────

async function loadTasks() {
  const res = await fetch('/api/tasks')
  const tasks = await res.json()
  const tbody = document.getElementById('task-list')!
  tbody.innerHTML = tasks
    .map((t: { id: number; title: string; priority: string; done: boolean }) => {
      const cls = t.done ? 'done' : ''
      const prio =
        t.priority === 'high' ? 'prio-high' : t.priority === 'low' ? 'prio-low' : 'prio-med'
      const icon = t.done ? '\u2705 ' : '\u25CB '
      return `<tr class="${cls}"><td>${icon}${esc(t.title)}</td><td><span class="prio ${prio}">${t.priority}</span></td><td>${t.done ? 'Done' : 'To do'}</td></tr>`
    })
    .join('')
}

document.getElementById('create-form')!.addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('new-title') as HTMLInputElement
  const select = document.getElementById('new-priority') as HTMLSelectElement
  const err = document.getElementById('form-error')!
  err.textContent = ''
  const title = input.value.trim()
  if (!title) return
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ title, priority: select.value }),
  })
  if (res.status === 403) {
    err.textContent = '403 \u2014 Need User role'
    return
  }
  if (!res.ok) {
    const e = await res.json()
    err.textContent = e.error?.issues?.[0]?.message || `Error ${res.status}`
    return
  }
  input.value = ''
  loadTasks()
})

// ─── AI Chat (SSE) ──────────────────────────────────

let sessionId = 'session-' + Date.now()
const chatEl = document.getElementById('chat')!
const chatInput = document.getElementById('chat-input') as HTMLInputElement
const chatBtn = document.getElementById('chat-send') as HTMLButtonElement

chatBtn.addEventListener('click', sendChat)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat()
})

async function sendChat() {
  const msg = chatInput.value.trim()
  if (!msg) return
  chatInput.value = ''
  chatEl.innerHTML += `<div class="msg user">You: ${esc(msg)}</div>`
  chatBtn.disabled = true

  try {
    const res = await fetch('/api/agents/assistant/chat', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ message: msg, sessionId }),
    })
    if (res.status === 403) {
      chatEl.innerHTML += '<div class="msg system">403 \u2014 Need User role to chat</div>'
      chatBtn.disabled = false
      return
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const agentDiv = document.createElement('div')
    agentDiv.className = 'msg agent'
    chatEl.appendChild(agentDiv)

    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const ev = JSON.parse(line.slice(6))
          if (ev.type === 'text_delta') agentDiv.innerHTML += fmtMd(ev.content)
          else if (ev.type === 'tool_call')
            chatEl.insertBefore(mkMsg('tool', `\uD83D\uDD27 ${ev.toolName}`), agentDiv)
          else if (ev.type === 'tool_result')
            chatEl.insertBefore(
              mkMsg('tool', `\u2705 ${(ev.output || '').substring(0, 80)}`),
              agentDiv,
            )
          else if (ev.type === 'thinking')
            chatEl.insertBefore(mkMsg('system', `\uD83D\uDCAD ${ev.content}`), agentDiv)
          else if (ev.type === 'done')
            document.getElementById('chat-cost')!.textContent =
              `${ev.usage?.totalTokens || 0} tokens \u00B7 ${ev.durationMs}ms${ev.cost ? ` \u00B7 $${ev.cost.toFixed(6)}` : ''}`
          else if (ev.type === 'error')
            chatEl.innerHTML += `<div class="msg error">${esc(ev.message)}</div>`
        } catch {
          /* partial JSON */
        }
      }
      chatEl.scrollTop = chatEl.scrollHeight
    }
    loadTasks()
  } catch (e) {
    chatEl.innerHTML += `<div class="msg error">Error: ${esc((e as Error).message)}</div>`
  }
  chatBtn.disabled = false
  chatEl.scrollTop = chatEl.scrollHeight
}

function mkMsg(cls: string, text: string) {
  const d = document.createElement('div')
  d.className = `msg ${cls}`
  d.textContent = text
  return d
}
function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function fmtMd(s: string) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')
}

loadTasks()
