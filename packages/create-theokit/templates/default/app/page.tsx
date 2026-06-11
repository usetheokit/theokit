export default function Page() {
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
          <select id="role" defaultValue="user">
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
            <tbody id="task-list" />
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
          <p id="form-error" className="error" />
        </section>

        {/* Right: AI Chat */}
        <section className="card">
          <h2>
            AI Assistant <span className="badge badge-ai">@Agent + SSE</span>
          </h2>
          <div id="chat" className="chat-box">
            <div className="msg system">Ask me to list, create, or complete tasks...</div>
          </div>
          <div className="chat-bar">
            <input id="chat-input" placeholder="Message the AI assistant..." />
            <button id="chat-send" type="button">
              Send
            </button>
          </div>
          <p id="chat-cost" className="cost" />
        </section>
      </main>

      <script src="/client.js" defer />
    </div>
  )
}
