"""T2.1 — tree-sitter scaffolding + per-language import extraction.

Shared module used by D2 (symbol fabrication) detectors. Wraps `tree-sitter`
(via `tree_sitter_languages.get_parser`) to extract imports/calls/attributes
from source code, exposing a language-agnostic `ExtractedSymbol` dataclass.

Per ADR D5: deterministic AST + registry-lookup is preferred over LLM-as-judge.

Per ADR D8 + EC-8: parser failures (syntax errors, binary files, encoding
issues) MUST NOT raise — they return empty or partial results.

Per EC-14: a canary test in the test suite asserts known-count to detect
grammar regression.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

_SUPPORTED_LANGUAGES = frozenset({"python", "typescript", "rust", "go"})


@dataclass
class ExtractedSymbol:
    """Single import / call / attribute extracted from source code.

    kind: "import" — module imported (`module` field carries the dotted name)
          "call"   — function call (reserved for v0.2)
          "attribute" — method/attr access on a known lib (reserved for v0.2)
    """

    language: str
    file_path: str
    line: int
    column: int
    kind: str
    module: str  # dotted module path (relative imports preserved with leading dots)
    symbol: str  # imported symbol name (when applicable)
    full_text: str
    type_only: bool = False  # TypeScript `import type` flag (EC-15)


def tree_sitter_available() -> bool:
    """Cheap probe for the optional tree-sitter-languages dep."""
    try:
        import tree_sitter_languages  # noqa: F401
    except ImportError:
        return False
    return True


def extract_imports_and_calls(file_path: Path, language: str) -> list[ExtractedSymbol]:
    """Parse `file_path` and extract imports (+ future calls/attrs).

    Args:
        file_path: source file to parse.
        language: one of {"python", "typescript", "rust", "go"}.

    Returns:
        List of ExtractedSymbol. Empty list on parse error / unavailable parser.

    Raises:
        ValueError if `language` is not supported (caller bug, not user bug).
    """
    if language not in _SUPPORTED_LANGUAGES:
        raise ValueError(f"unsupported language: {language!r}; expected one of {_SUPPORTED_LANGUAGES}")

    if not tree_sitter_available():
        # Per EC-8 — never raise; gracefully degrade to empty result.
        return []

    try:
        import tree_sitter_languages

        parser = tree_sitter_languages.get_parser(language)
    except Exception:  # noqa: BLE001 — protect orchestrator from parser-loading failures
        return []

    try:
        source = file_path.read_bytes()
    except OSError:
        return []

    try:
        tree = parser.parse(source)
    except Exception:  # noqa: BLE001 — EC-8 protect on malformed input
        return []

    root = tree.root_node
    extractor = _EXTRACTORS.get(language)
    if extractor is None:
        return []
    try:
        return extractor(root, source, str(file_path))
    except Exception:  # noqa: BLE001 — defensive: a per-language extractor bug
        return []


# ---------------------------------------------------------------------------
# Per-language extractors
# ---------------------------------------------------------------------------


def _node_text(node, source: bytes) -> str:
    return source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _python_extract(root, source: bytes, file_path: str) -> list[ExtractedSymbol]:
    out: list[ExtractedSymbol] = []
    cursor = [root]
    while cursor:
        node = cursor.pop()
        if node.type == "import_statement":
            for child in node.children:
                if child.type == "dotted_name":
                    module = _node_text(child, source)
                    out.append(
                        ExtractedSymbol(
                            language="python",
                            file_path=file_path,
                            line=child.start_point[0] + 1,
                            column=child.start_point[1],
                            kind="import",
                            module=module,
                            symbol=module.split(".")[-1],
                            full_text=_node_text(node, source),
                        )
                    )
                elif child.type == "aliased_import":
                    for sub in child.children:
                        if sub.type == "dotted_name":
                            module = _node_text(sub, source)
                            out.append(
                                ExtractedSymbol(
                                    language="python",
                                    file_path=file_path,
                                    line=sub.start_point[0] + 1,
                                    column=sub.start_point[1],
                                    kind="import",
                                    module=module,
                                    symbol=module.split(".")[-1],
                                    full_text=_node_text(node, source),
                                )
                            )
                            break
        elif node.type == "import_from_statement":
            module = _python_import_from_module(node, source)
            if module is not None:
                out.append(
                    ExtractedSymbol(
                        language="python",
                        file_path=file_path,
                        line=node.start_point[0] + 1,
                        column=node.start_point[1],
                        kind="import",
                        module=module,
                        symbol="",
                        full_text=_node_text(node, source),
                    )
                )

        cursor.extend(reversed(node.children))

    return out


def _python_import_from_module(node, source: bytes) -> str | None:
    """Extract the module portion of a `from X import Y` node, preserving leading dots."""
    # Children layout for `from . import x`:
    #   "from", import_prefix=("."), "import", dotted_name|aliased_import
    # Children layout for `from foo.bar import baz`:
    #   "from", dotted_name="foo.bar", "import", ...
    # Children layout for `from .foo import bar`:
    #   "from", "relative_import"(...) OR "import_prefix"+"dotted_name", "import", ...
    prefix = ""
    module = None
    seen_from = False
    for child in node.children:
        if child.type == "from":
            seen_from = True
            continue
        if not seen_from:
            continue
        if child.type == "import":
            break
        text = _node_text(child, source)
        if child.type == "relative_import":
            return text.strip()
        if child.type == "import_prefix":
            prefix = text
            continue
        if child.type == "dotted_name":
            module = text
            break
    if module is not None:
        return prefix + module
    if prefix:
        return prefix
    return None


def _typescript_extract(root, source: bytes, file_path: str) -> list[ExtractedSymbol]:
    out: list[ExtractedSymbol] = []
    cursor = [root]
    while cursor:
        node = cursor.pop()
        if node.type == "import_statement":
            module = None
            for child in node.children:
                if child.type == "string":
                    raw = _node_text(child, source)
                    module = raw.strip().strip("'").strip('"')
            if module is not None:
                out.append(
                    ExtractedSymbol(
                        language="typescript",
                        file_path=file_path,
                        line=node.start_point[0] + 1,
                        column=node.start_point[1],
                        kind="import",
                        module=module,
                        symbol="",
                        full_text=_node_text(node, source),
                    )
                )
        cursor.extend(reversed(node.children))
    return out


def _rust_extract(root, source: bytes, file_path: str) -> list[ExtractedSymbol]:
    out: list[ExtractedSymbol] = []
    cursor = [root]
    while cursor:
        node = cursor.pop()
        if node.type == "use_declaration":
            text = _node_text(node, source)
            module = text.removeprefix("use").strip().rstrip(";").strip()
            out.append(
                ExtractedSymbol(
                    language="rust",
                    file_path=file_path,
                    line=node.start_point[0] + 1,
                    column=node.start_point[1],
                    kind="import",
                    module=module,
                    symbol=module.split("::")[-1],
                    full_text=text,
                )
            )
        cursor.extend(reversed(node.children))
    return out


def _go_extract(root, source: bytes, file_path: str) -> list[ExtractedSymbol]:
    out: list[ExtractedSymbol] = []
    cursor = [root]
    while cursor:
        node = cursor.pop()
        if node.type == "import_spec":
            for child in node.children:
                if child.type == "interpreted_string_literal":
                    raw = _node_text(child, source).strip().strip('"')
                    out.append(
                        ExtractedSymbol(
                            language="go",
                            file_path=file_path,
                            line=child.start_point[0] + 1,
                            column=child.start_point[1],
                            kind="import",
                            module=raw,
                            symbol=raw.rsplit("/", 1)[-1],
                            full_text=_node_text(node, source),
                        )
                    )
        cursor.extend(reversed(node.children))
    return out


_EXTRACTORS = {
    "python": _python_extract,
    "typescript": _typescript_extract,
    "rust": _rust_extract,
    "go": _go_extract,
}
