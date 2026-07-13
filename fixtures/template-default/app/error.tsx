export default function ErrorPage() {
  return (
    <div className="container" style={{ textAlign: 'center', paddingTop: '20vh' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '12px' }}>Something went wrong</h1>
      <p className="subtitle">An unexpected error occurred.</p>
      <a href="/" style={{ color: 'var(--accent)', marginTop: '16px', display: 'inline-block' }}>
        Go back home
      </a>
    </div>
  )
}
