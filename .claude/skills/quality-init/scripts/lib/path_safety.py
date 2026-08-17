"""Path safety utilities — prevent path traversal outside project root."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def confine(root: str, target: str) -> str:
    """Resolve *target* and verify it lives inside *root*.

    Returns the resolved absolute path on success.
    Raises SystemExit(1) with a clear message on traversal attempt.
    """
    root_abs = Path(root).resolve()
    target_abs = Path(target).resolve()

    if not str(target_abs).startswith(str(root_abs)):
        print(
            f"Path traversal blocked: '{target}' resolves to '{target_abs}' "
            f"which is outside root '{root_abs}'.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    return str(target_abs)


def confine_or_none(root: str, target: str) -> str | None:
    """Like confine() but returns None instead of raising on traversal."""
    root_abs = Path(root).resolve()
    target_abs = Path(target).resolve()

    if not str(target_abs).startswith(str(root_abs)):
        return None
    return str(target_abs)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} ROOT TARGET", file=sys.stderr)
        raise SystemExit(1)
    print(confine(sys.argv[1], sys.argv[2]))
