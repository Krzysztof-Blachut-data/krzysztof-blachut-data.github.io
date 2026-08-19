#!/usr/bin/env python3
"""Fail on non-UTF-8 source files and common mojibake from Windows code pages.

    python scripts/check_encoding.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUFFIXES = {".html", ".css", ".js", ".py", ".md", ".json", ".txt", ".sql", ".csv", ".svg", ".xml"}
# segment match (repo name contains ".git" as a substring)
SKIP_DIRS = {"node_modules", ".git", ".pytest_cache", "__pycache__", "raw", "processed"}

# lead bytes of a UTF-8 multi-byte sequence, as they appear once decoded as Windows-125x
LEAD = "\u00c2\u00c3\u00e2"
# the printable high range those code pages map 0x80-0xBF onto, across cp1250 and cp1252
TRAIL = (
    "\u0080-\u00bf"
    "\u20ac\u201a\u201e\u2026\u2020\u2021\u2030\u2039\u203a"
    "\u2018\u2019\u201c\u201d\u2013\u2014\u2022"
    "\u0152\u0153\u0160\u0161\u015e\u015f\u0178\u017d\u017e\u02c6\u02dc"
)
MOJIBAKE = re.compile(f"[{LEAD}][{TRAIL}]")


def relevant(path: Path) -> bool:
    if path.suffix.lower() not in SUFFIXES:
        return False
    return not (set(path.relative_to(ROOT).parts[:-1]) & SKIP_DIRS)


def main() -> int:
    problems: list[str] = []
    scanned = 0

    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or not relevant(path):
            continue
        scanned += 1
        rel = path.relative_to(ROOT).as_posix()
        try:
            text = path.read_bytes().decode("utf-8")
        except UnicodeDecodeError as exc:
            problems.append(f"{rel}: not valid UTF-8 ({exc.reason} at byte {exc.start})")
            continue
        if text.startswith("\ufeff"):
            problems.append(f"{rel}: starts with a UTF-8 BOM")
        for number, line in enumerate(text.splitlines(), 1):
            match = MOJIBAKE.search(line)
            if match:
                found = line[match.start():match.start() + 3]
                codepoints = " ".join(f"U+{ord(c):04X}" for c in found)
                problems.append(f"{rel}:{number}: mojibake {codepoints}")

    if problems:
        sys.stderr.write("Encoding check failed:\n")
        for problem in problems:
            sys.stderr.write(f"  {problem}\n")
        sys.stderr.write(
            f"\n{len(problems)} problem(s) in {scanned} files.\n"
            "Rewrite the affected file as UTF-8. In PowerShell, prefer\n"
            "  Set-Content -Encoding utf8   (never plain Add-Content for non-ASCII text)\n"
        )
        return 1

    print(f"encoding ok — {scanned} files are clean UTF-8 with no mojibake")
    return 0


if __name__ == "__main__":
    sys.exit(main())
