/**
 * Shared types for the `theokit generate` CLI command family.
 *
 * Extracted to break the circular dependency between generate.ts ↔ generate-resource.ts
 * (architecture-remediation plan T1.1, 2026-06-12).
 */

export const VALID_TYPES = [
  'route',
  'action',
  'page',
  'ws',
  'controller',
  'agent',
  'toolbox',
  'resource',
] as const
export type GeneratorType = (typeof VALID_TYPES)[number]

export interface GenerateOptions {
  cwd: string
  type: string
  name: string
  fields?: string[]
}

export type GenerateStatus =
  | 'created'
  | 'already_exists'
  | 'invalid_kind'
  | 'invalid_name'
  | 'not_a_project'

export interface GenerateResult {
  status: GenerateStatus
  filePath?: string
  kind?: GeneratorType
  name?: string
  message?: string
}
