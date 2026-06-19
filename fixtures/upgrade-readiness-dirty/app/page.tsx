/**
 * Dirty page exercising two 0.3 violations the upgrade-readiness scanner
 * detects:
 *   1. `csrf-missing-header` — a raw `fetch(..., { method: 'POST' })` with no
 *      `X-Theo-Action` header (returns 403 under 0.3 strict CSRF).
 *   2. `dangerously-set-inline-script` — a `dangerouslySetInnerHTML` payload
 *      that contains a `<script>` (blocked under 0.3 enforce-CSP).
 */
export default function Page() {
  async function save() {
    await fetch('/api/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'example' }),
    })
  }

  return (
    <div>
      <button onClick={save}>Save</button>
      <div dangerouslySetInnerHTML={{ __html: '<script>alert(1)</script>' }} />
    </div>
  )
}
