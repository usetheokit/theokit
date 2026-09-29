import { existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import type { AdapterBuildContext } from '../../adapters/types.js'
import { scanAgents } from '../../server/scan/agent-scan.js'
import { scanServerRoutes } from '../../server/scan/scan.js'
import { scanWebSocketRoutes } from '../../server/scan/ws-scan.js'

/**
 * What a scanned deploy target is handed instead of a filesystem.
 *
 * #369 — a Worker has no filesystem at request time, so the Cloudflare entry bakes its routes at
 * build time. Importing the scanner from `adapters/` would add the `adapters → server` edge that
 * `adapters-may-only-depend-on-core-router-services` refuses, so the CLI composes the scan and
 * hands over the result.
 *
 * ## Why this is a module rather than a closure inside `buildCommand`
 *
 * It was a closure, and the defect it carried was invisible to every test: `buildCommand` loads a
 * config, runs vite twice and writes a tree, so nothing could ask it one question about one call.
 * Extracted at B-312, whose whole content was a single argument being wrong.
 *
 * Paths are made relative to the project root here, where `projectRoot` is known: that string is
 * both the emitted import specifier and the key the executor looks a module up by, and the scanners
 * return absolute paths.
 */
export function createBuildScanRoutes(
  projectRoot: string,
  config: { agentsDir?: string },
): NonNullable<AdapterBuildContext['scanRoutes']> {
  return (serverDir: string) => {
    const abs = resolve(projectRoot, serverDir)
    const toProjectRelative = (p: string): string => relative(projectRoot, p).split(sep).join('/')

    return {
      routes: scanServerRoutes(abs).map((route) => ({
        filePath: toProjectRelative(route.filePath),
        routePath: route.routePath,
        methods: route.methods ?? [],
      })),
      wsRoutes: scanWebSocketRoutes(abs).map((ws) =>
        toProjectRelative(typeof ws === 'string' ? ws : ws.filePath),
      ),
      // #367 — agents are a DIFFERENT scan served by a DIFFERENT function, which is why no adapter
      // had ever heard of them: the entries route `/api/` through `scanServerRoutes` +
      // `executeRoute` alone, so `/api/agents/<name>` matched nothing and 404'd on every target.
      // Scanned here, beside the routes, because the same inversion argument applies verbatim.
      //
      // B-312 — the root is the PROJECT ROOT, and was `dirname(abs)`. `config.agentsDir` is
      // documented and declared relative to the project root, while `dirname(serverDir)` is the
      // root only when `serverDir` is a direct child of it. The scaffold's own nested layout
      // (`serverDir: 'src/server'`, `agentsDir: 'src/server/agents'`) made the two disagree, and
      // `join()` produced `<root>/src/src/server/agents` — so `scanAgents` returned `[]` and every
      // `/api/agents/*` route 404'd on every scanned target. Measured on a live Cloudflare deploy,
      // 2026-09-26. Every other caller in the tree already passes the project root.
      agents: scanAgents(projectRoot, config.agentsDir).map((agent) => ({
        filePath: toProjectRelative(agent.filePath),
        agentPath: agent.agentPath,
        name: agent.name,
      })),
      // B-185 — the identity module, decided here for the same reason the agents are: this provider
      // is handed `serverDir`, and a Worker has no filesystem to look for it on. An app with no
      // `server/context.ts` yields `undefined`, and the generator then emits no import — importing
      // a file that is not there would fail the BUILD rather than one request.
      contextModule: existsSync(join(abs, 'context.ts'))
        ? toProjectRelative(join(abs, 'context.ts'))
        : undefined,
    }
  }
}
