/**
 * B-400 Phase 3 (FR-008 to FR-010, NFR-002, NFR-003): the instance lock, `theoclaw backup` and
 * `theoclaw restore`. Child processes are real processes, so a pid is a real holder.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { claimInstance, InstanceLockedError, instanceLockPath, takeInstanceLock } from "../src/backup/instance-lock.js";
import { NO_PROFILE } from "../src/instance.js";
import { waitFor } from "./fakes.js";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const TSX_LOADER = import.meta.resolve("tsx");
const LOCK_MODULE = join(APP_DIR, "src", "backup", "instance-lock.ts");

const scratch: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "theoclaw-backup-"));
  scratch.push(dir);
  return dir;
}

/** A pid no process has any more: a child that already exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid!;
  await new Promise((resolve) => child.once("exit", resolve));
  return pid;
}

/** A lock left by a process that is gone, as a crash leaves it. */
async function staleLock(stateDir: string): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  writeFileSync(instanceLockPath(stateDir), `${await deadPid()}\n${nonce}\n`, { mode: 0o600 });
  return nonce;
}

interface LockChild {
  readonly pid: number;
  /** `took` or `refused <message>`, once the child answered. */
  readonly answer: Promise<string>;
  /** Let the child release and exit. */
  end(): Promise<void>;
}

