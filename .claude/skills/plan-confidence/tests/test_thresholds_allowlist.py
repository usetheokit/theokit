"""T2.2 — plan-confidence-thresholds.txt allowlist tests."""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path


def _read_thresholds(rules_dir: Path) -> str:
    return (rules_dir / "plan-confidence-thresholds.txt").read_text(encoding="utf-8")


def _data_lines(content: str) -> list[str]:
    return [
        line for line in content.splitlines()
        if line and not line.startswith("#") and "|" in line
    ]


def test_thresholds_file_exists(rules_dir: Path) -> None:
    assert (rules_dir / "plan-confidence-thresholds.txt").exists()


def test_thresholds_parseable_4_rows(rules_dir: Path) -> None:
    content = _read_thresholds(rules_dir)
    rows = _data_lines(content)
    assert len(rows) == 4, f"expected 4 data rows, got {len(rows)}"


def test_thresholds_have_four_columns(rules_dir: Path) -> None:
    content = _read_thresholds(rules_dir)
    for row in _data_lines(content):
        parts = row.split("|")
        assert len(parts) == 4, f"row {row!r} has {len(parts)} cols, expected 4"


def test_thresholds_in_descending_order(rules_dir: Path) -> None:
    content = _read_thresholds(rules_dir)
    scores = [int(row.split("|")[1]) for row in _data_lines(content)]
    assert scores == sorted(scores, reverse=True), f"scores {scores} not descending"


def test_thresholds_band_names_canonical(rules_dir: Path) -> None:
    content = _read_thresholds(rules_dir)
    bands = [row.split("|")[0] for row in _data_lines(content)]
    expected = {"SHIPPABLE", "SHIPPABLE_WITH_CAVEATS", "NON_SHIPPABLE", "INVALID"}
    assert set(bands) == expected


def test_thresholds_all_sunset_in_future_or_today(rules_dir: Path) -> None:
    content = _read_thresholds(rules_dir)
    today = date.today()
    for row in _data_lines(content):
        sunset_str = row.split("|")[2]
        sunset = date.fromisoformat(sunset_str)
        # Allow same-day sunset (test runs the day rule is set)
        assert sunset >= today, f"sunset {sunset} is before today {today}"


def test_thresholds_sunset_iso_format(rules_dir: Path) -> None:
    content = _read_thresholds(rules_dir)
    iso_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    for row in _data_lines(content):
        sunset = row.split("|")[2]
        assert iso_pattern.match(sunset), f"sunset {sunset!r} not ISO YYYY-MM-DD"


def test_thresholds_adr_ref_consistent(rules_dir: Path) -> None:
    content = _read_thresholds(rules_dir)
    refs = [row.split("|")[3] for row in _data_lines(content)]
    assert len(set(refs)) == 1, f"ADR refs inconsistent: {set(refs)}"


def test_thresholds_specific_values(rules_dir: Path) -> None:
    """Lock the band cutoffs as per ADR D5 / SOTA report."""
    content = _read_thresholds(rules_dir)
    band_to_min = {
        row.split("|")[0]: int(row.split("|")[1]) for row in _data_lines(content)
    }
    assert band_to_min == {
        "SHIPPABLE": 90,
        "SHIPPABLE_WITH_CAVEATS": 70,
        "NON_SHIPPABLE": 50,
        "INVALID": 0,
    }
