"""Go detector — wraps deadcode (D1) + Go proxy registry lookup (D2).

T1.4 implementation: detect_dead_code via deadcode subprocess.
T2.5 implementation: detect_symbol_fabrication via tree-sitter + Go proxy.
Other methods still stubs (T3.1) — T4.3 ADR DEFER for mutation.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from scripts import _registry
from scripts._shared import Finding, safe_parse_json, sanitize_symbol, to_rel_path
from scripts.check_symbol_fab import extract_imports_and_calls

from . import BaseDetector

_DEADCODE_TIMEOUT_SEC = 180


class GoDetector(BaseDetector):
    language = "go"
    manifest_marker = "go.mod"

    def detect_dead_code(self, repo_root: Path) -> list[Finding]:
        """Run `deadcode -json ./...` and parse JSON list into Findings."""
        cmd = ["deadcode", "-json", "./..."]
        try:
            result = subprocess.run(
                cmd,
                cwd=str(repo_root),
                capture_output=True,
                text=True,
                timeout=_DEADCODE_TIMEOUT_SEC,
                check=False,
            )
        except FileNotFoundError:
            return [
                self._auditor_unavailable(
                    "deadcode binary not found (install via "
                    "`go install golang.org/x/tools/cmd/deadcode@v0.45.0`)"
                )
            ]
        except subprocess.TimeoutExpired:
            return [self._auditor_unavailable(f"deadcode timed out after {_DEADCODE_TIMEOUT_SEC}s")]
        except (subprocess.SubprocessError, OSError) as e:
            return [self._auditor_unavailable(f"deadcode invocation failed: {e}")]

        if not result.stdout.strip():
            if result.returncode != 0:
                return [
                    self._auditor_unavailable(
                        f"deadcode exit {result.returncode}: {result.stderr.strip()[:200]}"
                    )
                ]
            return []

        data, parse_finding = safe_parse_json(result.stdout, "deadcode")
        if parse_finding is not None:
            return [
                Finding(
                    detector="d1_dead_code",
                    language="go",
                    severity="SOFT_CAP",
                    file_path=".",
                    symbol_or_line="deadcode",
                    message=f"deadcode JSON output failed to parse: {parse_finding.message}",
                    allowlist_key="go|.|dead_code|auditor_output_malformed_deadcode",
                )
            ]
        return self._parse_deadcode_json(data)

    def detect_symbol_fabrication(self, changed_files: list[Path]) -> list[Finding]:
        """T2.5 — Validate Go imports against Go proxy. Skip self-module + vendored (EC-17 analog, EC-18).

        Reads `go.mod#module` from the repo root (passed as parent of first changed file)
        to identify the self-module prefix. Imports starting with that prefix are skipped.
        Imports under `vendor/` are also skipped (vendored deps).
        """
        findings: list[Finding] = []
        self_module = self._read_go_mod_module(changed_files)
        for src_file in changed_files:
            if not src_file.exists():
                continue
            rel = to_rel_path(src_file)
            # Skip files under vendor/
            if "/vendor/" in rel or rel.startswith("vendor/"):
                continue
            for sym in extract_imports_and_calls(src_file, "go"):
                if sym.kind != "import":
                    continue
                module = sym.module
                if not module:
                    continue
                if self_module and (module == self_module or module.startswith(f"{self_module}/")):
                    continue  # EC-17 analog — self-module imports
                exists = _registry.module_exists_on_go_proxy(module)
                if exists is True:
                    continue
                sanitized = sanitize_symbol(module)
                if exists is False:
                    findings.append(
                        Finding(
                            detector="d2_symbol_fab",
                            language="go",
                            severity="HARD",
                            file_path=rel,
                            symbol_or_line=f'import "{module}"',
                            message=f"Fabricated Go module '{module}' (not found on Go proxy)",
                            allowlist_key=f"go|{rel}|symbol_fab|{sanitized}",
                        )
                    )
                else:
                    findings.append(
                        Finding(
                            detector="d2_symbol_fab",
                            language="go",
                            severity="SOFT_FLOOR",
                            file_path=rel,
                            symbol_or_line=f'import "{module}"',
                            message=f"Could not verify Go module '{module}' (ambiguous response)",
                            allowlist_key=f"go|{rel}|symbol_fab|symbol_fab_unverifiable_{sanitized}",
                        )
                    )
        return findings

    @staticmethod
    def _read_go_mod_module(changed_files: list[Path]) -> str | None:
        """Walk up from any changed file looking for go.mod; extract `module X` line."""
        for src in changed_files:
            current = src.resolve().parent if src.is_file() else src.resolve()
            for _ in range(10):  # walk up at most 10 levels
                candidate = current / "go.mod"
                if candidate.is_file():
                    try:
                        for line in candidate.read_text(encoding="utf-8").splitlines():
                            stripped = line.strip()
                            if stripped.startswith("module "):
                                return stripped.removeprefix("module ").strip()
                    except OSError:
                        return None
                if current == current.parent:
                    break
                current = current.parent
        return None

    def detect_orphan_exports(self, repo_root: Path) -> list[Finding]:
        raise NotImplementedError("T3.1: cross-package wiring detector not yet implemented")

    def detect_mutation_score(self, critical_paths: list[Path]) -> list[Finding]:
        # T4.3 — DEFERRED to v0.2 (evaluate go-mutesting vs gremlins first)
        raise NotImplementedError("T4.3: Go mutation testing DEFERRED to v0.2 (graceful skip)")

    # ------------------------------------------------------------------

    def _parse_deadcode_json(self, data) -> list[Finding]:
        findings: list[Finding] = []
        if not isinstance(data, list):
            return findings
        for entry in data:
            if not isinstance(entry, dict):
                continue
            position = entry.get("position", "<unknown>:0:0")
            name = entry.get("name", "<unknown>")
            file_part = position.split(":", 1)[0] if ":" in position else position
            sanitized = sanitize_symbol(name)
            findings.append(
                Finding(
                    detector="d1_dead_code",
                    language="go",
                    severity="HARD",
                    file_path=file_part,
                    symbol_or_line=f"{name} @ {position}",
                    message=f"Unreachable Go symbol '{name}' at {position}",
                    allowlist_key=f"go|{file_part}|dead_code|{sanitized}",
                )
            )
        return findings

    def _auditor_unavailable(self, reason: str) -> Finding:
        return Finding(
            detector="d1_dead_code",
            language="go",
            severity="SOFT_CAP",
            file_path=".",
            symbol_or_line="deadcode",
            message=f"deadcode auditor unavailable: {reason}",
            allowlist_key="go|.|dead_code|auditor_unavailable_deadcode",
        )
