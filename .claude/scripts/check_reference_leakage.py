#!/usr/bin/env python3
"""Detect literal copies of third-party study material inside the project.

`knowledge-base/references/` (cloned peer projects) and `knowledge-base/tools/`
(tools we depend on) are read-only study material. `hooks/validate-command.sh`
blocks copying files out of that zone, but nothing stops an agent or a human from
reading a file there and pasting its content into the project by hand. This script
is the third layer: it looks for the RESULT of a copy, not the act.

Detection: a shingle (N consecutive non-trivial normalized lines) that appears both
in a changed project file and in a zone file is reported as a suspected copy. Exact
shingle match on 5+ meaningful lines is very unlikely by coincidence, which keeps
false positives low — but it is a heuristic, not proof, and the report says so.

Performance note (learned from #37): the zone can hold tens of thousands of foreign
files. Indexing the ZONE would blow memory (that bug peaked at 4.15 GiB). So the
index is built from the CHANGED PROJECT FILES — always few — and the zone is
streamed file by file, with a hard cap that is reported, never silent.

Exit codes:
  0 — no suspected copy (or the zone is absent/empty → SKIP)
  1 — suspected copy found AND --strict was passed
  2 — invocation error
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ZONE_DIRS = ("knowledge-base/references", "knowledge-base/tools")
DEFAULT_SHINGLE = 5
DEFAULT_MAX_ZONE_FILES = 5000
MAX_FILE_BYTES = 2_000_000

TEXT_SUFFIXES = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java", ".kt", ".rb",
    ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".php", ".swift", ".scala",
    ".sh", ".bash", ".zsh", ".sql", ".md", ".rst", ".txt", ".yaml", ".yml",
    ".toml", ".json", ".proto",
}

# Lines too generic to carry provenance on their own.
TRIVIAL = {
    "", "{", "}", "(", ")", "[", "]", "};", ");", "end", "else", "else {",
    "return", "break", "continue", "pass", "fi", "done", "esac", "*/", "/*",
}


def normalize(line: str) -> str:
    """Whitespace-insensitive, case-insensitive form used for comparison."""
    return " ".join(line.split()).lower()


def meaningful_lines(text: str) -> list[tuple[int, str]]:
    """(1-based line number, normalized line) for lines that carry signal."""
    out = []
    for i, raw in enumerate(text.splitlines(), start=1):
        norm = normalize(raw)
        if norm and norm not in TRIVIAL and len(norm) > 3:
            out.append((i, norm))
    return out


def shingles(lines: list[tuple[int, str]], size: int):
    """Yield (first_line_number, joined_text) for each window of `size` lines."""
    for i in range(len(lines) - size + 1):
        window = lines[i : i + size]
        yield window[0][0], "\n".join(text for _, text in window)


def read_text(path: Path) -> str | None:
    try:
        if path.stat().st_size > MAX_FILE_BYTES:
            return None
        return path.read_text(encoding="utf-8", errors="strict")
    except (OSError, UnicodeDecodeError):
        return None


def is_candidate(path: Path) -> bool:
    return path.suffix.lower() in TEXT_SUFFIXES


def in_zone(rel: str) -> bool:
    rel = rel.lstrip("./")
    if rel.startswith(".claude/"):
        rel = rel[len(".claude/") :]
    return any(rel.startswith(z + "/") for z in ZONE_DIRS)


def changed_files(repo: Path, explicit: list[str] | None) -> list[Path]:
    """Files to inspect: explicit list, else what git reports as changed."""
    if explicit:
        return [repo / f for f in explicit]
    rels: set[str] = set()
    for args in (
        ["git", "diff", "--name-only", "HEAD"],
        ["git", "diff", "--name-only", "--cached"],
        ["git", "ls-files", "--others", "--exclude-standard"],
    ):
        try:
            out = subprocess.run(
                args, cwd=repo, capture_output=True, text=True, check=True
            ).stdout
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue
        rels.update(line for line in out.splitlines() if line.strip())
    return [repo / r for r in sorted(rels) if not in_zone(r)]


def zone_files(repo: Path) -> list[Path]:
    found: list[Path] = []
    for base in ZONE_DIRS:
        for root in (repo / base, repo / ".claude" / base):
            if root.is_dir():
                found.extend(p for p in root.rglob("*") if p.is_file())
    return found


def build_index(files: list[Path], repo: Path, size: int) -> dict[str, tuple[str, int]]:
    """shingle text -> (project file, first line). Small: only changed files."""
    index: dict[str, tuple[str, int]] = {}
    for path in files:
        if not path.is_file() or not is_candidate(path):
            continue
        text = read_text(path)
        if text is None:
            continue
        rel = str(path.relative_to(repo)) if path.is_relative_to(repo) else str(path)
        for lineno, shingle in shingles(meaningful_lines(text), size):
            index.setdefault(shingle, (rel, lineno))
    return index


def scan(repo: Path, size: int, max_zone_files: int, explicit: list[str] | None):
    """Returns (findings, stats). A finding is a suspected literal copy."""
    zone = zone_files(repo)
    stats = {"zone_files": len(zone), "zone_scanned": 0, "truncated": False}
    if not zone:
        return [], stats

    index = build_index(changed_files(repo, explicit), repo, size)
    stats["indexed_shingles"] = len(index)
    if not index:
        return [], stats

    findings = []
    seen: set[tuple[str, str]] = set()
    for path in zone:
        if stats["zone_scanned"] >= max_zone_files:
            stats["truncated"] = True
            break
        if not is_candidate(path):
            continue
        text = read_text(path)
        if text is None:
            continue
        stats["zone_scanned"] += 1
        zone_rel = str(path.relative_to(repo)) if path.is_relative_to(repo) else str(path)
        for zone_line, shingle in shingles(meaningful_lines(text), size):
            hit = index.get(shingle)
            if not hit:
                continue
            key = (hit[0], zone_rel)
            if key in seen:
                continue
            seen.add(key)
            findings.append(
                {
                    "project_file": hit[0],
                    "project_line": hit[1],
                    "zone_file": zone_rel,
                    "zone_line": zone_line,
                    "lines_matched": size,
                }
            )
    return findings, stats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", default=".", help="repository root (default: cwd)")
    ap.add_argument("--shingle", type=int, default=DEFAULT_SHINGLE,
                    help=f"consecutive meaningful lines per window (default {DEFAULT_SHINGLE})")
    ap.add_argument("--max-zone-files", type=int, default=DEFAULT_MAX_ZONE_FILES,
                    help="cap on zone files scanned; truncation is always reported")
    ap.add_argument("--strict", action="store_true", help="exit 1 when a copy is suspected")
    ap.add_argument("files", nargs="*", help="explicit files to check (default: git-changed)")
    args = ap.parse_args()

    if args.shingle < 2:
        print("ERROR: --shingle must be >= 2", file=sys.stderr)
        return 2
    repo = Path(args.repo).resolve()
    if not repo.is_dir():
        print(f"ERROR: repo not found: {repo}", file=sys.stderr)
        return 2

    findings, stats = scan(repo, args.shingle, args.max_zone_files, args.files or None)

    if not stats["zone_files"]:
        print("SKIP reference-leakage: study zone absent or empty — nothing to compare against.")
        return 0

    if stats["truncated"]:
        print(
            f"WARN reference-leakage: scanned only {stats['zone_scanned']} of "
            f"{stats['zone_files']} zone files (--max-zone-files). Coverage is PARTIAL.",
            file=sys.stderr,
        )

    if not findings:
        print(
            f"PASS reference-leakage: no {args.shingle}-line block shared with "
            f"{stats['zone_scanned']} scanned zone files."
        )
        return 0

    print(f"SUSPECTED COPY reference-leakage: {len(findings)} match(es)", file=sys.stderr)
    for f in findings:
        print(
            f"  {f['project_file']}:{f['project_line']} shares {f['lines_matched']} "
            f"consecutive lines with {f['zone_file']}:{f['zone_line']}",
            file=sys.stderr,
        )
    print(
        "\nHeuristic, not proof: an exact match of consecutive meaningful lines is "
        "strong evidence of a literal copy, but shared boilerplate or a common "
        "upstream can produce it too. Review each match; if legitimate, record the "
        "provenance and licence in the CHANGELOG.",
        file=sys.stderr,
    )
    return 1 if args.strict else 0


if __name__ == "__main__":
    sys.exit(main())
