/**
 * Print the welcome banner to stdout at a chosen width, so a layout change can be SEEN without
 * launching the TUI, authenticating, and trusting a directory.
 *
 * The width is set on the INSTANCE Ink was handed, not only on the global: `ink-testing-library`
 * builds its own stdout at a hard-coded 100 columns, and both `Banner`'s gate and `WelcomeBanner`'s
 * box read that one. Setting only the global renders every width as 100 and would make this tool
 * lie about the layout it exists to show.
 *
 * It lives under `packages/tui/scripts/` rather than the repository's `tools/` because pnpm isolates
 * dependencies per package: `react` and `ink-testing-library` resolve from `packages/tui` and are
 * not reachable from the root.
 *
 *     pnpm dev:banner        # 150 columns
 *     pnpm dev:banner 80     # the narrow branch
 */
import { render } from 'ink-testing-library'

import { Banner } from '../src/components/Banner.js'

const columns = Number(process.argv[2] ?? 150)
if (!Number.isFinite(columns) || columns < 20) {
  process.stderr.write(`usage: pnpm dev:banner [columns>=20]  (got ${String(process.argv[2])})\n`)
  process.exit(1)
}
Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true })

const instance = render(<Banner />)
Object.defineProperty(instance.stdout, 'columns', { value: columns, configurable: true })
instance.rerender(<Banner />)
process.stdout.write(`${instance.lastFrame() ?? ''}\n`)
instance.unmount()
