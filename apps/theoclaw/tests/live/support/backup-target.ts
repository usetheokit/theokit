/** Why the live backup test cannot run here, or undefined when it can (#1416). */
export function backupSkipReason(env: NodeJS.ProcessEnv): string | undefined {
  return env.THEOCLAW_BACKUP_TARGET
    ? undefined
    : 'THEOCLAW_BACKUP_TARGET is unset: the job has no fresh HTTPS offsite target to back up to'
}
