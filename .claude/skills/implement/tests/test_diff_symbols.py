"""Tests for diff_symbols — authoritative symbol derivation from git diffs."""
from __future__ import annotations

import subprocess
from pathlib import Path

from diff_symbols import (
    added_symbols_from_shas,
    added_symbols_from_shas_reporting,
    shas_from_progress,
)


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, check=True,
    ).stdout


def _init_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t.t")
    _git(repo, "config", "user.name", "t")
    return repo


def _commit_file(repo: Path, rel: str, content: str, msg: str) -> str:
    path = repo / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    _git(repo, "add", rel)
    _git(repo, "commit", "-q", "-m", msg)
    return _git(repo, "rev-parse", "HEAD").strip()


def test_extracts_python_and_ts_definitions_from_added_lines(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    sha = _commit_file(
        repo, "src/foo.py",
        "def process_batch(items):\n    return items\n\n"
        "class OrderService:\n    pass\n",
        "feat: add",
    )
    sha2 = _commit_file(
        repo, "src/bar.ts",
        "export function computeTotal(x) { return x; }\n"
        "export interface PaymentPort {}\n",
        "feat: add ts",
    )
    symbols = added_symbols_from_shas(repo, [sha, sha2])
    assert "process_batch" in symbols
    assert "OrderService" in symbols
    assert "computeTotal" in symbols
    assert "PaymentPort" in symbols


def test_ignores_private_underscore_symbols(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    sha = _commit_file(repo, "src/x.py", "def _helper():\n    return 1\n", "feat")
    assert "_helper" not in added_symbols_from_shas(repo, [sha])


def test_empty_shas_returns_empty_set(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    assert added_symbols_from_shas(repo, []) == set()


def test_git_unavailable_returns_empty_set(tmp_path: Path) -> None:
    # Non-repo dir + bogus sha → git fails → empty set, never raises.
    assert added_symbols_from_shas(tmp_path, ["deadbeef"]) == set()


def test_shas_from_progress_filters_phase_and_missing(tmp_path: Path) -> None:
    progress = {
        "tasks": [
            {"id": "T1.1", "phase": "1", "commit_sha": "aaa"},
            {"id": "T1.2", "phase": "1"},  # no sha
            {"id": "T2.1", "phase": "2", "commit_sha": "bbb"},
        ]
    }
    assert shas_from_progress(progress) == ["aaa", "bbb"]
    assert shas_from_progress(progress, phase="1") == ["aaa"]
    assert shas_from_progress(progress, phase="2") == ["bbb"]


def test_one_unresolvable_sha_does_not_discard_the_resolvable_ones(tmp_path: Path) -> None:
    """The defect that made pillar (a) unverifiable for a whole slice.

    Every sha went to ONE `git show ... check=True`, so a single sha git cannot
    resolve — and three of this plan's commits live in SIBLING repositories, which
    this repo genuinely cannot resolve — made git exit non-zero and the function
    return an empty set. Twelve resolvable commits were discarded by one that was
    not, and an empty result is indistinguishable from "this slice added no public
    symbols". Measured consequence: wiring_recheck derived ZERO symbols for the
    whole slice while the checkpoint carried 16 positive self-reports, so pillar
    (a) was never independently confirmed for ANY symbol.
    """
    repo = _init_repo(tmp_path)
    good = _commit_file(repo, "src/a.py", "def resolvable_symbol():\n    return 1\n", "feat")

    symbols = added_symbols_from_shas(repo, ["cafebabecafebabecafebabecafebabecafebabe", good])

    assert "resolvable_symbol" in symbols


def test_unresolvable_shas_are_reported_not_swallowed(tmp_path: Path) -> None:
    """Skipping quietly reproduces the defect one level down.

    A gate that silently drops inputs reports a cleaner result for having checked
    less. The caller has to be able to tell "no symbols were added" from "I could
    not read three of your commits".
    """
    repo = _init_repo(tmp_path)
    good = _commit_file(repo, "src/a.py", "def resolvable_symbol():\n    return 1\n", "feat")
    bogus = "cafebabecafebabecafebabecafebabecafebabe"

    symbols, unresolved = added_symbols_from_shas_reporting(repo, [bogus, good])

    assert "resolvable_symbol" in symbols
    assert unresolved == [bogus]
