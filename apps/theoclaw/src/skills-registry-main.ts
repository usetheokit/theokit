import { createServer } from 'node:http'
import { join } from 'node:path'

import { createSkillsRegistryHandler } from './skills/registry-server.js'

/**
 * The reference skill registry entry (OC-72): `node dist/skills-registry-main.js`. Needs
 * `THEOCLAW_SKILLS_REGISTRY_TOKEN`; `THEOCLAW_SKILLS_REGISTRY_DIR` (default `./skills-registry`) and
 * `THEOCLAW_SKILLS_REGISTRY_PORT` (default 8787). Binds 127.0.0.1.
 */
const token = process.env['THEOCLAW_SKILLS_REGISTRY_TOKEN'] ?? ''
if (token === '') {
  process.stderr.write('THEOCLAW_SKILLS_REGISTRY_TOKEN is required\n')
  process.exit(1)
}
const dir = process.env['THEOCLAW_SKILLS_REGISTRY_DIR'] ?? join(process.cwd(), 'skills-registry')
const port = Number(process.env['THEOCLAW_SKILLS_REGISTRY_PORT'] ?? '8787')
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  process.stderr.write('THEOCLAW_SKILLS_REGISTRY_PORT is not a valid port\n')
  process.exit(1)
}
createServer(createSkillsRegistryHandler({ dir, token })).listen(port, '127.0.0.1', () => {
  process.stderr.write(`skills registry listening on 127.0.0.1:${port}\n`)
})
