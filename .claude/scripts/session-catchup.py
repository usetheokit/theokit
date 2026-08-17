#!/usr/bin/env python3
"""Session catchup — rebuild context after /clear or fresh session.

Adapted from planning-with-files v2.43.0's session-catchup.py pattern. Reads:

- git status + git diff --stat (what changed since last known commit)
- Active plan file (via .active_plan pointer or newest)
- Recent progress.md entries (if convention is in use)
- Recent compaction snapshots
- Active ralph-loop state (if any)

Supports dual-mode layouts:
  - Standalone — the ecosystem repo itself (skills/+rules/+hooks/ direct).
  - Plugin install — <root>/.claude/ or <root>/.claude/plugins/plan/.

Usage:
  python3 scripts/session-catchup.py [project_dir]

Exit codes:
  0 — catchup report printed (may be empty if no signals found)
  1 — error (project dir doesn't exist, etc.)
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def _is_ecosystem_layout(d: Path) -> bool:
    return (d / "skills").is_dir() and (d / "rules").is_dir() and (d / "hooks").is_dir()


def _resolve_ecosystem_dir(project_dir: Path) -> Path | None:
    """Find ecosystem directory anchored at project_dir.

    Returns the directory holding knowledge-base/, ralph-loop.local.md, etc.
    """
    candidates = [
        project_dir,
        project_dir / ".claude",
        project_dir / ".claude" / "plugins" / "plan",
    ]
    for c in candidates:
        if c.is_dir() and (c / "knowledge-base").is_dir():
            return c
    # Fallback: any layout with skills/+rules/+hooks/
    for c in candidates:
        if c.is_dir() and _is_ecosystem_layout(c):
            return c
    return None


def run(cmd: list[str], cwd: Path) -> str:
    """Run a command, return stdout, swallow errors."""
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.CalledProcessError):
        return ""


def section(title: str) -> str:
    return f"\n=== {title} ==="


def main() -> int:
    project_dir = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    if not project_dir.is_dir():
        print(f"ERROR: {project_dir} is not a directory", file=sys.stderr)
        return 1

    ecosystem_dir = _resolve_ecosystem_dir(project_dir)
    if ecosystem_dir is None:
        print(f"[session-catchup] WARN: no ecosystem layout found under {project_dir}; "
              "git state only.")
        ecosystem_dir = project_dir
    eco_rel = ecosystem_dir.relative_to(project_dir) if ecosystem_dir != project_dir else Path(".")

    print("[session-catchup] Rebuilding context from disk + git.")
    print(f"[session-catchup] Ecosystem dir: {eco_rel}/")

    # 1. Git state
    print(section("git state"))
    branch = run(["git", "branch", "--show-current"], project_dir).strip()
    if branch:
        print(f"branch: {branch}")
    status = run(["git", "status", "--short"], project_dir).strip()
    if status:
        lines = status.splitlines()
        print(f"untracked/modified: {len(lines)} files")
        # Show first 20 lines
        for line in lines[:20]:
            print(f"  {line}")
        if len(lines) > 20:
            print(f"  ... ({len(lines) - 20} more)")
    else:
        print("working tree clean")

    diff_stat = run(["git", "diff", "--stat", "HEAD"], project_dir).strip()
    if diff_stat:
        print(section("git diff --stat HEAD (unstaged changes)"))
        # Show last 15 lines (file summary + totals)
        diff_lines = diff_stat.splitlines()
        for line in diff_lines[-15:]:
            print(line)

    # 2. Recent commits
    print(section("recent commits"))
    log = run(["git", "log", "--oneline", "-10"], project_dir).strip()
    if log:
        print(log)

    # 3. Active plan
    print(section("active plan"))
    active_plan = None
    plans_dir = ecosystem_dir / "knowledge-base" / "plans"

    active_pointer = ecosystem_dir / ".active_plan"
    if active_pointer.is_file():
        slug = active_pointer.read_text().strip()
        candidate = plans_dir / f"{slug}-plan.md"
        if candidate.is_file():
            active_plan = candidate
            print(f"pointer: {eco_rel}/.active_plan -> {slug}")

    if active_plan is None and plans_dir.is_dir():
        plans = sorted(plans_dir.glob("*-plan.md"), key=lambda p: p.stat().st_mtime, reverse=True)
        if plans:
            active_plan = plans[0]
            print(f"newest: {active_plan.relative_to(project_dir)}")

    if active_plan and active_plan.is_file():
        text = active_plan.read_text()
        # Show version + goal section
        for line in text.splitlines()[:10]:
            if line.startswith("# Plan:") or line.startswith("> **Version") or line.startswith("## Goal"):
                print(f"  {line}")
        # Find goal text
        in_goal = False
        for line in text.splitlines():
            if line.strip().startswith("## Goal"):
                in_goal = True
                continue
            if in_goal:
                if line.startswith("## "):
                    break
                if line.strip().startswith(">"):
                    print(f"  GOAL: {line.strip().lstrip('>').strip()}")
                    break
    else:
        print("no active plan found")

    # 4. Recent progress.md entries
    print(section("recent progress"))
    if active_plan:
        slug = active_plan.name.removesuffix("-plan.md")
        progress_file = ecosystem_dir / "knowledge-base" / "progress" / f"{slug}-progress.md"
        if progress_file.is_file():
            lines = progress_file.read_text().splitlines()
            # Show last 20 lines
            print(f"file: {progress_file.relative_to(project_dir)} ({len(lines)} lines)")
            for line in lines[-20:]:
                print(f"  {line}")
        else:
            print(f"no progress file at {eco_rel}/knowledge-base/progress/{slug}-progress.md")

    # 5. Ralph-loop state
    print(section("ralph-loop state"))
    ralph_state = ecosystem_dir / "ralph-loop.local.md"
    if ralph_state.is_file():
        for line in ralph_state.read_text().splitlines()[:10]:
            print(f"  {line}")
    else:
        print("no active ralph-loop")

    # 6. Compaction snapshots
    print(section("recent compaction snapshots"))
    snap_dir = ecosystem_dir / ".compaction-snapshots"
    if snap_dir.is_dir():
        snaps = sorted(snap_dir.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
        if snaps:
            print(f"found {len(snaps)} snapshot(s); most recent: {snaps[0].name}")
        else:
            print("no compaction snapshots")
    else:
        print("no compaction-snapshots directory")

    print("\n[session-catchup] Done. Read the active plan file + tail of progress.md to fully resume.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
