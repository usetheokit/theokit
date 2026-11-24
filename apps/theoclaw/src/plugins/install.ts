import { installWorkspacePlugin, type PluginManifest } from '@theokit/sdk'

export interface InstallPluginInput {
  /** A folder holding `PLUGIN.md` and the entry it names. */
  readonly source: string
  /** The workspace whose `.theokit/plugins/` receives the plugin. */
  readonly workspace: string
}

/**
 * Install a plugin through the SDK: it validates the manifest and entry, copies the folder to
 * `<workspace>/.theokit/plugins/<name>/` (replacing an earlier copy) and adds that folder's realpath to
 * the SDK's trust record. Running this is the owner's act of trust; the SDK imports nothing from an
 * untrusted folder.
 */
export async function installPlugin(input: InstallPluginInput): Promise<PluginManifest> {
  return installWorkspacePlugin({ source: input.source, workspace: input.workspace, replace: true })
}
