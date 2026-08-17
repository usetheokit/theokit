export default function Loading() {
  return (
    <div
      className="container"
      style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}
    >
      <div className="loading-spinner" />
    </div>
  )
}
