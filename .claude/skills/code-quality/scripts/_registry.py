"""Shared registry-lookup cache for D2 (symbol fabrication) detection.

Provides per-ecosystem `package_exists_*` functions that hit the respective
registry (PyPI / npm / crates.io / Go proxy) and cache results for 24h
(per `code-quality-thresholds.txt:symbol_fab.cache_ttl_hours`).

Per ADR D5: deterministic; never falls back to LLM-as-judge.
Per EC-2: HTML-response ambiguity returns None (not False) — prevents
false-positive HARD findings during registry outages.
Per EC-3: corrupted cache file is detected + discarded + re-fetched.
Per EC-9: cache writes use `write_atomic` for crash-safe concurrent CI runs.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

from scripts._shared import write_atomic

_CACHE_DIR_ENV = "CODE_QUALITY_CACHE_DIR"
_CACHE_TTL_SECONDS = 24 * 3600  # 24h per thresholds default
_HTTP_TIMEOUT_SECONDS = 5
_USER_AGENT = "code-quality-skill/0.1 (audit only)"


def _cache_dir() -> Path:
    override = os.environ.get(_CACHE_DIR_ENV)
    if override:
        return Path(override)
    return Path.home() / ".cache" / "code-quality" / "registry"


def _cache_path(ecosystem: str) -> Path:
    base = _cache_dir() / f"{ecosystem}.json"
    base.parent.mkdir(parents=True, exist_ok=True)
    return base


def _load_cache(ecosystem: str) -> dict[str, Any]:
    """Load the ecosystem cache. Returns empty dict on missing or corrupted (EC-3)."""
    path = _cache_path(ecosystem)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        # EC-3 — corrupted cache; discard silently and re-fetch on next lookup.
        try:
            path.unlink()
        except OSError:
            pass
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def _save_cache(ecosystem: str, cache: dict[str, Any]) -> None:
    """Atomic cache write (EC-9)."""
    write_atomic(_cache_path(ecosystem), json.dumps(cache, ensure_ascii=False))


def _now() -> float:
    return time.time()


def _cache_get(ecosystem: str, key: str) -> bool | None:
    cache = _load_cache(ecosystem)
    entry = cache.get(key)
    if not entry:
        return None
    try:
        ts = float(entry.get("ts", 0))
        exists = entry.get("exists")
    except (TypeError, ValueError):
        return None
    if _now() - ts > _CACHE_TTL_SECONDS:
        return None
    if isinstance(exists, bool):
        return exists
    return None


def _cache_set(ecosystem: str, key: str, exists: bool | None) -> None:
    """Persist a lookup result. `None` results are NOT cached (ambiguous)."""
    if exists is None:
        return
    cache = _load_cache(ecosystem)
    cache[key] = {"exists": exists, "ts": _now()}
    _save_cache(ecosystem, cache)


# ---------------------------------------------------------------------------
# Per-ecosystem lookups
# ---------------------------------------------------------------------------


def _http_get_json(url: str, *, headers: dict[str, str] | None = None) -> tuple[Any | None, int | None]:
    """Return (json_data, status_code). On non-200 OR HTML response OR network
    failure, return (None, status_code|None) — ambiguous, NEVER False (EC-2).
    """
    try:
        import requests
    except ImportError:
        return (None, None)
    h = {"User-Agent": _USER_AGENT}
    if headers:
        h.update(headers)
    try:
        resp = requests.get(url, headers=h, timeout=_HTTP_TIMEOUT_SECONDS)
    except Exception:  # noqa: BLE001 — any network failure -> ambiguous
        return (None, None)
    if resp.status_code != 200:
        return (None, resp.status_code)
    content_type = resp.headers.get("Content-Type", "")
    if "html" in content_type.lower():
        # EC-2 — HTML response is ambiguous (likely outage page); do NOT classify as missing.
        return (None, resp.status_code)
    try:
        return (resp.json(), 200)
    except ValueError:
        return (None, resp.status_code)


def package_exists_on_pypi(name: str) -> bool | None:
    """True/False if PyPI returns 200/404. None if ambiguous (timeout, HTML, etc.)."""
    cached = _cache_get("python", name)
    if cached is not None:
        return cached
    data, status = _http_get_json(f"https://pypi.org/pypi/{quote(name, safe='-_.')}/json")
    if status == 200 and isinstance(data, dict):
        result = True
    elif status == 404:
        result = False
    else:
        return None
    _cache_set("python", name, result)
    return result


def package_exists_on_npm(name: str) -> bool | None:
    """npm registry. Scoped packages (`@scope/name`) are URL-encoded."""
    cached = _cache_get("typescript", name)
    if cached is not None:
        return cached
    encoded = quote(name, safe="@/")
    encoded = encoded.replace("/", "%2F") if name.startswith("@") else encoded
    data, status = _http_get_json(f"https://registry.npmjs.org/{encoded}")
    if status == 200 and isinstance(data, dict):
        result = True
    elif status == 404:
        result = False
    else:
        return None
    _cache_set("typescript", name, result)
    return result


def crate_exists_on_crates_io(name: str) -> bool | None:
    """crates.io. Handles `_` ↔ `-` ambiguity by trying both forms."""
    cached = _cache_get("rust", name)
    if cached is not None:
        return cached
    # crates.io stores names case-insensitively but underscores vs dashes can differ
    for candidate in {name, name.replace("_", "-"), name.replace("-", "_")}:
        data, status = _http_get_json(
            f"https://crates.io/api/v1/crates/{quote(candidate, safe='-_')}"
        )
        if status == 200 and isinstance(data, dict):
            _cache_set("rust", name, True)
            return True
        if status is None:
            # Network ambiguity on first try → bail out as None (don't keep guessing)
            return None
    _cache_set("rust", name, False)
    return False


def _go_proxy_encode(module: str) -> str:
    """Go proxy encodes uppercase via `!` prefix (e.g., gopkg.in/Yaml.v2 -> gopkg.in/!yaml.v2)."""
    out = []
    for ch in module:
        if ch.isupper():
            out.append("!" + ch.lower())
        else:
            out.append(ch)
    return "".join(out)


def module_exists_on_go_proxy(import_path: str) -> bool | None:
    """Go proxy. Returns None for stdlib paths (no slash) since stdlib isn't in proxy."""
    cached = _cache_get("go", import_path)
    if cached is not None:
        return cached
    if "/" not in import_path:
        # stdlib package — proxy doesn't index it. Treat as True (exists) to avoid FP.
        _cache_set("go", import_path, True)
        return True
    encoded = _go_proxy_encode(import_path)
    data, status = _http_get_json(f"https://proxy.golang.org/{encoded}/@v/list")
    if status == 200:
        result = True
    elif status in (404, 410):
        result = False
    else:
        return None
    _cache_set("go", import_path, result)
    return result


__all__ = [
    "package_exists_on_pypi",
    "package_exists_on_npm",
    "crate_exists_on_crates_io",
    "module_exists_on_go_proxy",
]
