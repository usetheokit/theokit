/**
 * The process port of the `theoclaw` command (B-374): `daemon` drives systemctl and loginctl
 * through it, `update` drives git and install.sh, and the tests inject their own. The runner is
 * the one `@theokit/host/service` ships.
 */
export { runCommand, type Runner, type RunResult } from '@theokit/host/service'
