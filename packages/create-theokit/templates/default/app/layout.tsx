export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>TheoKit App</title>
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      </head>
      <body>{children}</body>
    </html>
  )
}

const STYLES = `
  :root { --bg: #0a0a0a; --card: #141414; --border: #2a2a2a; --text: #e0e0e0; --muted: #888; --accent: #6366f1; --green: #22c55e; --red: #ef4444; --yellow: #eab308; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  #app { max-width: 1200px; margin: 0 auto; padding: 20px; }
  header { margin-bottom: 24px; }
  h1 { font-size: 1.6rem; } .accent { color: var(--accent); }
  .subtitle { color: var(--muted); font-size: 0.85rem; margin-top: 2px; }
  .role-bar { margin-top: 12px; }
  .role-bar select { padding: 6px 12px; background: #1a1a1a; border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.8rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; } @media(max-width:768px){.grid{grid-template-columns:1fr;}}
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  h2 { font-size: 1rem; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
  .badge { font-size: 0.65rem; padding: 2px 8px; border-radius: 99px; background: #6366f122; color: var(--accent); }
  .badge-ai { background: #eab30822; color: var(--yellow); }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; padding: 8px 4px; color: var(--muted); border-bottom: 1px solid var(--border); font-weight: 500; }
  td { padding: 8px 4px; border-bottom: 1px solid var(--border); }
  tr.done td { opacity: 0.5; text-decoration: line-through; }
  .prio { font-size: 0.7rem; padding: 2px 8px; border-radius: 99px; }
  .prio-high { background: #ef444422; color: var(--red); } .prio-med { background: #eab30822; color: var(--yellow); } .prio-low { background: #22c55e22; color: var(--green); }
  .create-bar { display: flex; gap: 8px; margin-top: 14px; }
  .create-bar input { flex: 1; padding: 8px 12px; background: #1a1a1a; border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.85rem; }
  .create-bar select { padding: 8px; background: #1a1a1a; border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.8rem; }
  .create-bar button { padding: 8px 16px; background: var(--accent); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; }
  .error { color: var(--red); font-size: 0.8rem; margin-top: 4px; }
  .chat-box { height: 400px; overflow-y: auto; padding: 12px; background: #0d0d0d; border-radius: 8px; margin-bottom: 10px; font-size: 0.85rem; line-height: 1.6; }
  .msg { margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; }
  .msg.user { background: #6366f118; color: var(--accent); }
  .msg.agent { background: #1a1a1a; }
  .msg.tool { background: #eab30810; color: var(--yellow); font-size: 0.78rem; font-family: monospace; }
  .msg.system { color: var(--muted); font-size: 0.78rem; font-style: italic; }
  .msg.error { color: var(--red); font-size: 0.8rem; }
  .chat-bar { display: flex; gap: 8px; }
  .chat-bar input { flex: 1; padding: 10px 14px; background: #1a1a1a; border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.9rem; outline: none; }
  .chat-bar input:focus { border-color: var(--accent); }
  .chat-bar button { padding: 10px 20px; background: var(--accent); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
  .chat-bar button:disabled { opacity: 0.4; cursor: not-allowed; }
  .cost { color: var(--muted); font-size: 0.75rem; margin-top: 6px; text-align: right; }
`
