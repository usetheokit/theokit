import type { Plugin } from '@theokit/sdk'

/** The `general` kind of the SDK's `Plugin` union: the one that has `register`. */
export type GeneralPlugin = Extract<Plugin, { kind: 'general' }>
