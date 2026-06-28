"""Tests for wiring_recheck — independent re-run of check_wiring.py per symbol."""
from __future__ import annotations

from pathlib import Path

from wiring_recheck import recheck_pillar_a


def _make_tree(root: Path) -> None:
    (root / ".git").mkdir(parents=True)
    (root / "src").mkdir(parents=True)


def test_symbol_with_production_caller_passes(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    _make_tree(root)
    (root / "src" / "order.py").write_text("def compute_total(x):\n    return x\n", encoding="utf-8")
    (root / "src" / "app.py").write_text("from order import compute_total\nprint(compute_total(1))\n", encoding="utf-8")
    result = recheck_pillar_a(root, {"compute_total"})
    assert result.symbols_resolved == 1
    assert result.pillar_a_fails == 0
    assert result.fail_symbols == ()


def test_defined_but_uncalled_symbol_fails(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    _make_tree(root)
    # Defined, never called from any production file → pillar (a) FAIL.
    (root / "src" / "orphan.py").write_text("def orphan_fn(x):\n    return x\n", encoding="utf-8")
    result = recheck_pillar_a(root, {"orphan_fn"})
    assert result.symbols_resolved == 1
    assert result.pillar_a_fails == 1
    assert "orphan_fn" in result.fail_symbols


def test_unresolvable_symbol_is_skipped_not_failed(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    _make_tree(root)
    # Symbol does not exist anywhere in the tree → cannot resolve → not a FAIL.
    result = recheck_pillar_a(root, {"ghost_symbol"})
    assert result.symbols_checked == 1
    assert result.symbols_resolved == 0
    assert result.pillar_a_fails == 0


def test_empty_symbol_set(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    _make_tree(root)
    result = recheck_pillar_a(root, set())
    assert result.symbols_checked == 0
    assert result.symbols_resolved == 0
    assert result.pillar_a_fails == 0
