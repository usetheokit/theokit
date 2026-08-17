#!/usr/bin/env python3
"""Flip a milestone checkbox `[ ]` → `[x]` in ROADMAP.md after a successful release.

Step 7.5 of cycle-release. Closes the cycle-roadmap super-loop.

Hard invariant (per cycle-roadmap § Hard gates): exactly ONE checkbox flips
per release. If the diff would produce more than one `[ ]` → `[x]` transition,
the script ABORTS without writing anything.

Idempotent: if the milestone is already `[x]`, exit 0 with INFO. If the
milestone is missing entirely, exit 0 with WARN — the release itself is not
blocked on roadmap metadata.

Side effects (when --commit is passed AND a flip happened):
    - `git add ROADMAP.md && git commit -m "chore(roadmap): mark M<N> done (v<version>)"` on the current branch
    - Append/create `knowledge-base/roadmap-runs/M<N>-<date>.md` with completion metadata

Usage:
    python3 flip_milestone_checkbox.py \
        --roadmap ROADMAP.md \
        --milestone-id M3 \
        --version 0.4.0 \
        --plan knowledge-base/plans/foo-plan.md \
        --release-log knowledge-base/releases/v0.4.0-release.md \
        --commit

Exit codes:
    0 — flipped successfully OR already [x] (no-op) OR milestone missing (WARN, by design)
    1 — single-flip invariant would be violated (multiple [ ] would become [x])
    2 — file not found / parse error
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def _header_re(milestone_id: str) -> re.Pattern[str]:
    """Match the literal header for the given milestone, in either [ ] or [x] state."""
    return re.compile(
        rf"^(###\s+{re.escape(milestone_id)}\s+[—\-]{{1,2}}\s+\[)([ x])(\]\s+.+?)$",
        re.MULTILINE,
    )


def flip(roadmap_text: str, milestone_id: str) -> tuple[str, str]:
    """Return (new_text, status) where status ∈ {flipped, already-x, not-found, multi-flip}."""
    matches = list(_header_re(milestone_id).finditer(roadmap_text))
    if not matches:
        return roadmap_text, "not-found"
    if len(matches) > 1:
        return roadmap_text, "multi-flip"

    match = matches[0]
    current_state = match.group(2)
    if current_state == "x":
        return roadmap_text, "already-x"

    new_text = roadmap_text[: match.start(2)] + "x" + roadmap_text[match.end(2):]

    # Single-flip invariant: count diff transitions to be safe
    transitions_before = roadmap_text.count("] ")
    transitions_after = new_text.count("] ")
    if transitions_after != transitions_before:
        # Sanity check — shouldn't happen with our replacement, but defensive
        return roadmap_text, "multi-flip"

    return new_text, "flipped"


def _git_commit(roadmap_path: Path, milestone_id: str, version: str) -> str | None:
    """Stage and commit ROADMAP.md. Return commit SHA on success, None on failure."""
    repo = roadmap_path.resolve().parent
    msg = f"chore(roadmap): mark {milestone_id} done (v{version})"
    try:
        subprocess.run(["git", "-C", str(repo), "add", str(roadmap_path)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(repo), "commit", "-m", msg], check=True, capture_output=True)
        result = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as exc:
        print(f"git commit failed: {exc.stderr.decode(errors='replace')}", file=sys.stderr)
        return None


def _append_roadmap_run(
    roadmap_runs_dir: Path,
    milestone_id: str,
    plan_path: Path | None,
    release_log: Path | None,
    flip_sha: str | None,
) -> Path:
    """Create or append to the roadmap-runs file for this milestone."""
    roadmap_runs_dir.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    target = roadmap_runs_dir / f"{milestone_id}-{date_str}.md"

    iso_ts = datetime.now(timezone.utc).isoformat()
    if not target.exists():
        target.write_text(
            "---\n"
            f"milestone_id: {milestone_id}\n"
            f"date: {date_str}\n"
            "status: completed\n"
            f"plan: {plan_path or ''}\n"
            f"release: {release_log or ''}\n"
            f"checkbox_flipped_at: {iso_ts}\n"
            f"flip_commit_sha: {flip_sha or ''}\n"
            "---\n\n"
            f"# Milestone {milestone_id} — completion record\n\n"
            f"Checkbox flipped to [x] by cycle-release on {iso_ts}.\n",
            encoding="utf-8",
        )
    else:
        # Append a completion note rather than overwriting
        target.write_text(
            target.read_text(encoding="utf-8")
            + f"\n## Re-flip / amendment {iso_ts}\n\n"
            + f"- flip_commit_sha: {flip_sha or 'n/a'}\n"
            + f"- release_log: {release_log or 'n/a'}\n",
            encoding="utf-8",
        )
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--roadmap", type=Path, default=Path("ROADMAP.md"))
    parser.add_argument("--milestone-id", required=True, help="Milestone to flip (e.g. M3).")
    parser.add_argument("--version", required=True, help="Semver string without leading 'v'.")
    parser.add_argument("--plan", type=Path, help="Path to the plan file (recorded in roadmap-runs).")
    parser.add_argument("--release-log", type=Path, help="Path to the release log (recorded in roadmap-runs).")
    parser.add_argument(
        "--roadmap-runs-dir",
        type=Path,
        default=Path("knowledge-base/roadmap-runs"),
        help="Directory for the roadmap-runs audit file.",
    )
    parser.add_argument("--commit", action="store_true", help="Stage & commit ROADMAP.md on the current branch.")
    args = parser.parse_args()

    if not args.roadmap.exists():
        print(f"file not found: {args.roadmap}", file=sys.stderr)
        return 2

    if not re.match(r"^M\d+$", args.milestone_id):
        print(f"invalid milestone_id (expected M<N>): {args.milestone_id!r}", file=sys.stderr)
        return 2

    text = args.roadmap.read_text(encoding="utf-8")
    new_text, status = flip(text, args.milestone_id)

    if status == "not-found":
        print(f"WARN roadmap-checkbox: {args.milestone_id} not found in {args.roadmap} — skipping flip")
        return 0
    if status == "already-x":
        print(f"INFO roadmap-checkbox: {args.milestone_id} already [x] — no-op")
        return 0
    if status == "multi-flip":
        print(
            f"ABORT roadmap-checkbox: single-flip invariant would be violated "
            f"({args.milestone_id} matches multiple headers)",
            file=sys.stderr,
        )
        return 1

    args.roadmap.write_text(new_text, encoding="utf-8")
    flip_sha: str | None = None
    if args.commit:
        flip_sha = _git_commit(args.roadmap, args.milestone_id, args.version)

    run_file = _append_roadmap_run(
        args.roadmap_runs_dir, args.milestone_id, args.plan, args.release_log, flip_sha
    )
    print(
        f"FLIPPED {args.milestone_id} [ ]→[x] in {args.roadmap}; "
        f"audit: {run_file}; commit: {flip_sha or 'n/a (--commit not passed)'}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
