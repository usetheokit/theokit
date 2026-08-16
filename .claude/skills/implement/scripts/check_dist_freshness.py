"""A typecheck that passed against a stale artifact is worse than one that failed.

Packages here resolve each other through built `.d.ts`, and `dist/` is gitignored. Nothing forces a
rebuild before `tsc --noEmit`, so the whole workspace can typecheck green against declarations that
describe code nobody is running.

Measured, 2026-08-16: `packages/agents/dist/session.d.ts` was dated 18:42 the previous day while
`src/session/gc/transcript-gc.ts` was 14:01 that day. The stale `.d.ts` still declared
`runTranscriptGC` SYNCHRONOUS after T2.2 made it async, so `pnpm typecheck` reported PASS for a full
day while `theokit agent sessions gc` shipped calling it without `await` — reading `.removed` off a
Promise and throwing before printing anything. Rebuilding produced eight errors in that one file.

This runs at HANDOFF, not in the dev loop. During development an edited-but-unrebuilt source is the
normal state and failing on it would train people to ignore the gate; at handoff it means the report
about to be believed was measured against the wrong types.

A package with no `dist/` is SKIPPED, not failed: nothing resolves through an artifact that is not
there, so there is no wrong answer to give.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_SRC_SUFFIXES = (".ts", ".tsx", ".mts", ".cts")
_DTS_SUFFIXES = (".d.ts", ".d.mts", ".d.cts")


def _newest(root: Path, keep) -> float:
    newest = 0.0
    if not root.is_dir():
        return newest
    for path in root.rglob("*"):
        # A package's own `node_modules` would dominate every comparison and means nothing here.
        if "node_modules" in path.parts or not path.is_file():
            continue
        if keep(path.name):
            newest = max(newest, path.stat().st_mtime)
    return newest


def _is_src(name: str) -> bool:
    return name.endswith(_SRC_SUFFIXES) and not name.endswith(_DTS_SUFFIXES)


def check_dist_freshness(packages_dir: Path) -> list[dict]:
    """One finding per package whose built declarations predate its sources."""
    findings: list[dict] = []
    if not packages_dir.is_dir():
        return findings

    for pkg in sorted(p for p in packages_dir.iterdir() if p.is_dir()):
        dist, src = pkg / "dist", pkg / "src"
        if not dist.is_dir() or not src.is_dir():
            continue
        newest_dts = _newest(dist, lambda n: n.endswith(_DTS_SUFFIXES))
        if newest_dts == 0.0:
            continue  # a dist with no declarations types nothing
        newest_src = _newest(src, _is_src)
        if newest_dts < newest_src:
            findings.append({
                "package": pkg.name,
                "message": (
                    f"packages/{pkg.name}/dist declarations are OLDER than its src. Every package "
                    f"resolving {pkg.name} through built types is being typechecked against code "
                    f"that no longer exists — rebuild before trusting any typecheck result."
                ),
            })
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packages-dir", type=Path, default=Path("packages"))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    findings = check_dist_freshness(args.packages_dir)
    status = "FAIL" if findings else "PASS"
    if args.json:
        print(json.dumps({"status": status, "findings": findings}, indent=2))
    else:
        for f in findings:
            print(f"[dist-freshness] {f['message']}")
        if not findings:
            print("[dist-freshness] OK — no package types against a stale artifact.")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
