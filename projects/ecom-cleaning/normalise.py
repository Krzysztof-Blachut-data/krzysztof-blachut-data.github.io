"""Rule-based label normalisation.

Ordered rules (exact -> punctuation -> leet -> reversal -> unique prefix -> alias).
Unresolved values stay missing and are counted. Rule hits are tracked for the report.
"""
from __future__ import annotations

import re
from collections import Counter

from config import ALIASES, LEET, NULL_TOKENS, TRAILING_NOISE

NON_ALNUM = re.compile(r"[^a-z0-9]+")


class Normaliser:
    """Map free-text labels onto a fixed vocabulary."""

    def __init__(self, canonical: tuple[str, ...], aliases: dict[str, str] | None = None):
        self.canonical = set(canonical)
        self.aliases = ALIASES if aliases is None else aliases
        self.rules: Counter[str] = Counter()
        # cache: value -> (canonical, rule)
        self._cache: dict[str, tuple[str | None, str]] = {}

    def _unique_prefix(self, token: str) -> str | None:
        if len(token) < 3:
            return None
        matches = [c for c in self.canonical if c.startswith(token)]
        return matches[0] if len(matches) == 1 else None

    def _resolve(self, raw: str) -> tuple[str | None, str]:
        token = raw.strip().lower()
        if token in NULL_TOKENS:
            return None, "missing"

        if token in self.canonical:
            # distinguishes values that arrived clean from ones only casing/padding broke
            return token, "exact" if token == raw else "case_or_padding"

        stripped = NON_ALNUM.sub("", token)
        # Substitutions must be undone before symbols are stripped, otherwise 'c@rd' loses
        # the '@' that stands for 'a' and becomes the unrecoverable 'crd'.
        decoded = NON_ALNUM.sub("", token.translate(LEET))
        for candidate, rule in ((stripped, "punctuation"), (decoded, "leet")):
            if candidate in self.canonical:
                return candidate, rule
            trimmed = candidate.rstrip("".join(TRAILING_NOISE))
            if trimmed in self.canonical:
                return trimmed, rule

        if decoded[::-1] in self.canonical:
            return decoded[::-1], "reversal"

        if (hit := self._unique_prefix(decoded)) is not None:
            return hit, "prefix"

        if (hit := self.aliases.get(decoded)) is not None and hit in self.canonical:
            return hit, "alias"

        return None, "unresolved"

    def __call__(self, raw) -> str | None:
        if raw is None or raw != raw:  # NaN
            self.rules["missing"] += 1
            return None
        key = str(raw)
        result = self._cache.get(key)
        if result is None:
            result = self._resolve(key)
            self._cache[key] = result
        value, rule = result
        self.rules[rule] += 1
        return value

    def report(self) -> dict[str, int]:
        return dict(self.rules)

    @property
    def repaired(self) -> int:
        """Rows that carried a real label but needed a rule to recover it."""
        return sum(c for r, c in self.rules.items()
                   if r not in {"exact", "missing", "unresolved"})
