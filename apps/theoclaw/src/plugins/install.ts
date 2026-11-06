import { cp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'

import { parsePluginManifest, type PluginManifest } from './manifest.js'

export interface InstallPluginInput {
  /** A folder holding `PLUGIN.md` and the entry it names. */
  readonly source: string
  /** The workspace whose `.theokit/plugins/` receives the plugin. */
  readonly workspace: string
  /** The SDK's trust record of workspace plugin folders (`~/.theokit/plugins/trusted-workspace-plugins.json`). */
  readonly trustFile: string
}

/**
 * Install a plugin from its manifest: validate it, copy the folder to
 * `<workspace>/.theokit/plugins/<name>/` and add that folder's realpath to the trust record. Running
 * this is the owner's act of trust; the SDK imports nothing from an untrusted folder.
 */
export async function installPlugin(input: InstallPluginInput): Promise<PluginManifest> {
  const manifest = parsePluginManifest(await readFile(join(input.source, 'PLUGIN.md'), 'utf8'))
  await checkEntry(input.source, manifest.entry)
  const destination = join(input.workspace, '.theokit', 'plugins', manifest.name)
  await rm(destination, { recursive: true, force: true })
  await mkdir(join(destination, '..'), { recursive: true })
  await cp(input.source, destination, { recursive: true })
  await trust(input.trustFile, await realpath(destination))
  return manifest
}

async function trust(trustFile: string, folder: string): Promise<void> {
  const current = await readFile(trustFile, 'utf8').then(
    (text): unknown => {
      try {
        return JSON.parse(text)
      } catch {
        return []
      }
    },
    () => [] as unknown,
  )
  const folders = Array.isArray(current) ? current.filter((item): item is string => typeof item === 'string') : []
  if (!folders.includes(folder)) folders.push(folder)
  await mkdir(join(trustFile, '..'), { recursive: true })
  await writeFile(trustFile, JSON.stringify(folders, null, 2))
}

/** The entry must be a regular file whose realpath stays inside the source folder (no symlink out). */
async function checkEntry(source: string, entry: string): Promise<void> {
  const root = await realpath(source)
  const real = await realpath(join(source, entry)).catch(() => undefined)
  const info = real === undefined ? undefined : await stat(real)
  if (real === undefined || info === undefined || !info.isFile() || !real.startsWith(root + sep)) {
    throw new Error(`plugin entry ${entry} is missing, not a file, or outside the plugin folder`)
  }
}
