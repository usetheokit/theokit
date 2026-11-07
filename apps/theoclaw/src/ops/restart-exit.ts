/**
 * The exit code with which the entry asks its supervisor to start it again (B-716, OC-94): a
 * changed setting that is read once at the start. It is nonzero, so `Restart=on-failure`, a
 * container's on-failure policy and `theoclaw start` all restart a process that exits with it, and
 * the restarted process stays the one the supervisor tracks. 75 is EX_TEMPFAIL.
 */
export const RESTART_EXIT_CODE = 75
