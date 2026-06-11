/**
 * Client-side interactivity — loaded via <script src="/client.js" defer> in page.tsx.
 *
 * Handles: task CRUD via fetch, AI chat via SSE streaming.
 * No build step required — runs directly in the browser.
 */

var getRole = function () {
  return document.getElementById('role').value
}
var headers = function () {
  var h = { 'Content-Type': 'application/json' }
  var r = getRole()
  if (r) h['x-role'] = r
  return h
}

// ─── Tasks CRUD ─────────────────────────────────────

async function loadTasks() {
  var res = await fetch('/api/tasks')
  var tasks = await res.json()
  var tbody = document.getElementById('task-list')
  tbody.innerHTML = tasks
    .map(function (t) {
      var cls = t.done ? 'done' : ''
      var prio =
        t.priority === 'high' ? 'prio-high' : t.priority === 'low' ? 'prio-low' : 'prio-med'
      var icon = t.done ? '\u2705 ' : '\u25CB '
      return (
        '<tr class="' +
        cls +
        '"><td>' +
        icon +
        esc(t.title) +
        '</td><td><span class="prio ' +
        prio +
        '">' +
        t.priority +
        '</span></td><td>' +
        (t.done ? 'Done' : 'To do') +
        '</td></tr>'
      )
    })
    .join('')
}

document.getElementById('create-form').addEventListener('submit', async function (e) {
  e.preventDefault()
  var input = document.getElementById('new-title')
  var select = document.getElementById('new-priority')
  var err = document.getElementById('form-error')
  err.textContent = ''
  var title = input.value.trim()
  if (!title) return
  var res = await fetch('/api/tasks', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ title: title, priority: select.value }),
  })
  if (res.status === 403) {
    err.textContent = '403 \u2014 Need User role'
    return
  }
  if (!res.ok) {
    var data = await res.json()
    err.textContent =
      (data.error && data.error.issues && data.error.issues[0] && data.error.issues[0].message) ||
      'Error ' + res.status
    return
  }
  input.value = ''
  loadTasks()
})

// ─── AI Chat (SSE) ──────────────────────────────────

var sessionId = 'session-' + Date.now()
var chatEl = document.getElementById('chat')
var chatInput = document.getElementById('chat-input')
var chatBtn = document.getElementById('chat-send')

chatBtn.addEventListener('click', sendChat)
chatInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') sendChat()
})

async function sendChat() {
  var msg = chatInput.value.trim()
  if (!msg) return
  chatInput.value = ''
  chatEl.innerHTML += '<div class="msg user">You: ' + esc(msg) + '</div>'
  chatBtn.disabled = true

  try {
    var res = await fetch('/api/agents/assistant/chat', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ message: msg, sessionId: sessionId }),
    })
    if (res.status === 403) {
      chatEl.innerHTML += '<div class="msg system">403 \u2014 Need User role to chat</div>'
      chatBtn.disabled = false
      return
    }

    var reader = res.body.getReader()
    var decoder = new TextDecoder()
    var agentDiv = document.createElement('div')
    agentDiv.className = 'msg agent'
    chatEl.appendChild(agentDiv)

    var buf = ''
    while (true) {
      var chunk = await reader.read()
      if (chunk.done) break
      buf += decoder.decode(chunk.value, { stream: true })
      var lines = buf.split('\n')
      buf = lines.pop() || ''
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i]
        if (!line.startsWith('data: ')) continue
        try {
          var ev = JSON.parse(line.slice(6))
          if (ev.type === 'text_delta') agentDiv.innerHTML += fmtMd(ev.content)
          else if (ev.type === 'tool_call')
            chatEl.insertBefore(mkMsg('tool', '\uD83D\uDD27 ' + ev.toolName), agentDiv)
          else if (ev.type === 'tool_result')
            chatEl.insertBefore(
              mkMsg('tool', '\u2705 ' + (ev.output || '').substring(0, 80)),
              agentDiv,
            )
          else if (ev.type === 'thinking')
            chatEl.insertBefore(mkMsg('system', '\uD83D\uDCAD ' + ev.content), agentDiv)
          else if (ev.type === 'done')
            document.getElementById('chat-cost').textContent =
              ((ev.usage && ev.usage.totalTokens) || 0) +
              ' tokens \u00B7 ' +
              ev.durationMs +
              'ms' +
              (ev.cost ? ' \u00B7 $' + ev.cost.toFixed(6) : '')
          else if (ev.type === 'error')
            chatEl.innerHTML += '<div class="msg error">' + esc(ev.message) + '</div>'
        } catch (_) {
          /* partial JSON */
        }
      }
      chatEl.scrollTop = chatEl.scrollHeight
    }
    loadTasks()
  } catch (e) {
    chatEl.innerHTML += '<div class="msg error">Error: ' + esc(e.message) + '</div>'
  }
  chatBtn.disabled = false
  chatEl.scrollTop = chatEl.scrollHeight
}

function mkMsg(cls, text) {
  var d = document.createElement('div')
  d.className = 'msg ' + cls
  d.textContent = text
  return d
}
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function fmtMd(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')
}

loadTasks()
