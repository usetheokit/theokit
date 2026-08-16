"""Tests for check_dist_freshness — the guard against typechecking a stale artifact."""
from __future__ import annotations

import os
import time
from pathlib import Path

from check_dist_freshness import check_dist_freshness


def _pkg(root: Path, name: str, *, src_mtime: float, dts_mtime: float | None) -> Path:
    pkg = root / name
    (pkg / "src").mkdir(parents=True)
    src = pkg / "src" / "index.ts"
    src.write_text("export const a = 1\n", encoding="utf-8")
    os.utime(src, (src_mtime, src_mtime))
    if dts_mtime is not None:
        (pkg / "dist").mkdir(parents=True)
        dts = pkg / "dist" / "index.d.ts"
        dts.write_text("export declare const a: number\n", encoding="utf-8")
        os.utime(dts, (dts_mtime, dts_mtime))
    return pkg


def test_a_dist_older_than_src_is_reported(tmp_path: Path) -> None:
    now = time.time()
    _pkg(tmp_path, "agents", src_mtime=now, dts_mtime=now - 86_400)
    findings = check_dist_freshness(tmp_path)
    assert [f["package"] for f in findings] == ["agents"]
    assert "no longer exists" in findings[0]["message"]


def test_a_fresh_dist_is_not_reported(tmp_path: Path) -> None:
    now = time.time()
    _pkg(tmp_path, "agents", src_mtime=now - 86_400, dts_mtime=now)
    assert check_dist_freshness(tmp_path) == []


def test_an_unbuilt_package_is_skipped_not_failed(tmp_path: Path) -> None:
    # Nothing resolves through an artifact that is not there, so there is no wrong answer to give.
    # Failing here would fire on every fresh clone, which is how a gate gets ignored.
    _pkg(tmp_path, "agents", src_mtime=time.time(), dts_mtime=None)
    assert check_dist_freshness(tmp_path) == []


def test_a_dist_without_declarations_is_skipped(tmp_path: Path) -> None:
    now = time.time()
    pkg = _pkg(tmp_path, "agents", src_mtime=now, dts_mtime=None)
    (pkg / "dist").mkdir()
    js = pkg / "dist" / "index.js"
    js.write_text("export const a = 1\n", encoding="utf-8")
    os.utime(js, (now - 86_400, now - 86_400))
    assert check_dist_freshness(tmp_path) == []


def test_node_modules_inside_a_package_is_ignored(tmp_path: Path) -> None:
    # A dependency's files would dominate every comparison and say nothing about this package.
    now = time.time()
    pkg = _pkg(tmp_path, "agents", src_mtime=now - 86_400, dts_mtime=now - 3_600)
    nm = pkg / "src" / "node_modules" / "dep"
    nm.mkdir(parents=True)
    fresh = nm / "index.ts"
    fresh.write_text("export const b = 2\n", encoding="utf-8")
    os.utime(fresh, (now, now))
    assert check_dist_freshness(tmp_path) == []


def test_every_stale_package_is_reported_not_just_the_first(tmp_path: Path) -> None:
    now = time.time()
    _pkg(tmp_path, "agents", src_mtime=now, dts_mtime=now - 86_400)
    _pkg(tmp_path, "theo", src_mtime=now, dts_mtime=now - 86_400)
    assert {f["package"] for f in check_dist_freshness(tmp_path)} == {"agents", "theo"}


def test_a_missing_packages_dir_is_not_a_failure(tmp_path: Path) -> None:
    assert check_dist_freshness(tmp_path / "nope") == []
