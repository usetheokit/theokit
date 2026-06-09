export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      {children}
    </div>
  )
}
