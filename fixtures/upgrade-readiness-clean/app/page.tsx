import { theoFetch } from 'theokit/client'

/**
 * 0.3-ready page: mutations go through `theoFetch`, which injects the
 * `X-Theo-Action` header automatically — so the upgrade-readiness scanner
 * reports NO `csrf-missing-header` violation. No inline scripts, no
 * `dangerouslySetInnerHTML`. The scanner's verdict for this fixture is
 * `status: 'ready'`.
 */
export default function Page() {
  async function save() {
    await theoFetch('/api/items', {
      method: 'POST',
      body: { name: 'example' },
    })
  }

  return <button onClick={save}>Save</button>
}