/** A child process that takes the instance lock and holds it until `end()`. */
function lockChild(stateDir: string, startGate?: string): LockChild {
  const script = join(tempDir(), "take.ts");
  writeFileSync(
    script,
    [
      `import { existsSync } from "node:fs";`,
      `import { takeInstanceLock } from ${JSON.stringify(LOCK_MODULE)};`,
      `const gate = process.argv[3];`,
      `while (gate !== undefined && !existsSync(gate)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);`,
      `let release = () => {};`,
      `try { release = takeInstanceLock(process.argv[2]).release; process.stdout.write("took\\n"); }`,
      `catch (error) { process.stdout.write("refused " + error.message + "\\n"); }`,
      `process.stdin.on("end", () => { release(); process.exit(0); });`,
      `process.stdin.resume();`,
    ].join("\n"),
  );
  const child = spawn(process.execPath, ["--import", TSX_LOADER, script, stateDir, ...(startGate === undefined ? [] : [startGate])], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  children.push(child);
  let output = "";
  child.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const answer = waitFor(() => output.includes("\n"), 30_000, "the child's answer").then(() => output.trim());
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return { pid: child.pid!, answer, end: () => (child.stdin!.end(), exited) };
}

describe("the instance lock (FR-010)", () => {
  it("a second take of a held lock is refused naming the pid", () => {
    const stateDir = join(tempDir(), "state");
    const lock = takeInstanceLock(stateDir);
    expect(() => takeInstanceLock(stateDir)).toThrow(InstanceLockedError);
    expect(() => takeInstanceLock(stateDir)).toThrow(`is held by process ${process.pid}`);
    lock.release();
    takeInstanceLock(stateDir).release();
  });

  it("lives beside the state directory, written 0600, and copies into no backup of it", () => {
    const root = tempDir();
    const lock = takeInstanceLock(join(root, "state"));
    expect(lock.path).toBe(join(root, "state.instance.lock"));
    expect(readFileSync(lock.path, "utf8")).toMatch(/^\d+\n[0-9a-f]{32}\n$/);
    expect(existsSync(join(root, "state"))).toBe(false);
    lock.release();
    expect(readdirSync(root)).toEqual([]);
  });

  it("a lock whose process is gone is taken over", async () => {
    const stateDir = join(tempDir(), "state");
    takeInstanceLock(stateDir).release();
    const stale = await staleLock(stateDir);
    const lock = takeInstanceLock(stateDir);
    expect(lock.nonce).not.toBe(stale);
    expect(readFileSync(lock.path, "utf8")).toBe(`${process.pid}\n${lock.nonce}\n`);
    lock.release();
  });

  it("a start is refused naming the pid while a backup holds the lock", async () => {
    const root = tempDir();
    const stateDir = join(root, "state");
    const holder = lockChild(stateDir);
    expect(await holder.answer).toBe("took");
    const env: NodeJS.ProcessEnv = { THEOCLAW_STATE_DIR: stateDir };
    expect(() => claimInstance(NO_PROFILE, env)).toThrow(`is held by process ${holder.pid}`);
    await holder.end();
    claimInstance(NO_PROFILE, env)?.();
  });

  it("a start refused by a restore's lock leaves an absent state target absent", () => {
    const home = tempDir();
    const directory = join(home, "profile");
    const stateDirectory = join(directory, "state");
    const instance = {
      label: "theoclaw-p",
      profile: "p",
      directory,
      workspace: join(directory, "workspace"),
      stateDirectory,
      overrides: { THEOCLAW_STATE_DIR: stateDirectory, THEOCLAW_WORKSPACE: join(directory, "workspace") },
    };
    let restore: { release(): void } | undefined;
    // The start is paused before its lock; a restore takes the lock in that window.
    const start = () => claimInstance(instance, {}, { beforeLock: () => (restore = takeInstanceLock(stateDirectory)) });
    expect(start).toThrow(InstanceLockedError);
    expect(existsSync(stateDirectory)).toBe(false);
    expect(existsSync(instance.workspace)).toBe(false);
    restore?.release();
  });

  it("a start with no state directory takes no lock", () => {
    expect(claimInstance(NO_PROFILE, {})).toBeUndefined();
    expect(claimInstance(NO_PROFILE, { THEOCLAW_STATE_DIR: "  " })).toBeUndefined();
  });

  it("a delayed taker of a lock generation already taken over refuses and leaves the new holder's lock in place", async () => {
    const stateDir = join(tempDir(), "state");
    await staleLock(stateDir);
    let holders = 0;
    let taken: { nonce: string; release(): void } | undefined;
    // B reads the stale generation and is paused; A takes over, C is refused against A's live lock.
    const takerB = () =>
      takeInstanceLock(stateDir, {
        beforeTakeover: () => {
          if (taken !== undefined) return;
          taken = takeInstanceLock(stateDir);
          holders += 1;
          expect(() => takeInstanceLock(stateDir)).toThrow(InstanceLockedError);
        },
      });
    expect(takerB).toThrow(`is held by process ${process.pid}`);
    expect(holders).toBe(1);
    expect(readFileSync(instanceLockPath(stateDir), "utf8")).toBe(`${process.pid}\n${taken!.nonce}\n`);
    taken!.release();
  });

  it("a takeover file left for a dead generation does not block taking over a later stale lock", async () => {
    const stateDir = join(tempDir(), "state");
    const gone = await staleLock(stateDir);
    // A taker of generation `gone` crashed holding its takeover file; a later generation is stale too.
    writeFileSync(`${instanceLockPath(stateDir)}.takeover-${gone}`, "1\n");
    await staleLock(stateDir);
    const lock = takeInstanceLock(stateDir);
    lock.release();
    expect(readdirSync(join(stateDir, ".."))).toEqual([]);
  });

  it("a takeover that never finished on the current generation is refused naming both files", async () => {
    const stateDir = join(tempDir(), "state");
    const nonce = await staleLock(stateDir);
    writeFileSync(`${instanceLockPath(stateDir)}.takeover-${nonce}`, "1\n");
    expect(() => takeInstanceLock(stateDir)).toThrow(/takeover-[0-9a-f]{32} says a takeover of it never finished; .*delete both files/);
  });

  it("a release removes the claim file a process that is gone left behind", async () => {
    const stateDir = join(tempDir(), "state");
    const left = `${instanceLockPath(stateDir)}.claim-${await deadPid()}-${randomBytes(16).toString("hex")}`;
    takeInstanceLock(stateDir).release();
    writeFileSync(left, "x");
    takeInstanceLock(stateDir).release();
    expect(existsSync(left)).toBe(false);
  });

  it("two processes racing for the lock: exactly one takes it, 20 times (concurrent test)", async () => {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const root = tempDir();
      const gate = join(root, "go");
      const racers = [lockChild(join(root, "state"), gate), lockChild(join(root, "state"), gate)];
      await new Promise((resolve) => setTimeout(resolve, 50)); // timed: both children loaded before the gate opens
      writeFileSync(gate, "");
      const answers = await Promise.all(racers.map((racer) => racer.answer));
      // Atomic-counter invariant: one holder, never two and never none.
      expect(answers.filter((answer) => answer === "took")).toHaveLength(1);
      await Promise.all(racers.map((racer) => racer.end()));
    }
  }, 120_000);

  it("two processes taking over one stale lock: exactly one holds it and the lock names it, 20 times (concurrent test)", async () => {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const root = tempDir();
      const stateDir = join(root, "state");
      await staleLock(stateDir);
      const gate = join(root, "go");
      const racers = [lockChild(stateDir, gate), lockChild(stateDir, gate)];
      await new Promise((resolve) => setTimeout(resolve, 50)); // timed: both children loaded before the gate opens
      writeFileSync(gate, "");
      const answers = await Promise.all(racers.map((racer) => racer.answer));
      const winners = racers.filter((_, index) => answers[index] === "took");
      expect(winners).toHaveLength(1);
      expect(readFileSync(instanceLockPath(stateDir), "utf8").split("\n")[0]).toBe(String(winners[0]!.pid));
      await Promise.all(racers.map((racer) => racer.end()));
    }
  }, 180_000);
});
