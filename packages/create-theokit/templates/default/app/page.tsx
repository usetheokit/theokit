/**
 * Main page — Task Manager + AI Chat.
 *
 * Split layout: left side CRUD, right side AI agent chat.
 * SSE streaming renders token-by-token with tool call visualization.
 */
export default function Page() {
  return (
    <div id="app">
      <header>
        <h1><span className="accent">TheoKit</span> Task Manager</h1>
        <p className="subtitle">HTTP Controllers + AI Agent — same pipeline, same guards</p>
        <div className="role-bar">
          <label>Role: </label>
          <select id="role">
            <option value="">None (public only)</option>
            <option value="user" selected>User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </header>

      <main className="grid">
        {/* Left: CRUD Panel */}
        <section className="card">
          <h2>📋 Tasks <span className="badge">@Controller</span></h2>
          <table>
            <thead><tr><th>Task</th><th>Priority</th><th>Status</th></tr></thead>
            <tbody id="task-list"></tbody>
          </table>
          <form id="create-form" className="create-bar">
            <input id="new-title" placeholder="New task..." required minLength={3} />
            <select id="new-priority">
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
            <button type="submit">Add</button>
          </form>
          <p id="form-error" className="error"></p>
        </section>

        {/* Right: AI Chat */}
        <section className="card">
          <h2>🤖 AI Assistant <span className="badge badge-ai">@Agent + SSE</span></h2>
          <div id="chat" className="chat-box">
            <div className="msg system">Ask me to list, create, or complete tasks...</div>
          </div>
          <div className="chat-bar">
            <input id="chat-input" placeholder="Message the AI assistant..." />
            <button id="chat-send" onClick={() => {}}>Send</button>
          </div>
          <p id="chat-cost" className="cost"></p>
        </section>
      </main>

      <ClientScript />
    </div>
  )
}

function ClientScript() {
  return (
    <script dangerouslySetInnerHTML={{ __html: CLIENT_JS }} />
  )
}

const CLIENT_JS = `
const API = '';
let sessionId = 'session-' + Date.now();
const getRole = () => document.getElementById('role').value;
const headers = () => {
  const h = { 'Content-Type': 'application/json' };
  const r = getRole();
  if (r) h['x-role'] = r;
  return h;
};

// ─── Tasks CRUD ─────────────────────────────────────

async function loadTasks() {
  const res = await fetch(API + '/api/tasks');
  const tasks = await res.json();
  document.getElementById('task-list').innerHTML = tasks.map(t => {
    const statusClass = t.done ? 'done' : 'pending';
    const prioClass = t.priority === 'high' ? 'prio-high' : t.priority === 'low' ? 'prio-low' : 'prio-med';
    return '<tr class="' + statusClass + '"><td>' + (t.done ? '✅ ' : '○ ') + t.title + '</td><td><span class="prio ' + prioClass + '">' + t.priority + '</span></td><td>' + (t.done ? 'Done' : 'To do') + '</td></tr>';
  }).join('');
}

document.getElementById('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('new-title').value.trim();
  const priority = document.getElementById('new-priority').value;
  const err = document.getElementById('form-error');
  err.textContent = '';
  if (!title) return;
  const res = await fetch(API + '/api/tasks', { method: 'POST', headers: headers(), body: JSON.stringify({ title, priority }) });
  if (res.status === 403) { err.textContent = '403 — Need User role'; return; }
  if (res.status === 422) { const e = await res.json(); err.textContent = e.error?.issues?.[0]?.message || 'Validation error'; return; }
  if (!res.ok) { err.textContent = 'Error ' + res.status; return; }
  document.getElementById('new-title').value = '';
  loadTasks();
});

// ─── AI Chat (SSE) ──────────────────────────────────

document.getElementById('chat-send').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  const chat = document.getElementById('chat');
  chat.innerHTML += '<div class="msg user">You: ' + escapeHtml(msg) + '</div>';
  document.getElementById('chat-send').disabled = true;

  try {
    const res = await fetch(API + '/api/agents/assistant/chat', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ message: msg, sessionId })
    });

    if (res.status === 403) {
      chat.innerHTML += '<div class="msg system">403 — Need User role to chat</div>';
      document.getElementById('chat-send').disabled = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let agentDiv = document.createElement('div');
    agentDiv.className = 'msg agent';
    agentDiv.textContent = '';
    chat.appendChild(agentDiv);

    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'text_delta') {
            agentDiv.innerHTML += formatMarkdown(ev.content);
          } else if (ev.type === 'tool_call') {
            chat.insertBefore(toolMsg('🔧 Calling: ' + ev.toolName), agentDiv);
          } else if (ev.type === 'tool_result') {
            chat.insertBefore(toolMsg('✅ ' + (ev.output || '').substring(0, 80)), agentDiv);
          } else if (ev.type === 'thinking') {
            chat.insertBefore(sysMsg('💭 ' + ev.content), agentDiv);
          } else if (ev.type === 'done') {
            const cost = ev.cost ? ' · $' + ev.cost.toFixed(6) : '';
            document.getElementById('chat-cost').textContent = ev.usage.totalTokens + ' tokens · ' + ev.durationMs + 'ms' + cost;
          } else if (ev.type === 'error') {
            chat.innerHTML += '<div class="msg error">' + ev.message + '</div>';
          }
        } catch {}
      }
      chat.scrollTop = chat.scrollHeight;
    }
    loadTasks(); // refresh after agent actions
  } catch (e) {
    chat.innerHTML += '<div class="msg error">Error: ' + e.message + '</div>';
  }
  document.getElementById('chat-send').disabled = false;
  chat.scrollTop = chat.scrollHeight;
}

function toolMsg(text) { const d = document.createElement('div'); d.className = 'msg tool'; d.textContent = text; return d; }
function sysMsg(text) { const d = document.createElement('div'); d.className = 'msg system'; d.textContent = text; return d; }
function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function formatMarkdown(s) { return escapeHtml(s).replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>').replace(/\\n/g, '<br>'); }

loadTasks();
`
