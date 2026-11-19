import { chmodSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'

import type { AuditFinding } from './index.js'

function modeOf(path: string): number | undefined {
  try {
    return statSync(path).mode & 0o777
  } catch {
    return undefined
  }
}

export function auditInstanceConfig(app: string, path: string): AuditFinding[] {
  if (process.platform === 'win32') return []
  const findings: AuditFinding[] = []
  const fileMode = modeOf(path)
  if (fileMode !== undefined && (fileMode & 0o077) !== 0) {
    findings.push({ id: 'file-mode', path, mode: fileMode, fixable: true })
  }
  const dir = dirname(path)
  const dirMode = basename(dir) === app ? modeOf(dir) : undefined
  if (dirMode !== undefined && (dirMode & 0o077) !== 0) {
    findings.push({ id: 'directory-mode', path: dir, mode: dirMode, fixable: true })
  }
  return findings
}

/** Applies chmod to each finding; returns the findings that were fixed. */
export function fixInstanceConfig(findings: readonly AuditFinding[]): AuditFinding[] {
  const fixed: AuditFinding[] = []
  for (const finding of findings) {
    try {
      chmodSync(finding.path, finding.id === 'file-mode' ? 0o600 : 0o700)
      fixed.push(finding)
    } catch {
      // leave it unfixed
    }
  }
  return fixed
}
