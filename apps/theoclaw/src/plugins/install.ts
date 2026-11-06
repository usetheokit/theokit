import { cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
  await readFile(join(input.source, manifest.entry)).catch(() => {
    throw new Error(`plugin entry ${manifest.entry} is missing`)
  })
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
