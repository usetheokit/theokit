"""Detector interface contract for the `/code-quality` skill.

The `BaseDetector` abstract class defines the per-language detection surface.
Each language adapter (python.py, typescript.py, rust.py, go.py) subclasses
this base and implements the four detection methods.

Stubs in v0.1 raise `NotImplementedError`; tasks T1.1-T1.4, T2.2-T2.5, T3.1,
T4.1-T4.3 progressively fill the implementations.
"""
from __future__ import annotations

from pathlib import Path


class BaseDetector:
    """Abstract per-language detector contract.

    Concrete subclasses set `language` + `manifest_marker` class attributes
    and override the four detection methods. The orchestrator (T5.1) builds
    one Detector instance per language enabled in `code-quality-languages.txt`
    that has its manifest present at repo root.

    All detection methods return `list[Finding]`. Empty list = no findings.
    Detectors NEVER raise for "expected" failure modes (missing binary,
    timeout, malformed output) — they emit `auditor_unavailable_{tool}`
    Findings instead, per the golden rule.
    """

    language: str = ""
    manifest_marker: str = ""

    def detect_dead_code(self, repo_root: Path) -> list:
        """Run D1 — language-specific dead code detector.

        Wraps external CLI (vulture / knip / cargo-udeps / deadcode).
        Emits `Finding(detector="d1_dead_code", severity="HARD", ...)`
        per unallowlisted item.
        """
        raise NotImplementedError

    def detect_symbol_fabrication(self, changed_files: list[Path]) -> list:
        """Run D2 — fabricated package/API detection via tree-sitter + registry lookup.

        Skips module-local imports (relative / crate:: / self-module),
        stdlib modules, and monorepo internal subpath exports.
        """
        raise NotImplementedError

    def detect_orphan_exports(self, repo_root: Path) -> list:
        """Run D3 — cross-package wiring (orphan exports detection).

        SOFT_CAP per golden rule. Skips test files, barrel files, declared
        entry points.
        """
        raise NotImplementedError

    def detect_mutation_score(self, critical_paths: list[Path]) -> list:
        """Run D4 — mutation testing scoped to plan's `## Critical paths`.

        Wraps mutmut (Python) / stryker (TypeScript). Rust + Go DEFERRED
        to v0.2 (graceful skip via INFO Finding per T4.3 ADR).
        """
        raise NotImplementedError
