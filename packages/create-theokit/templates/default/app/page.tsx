export default function Page() {
  return (
    <div className="page">
      <div className="main">
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
            Edit <code>app/page.tsx</code> to get started. Changes hot-reload instantly.
          </p>
        </header>

        <div className="grid features">
          <div className="feature">
            <h3>defineRoute</h3>
            <p>
              Typed API routes with Zod validation. See <code>server/routes/</code>
            </p>
          </div>
          <div className="feature">
            <h3>Drizzle + SQLite</h3>
            <p>
              Type-safe database with zero config. Schema in <code>server/db/schema.ts</code>
            </p>
          </div>
          <div className="feature">
            <h3>@Agent + @Tool</h3>
            <p>AI agents with SSE streaming, budget control, and human-in-the-loop approval.</p>
          </div>
          <div className="feature">
            <h3>React + Vite</h3>
            <p>File-based routing, HMR, SSR streaming. Edit and see changes instantly.</p>
          </div>
        </div>

        <footer className="footer">
          Powered by{' '}
          <a href="https://usetheo.dev" target="_blank" rel="noopener noreferrer">
            TheoKit
          </a>
          {' · '}
          <a href="https://github.com/usetheodev/theokit" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </footer>
      </div>
    </div>
  )
}
