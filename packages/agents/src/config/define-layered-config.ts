import { applySecurityFloor } from '@theokit/sdk'
import { z } from 'zod'

import { ConfigurationError } from '../errors.js'

import { envLayerFrom, type EnvKnob } from './env-knobs.js'
import { LayeredConfig, type ConfigLayer, type ProvenancePerKey } from './layered-config.js'

/**
 * How one key is confined. The vocabulary is the caller's: nothing here knows what a value means,
 * only how permissive it is (its index in `permissiveness`).
 */
export interface SecurityFloorSpec {
  /** Most confined first. */
  readonly permissiveness: readonly string[]
  /** Layers that may only tighten the value. */
  readonly restricted: readonly string[]
  /** The layer that may loosen it (the operator's flag). */
  readonly override: string
}

type Dict = Record<string, unknown>

/** The layer names, in precedence order. `managed` is last and has the final say. */
const FLOOR_LAYERS = [
  'defaults',
  'user',
  'project',
  'project_local',
  'profile',
  'env',
  'cli',
] as const
type FloorLayer = (typeof FLOOR_LAYERS)[number]

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate one layer against the schema without requiring it to be complete, and without letting the
 * schema's defaults leak keys the layer never set (they would outrank lower layers).
 */
function validateLayer(schema: z.ZodObject, layer: string, raw: unknown): Dict {
  if (raw === undefined) return {}
  if (!isDict(raw)) {
    throw new ConfigurationError(`config layer "${layer}" must be an object`, {
      code: 'config_layer_invalid',
    })
  }
  const parsed = schema.partial().safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new ConfigurationError(`config layer "${layer}" is invalid: ${detail}`, {
      code: 'config_layer_invalid',
    })
  }
  const out: Dict = {}
  for (const key of Object.keys(raw)) {
    if (key in parsed.data) out[key] = parsed.data[key]
  }
  return out
}

/**
 * Pick the profile (the last name chosen by user, project, project-local or cli) and its values.
 * Tables merge per name across the file layers, so a project defining one profile does not erase
 * the user's others.
 */
function selectProfile(
  spec: { readonly profiles?: { readonly selectKey: string; readonly tableKey: string } },
  schema: z.ZodObject,
  [user, project, projectLocal, cli]: readonly [Dict, Dict, Dict, Dict],
): { profileName?: string; profileValues: Dict } {
  if (!spec.profiles) return { profileValues: {} }
  const { selectKey, tableKey } = spec.profiles
  let profileName: string | undefined
  for (const layer of [user, project, projectLocal, cli]) {
    const chosen = layer[selectKey]
    if (typeof chosen === 'string') profileName = chosen
  }
  const table = new Map<string, Dict>()
  for (const layer of [user, project, projectLocal]) {
    const tables = layer[tableKey]
    if (!isDict(tables)) continue
    for (const [name, body] of Object.entries(tables)) {
      if (isDict(body)) table.set(name, { ...table.get(name), ...body })
    }
  }
  if (profileName === undefined) return { profileValues: {} }
  const body = table.get(profileName)
  if (body === undefined) {
    throw new ConfigurationError(
      `unknown profile "${profileName}"; defined profiles: ${[...table.keys()].join(', ') || '(none)'}`,
      { code: 'config_unknown_profile' },
    )
  }
  return { profileName, profileValues: validateLayer(schema, `profile "${profileName}"`, body) }
}

/**
 * Declare an app's configuration once: its schema, defaults, env knobs, accumulating keys, security
 * floors and profiles. `resolve` folds, in order, defaults, user, project, project-local, profile,
 * env, cli and managed.
 *
 * Floors run after the fold, per floored key; the managed tier is applied after the floors, in this
 * one place, so no caller can forget it: a managed value for any key is the final value.
 */
export function defineLayeredConfig<TSchema extends z.ZodObject>(spec: {
  readonly schema: TSchema
  readonly defaults: Partial<z.infer<TSchema>>
  readonly env?: Readonly<Record<string, EnvKnob>>
  readonly accumulate?: readonly (keyof z.infer<TSchema>)[]
  readonly floors?: Readonly<Partial<Record<keyof z.infer<TSchema>, SecurityFloorSpec>>>
  readonly profiles?: { readonly selectKey: string; readonly tableKey: string }
}): {
  resolve(input: {
    readonly user?: unknown
    readonly project?: unknown
    readonly projectLocal?: unknown
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly cli?: Record<string, unknown>
    readonly managed?: unknown
  }): {
    readonly values: z.infer<TSchema>
    readonly profile?: string
    readonly provenancePerKey: ProvenancePerKey
  }
} {
  const accumulate = (spec.accumulate ?? []).map(String)
  const floors = Object.entries(spec.floors ?? {}) as [string, SecurityFloorSpec][]

  return {
    resolve(input) {
      const user = validateLayer(spec.schema, 'user', input.user)
      const project = validateLayer(spec.schema, 'project', input.project)
      const projectLocal = validateLayer(spec.schema, 'project_local', input.projectLocal)
      const cli = validateLayer(spec.schema, 'cli', input.cli)
      const managed = validateLayer(spec.schema, 'managed', input.managed)
      const env = validateLayer(spec.schema, 'env', envLayerFrom(input.env ?? {}, spec.env ?? {}))

      const { profileName, profileValues } = selectProfile(spec, spec.schema, [
        user,
        project,
        projectLocal,
        cli,
      ])

      const layerValues: Record<FloorLayer, Dict> = {
        defaults: { ...(spec.defaults as Dict) },
        user,
        project,
        project_local: projectLocal,
        profile: profileValues,
        env,
        cli,
      }
      const chain: ConfigLayer[] = [
        ...FLOOR_LAYERS.map((layer) => ({ layer, values: layerValues[layer] })),
        { layer: 'managed', values: managed },
      ]

      // Fold and provenance come from `LayeredConfig`; the schema is applied once, at the end, after
      // floors and the managed tier have settled the values.
      const folded = LayeredConfig.resolve({
        layers: chain,
        schema: z.record(z.string(), z.unknown()),
        accumulatingKeys: accumulate,
      })
      const merged: Dict = { ...folded.value }
      const provenance: Record<string, string> = { ...folded.provenancePerKey }

      for (const [key, floor] of floors) {
        const perLayer: Record<string, string | undefined> = {}
        for (const layer of FLOOR_LAYERS) {
          const value = layerValues[layer][key]
          perLayer[layer] = typeof value === 'string' ? value : undefined
        }
        const resolved = applySecurityFloor({ ...floor, layers: perLayer })
        if (resolved === undefined) continue
        merged[key] = resolved
        const source = [...FLOOR_LAYERS].reverse().find((layer) => perLayer[layer] === resolved)
        if (source !== undefined) provenance[key] = source
      }

      // The managed tier, after the floors: it replaces whatever came before, accumulated or not.
      for (const [key, value] of Object.entries(managed)) {
        merged[key] = value
        provenance[key] = 'managed'
      }

      return {
        values: spec.schema.parse(merged),
        ...(profileName !== undefined ? { profile: profileName } : {}),
        provenancePerKey: provenance,
      }
    },
  }
}
