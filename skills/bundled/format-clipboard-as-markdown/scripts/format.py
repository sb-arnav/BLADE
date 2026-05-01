#!/usr/bin/env python3
"""format-clipboard-as-markdown / scripts/format.py

Reads raw text from stdin, emits cleaned Markdown to stdout. Diagnostic notes
go to stderr.

Behavior:
  - Strip HTML tags (preserving inner text).
  - Normalize CRLF → LF; trim trailing whitespace per line.
  - Collapse runs of >2 blank lines to exactly 2.
  - Convert HTML entities (&amp; &lt; &gt; &nbsp; &#39; &quot;) to their
    Markdown equivalents.
  - Detect Slack-style `*bold*` and `_italic_` rendering inside plain text;
    leave them alone (they're already valid Markdown).
  - Preserve fenced code blocks (``` ... ```) verbatim — never reformat their
    contents.

Exits 0 on success. Exits 1 only on stdin read errors. Empty input is
acceptable (emits empty output).
"""
from __future__ import annotations

import re
import sys
from html import unescape


CODE_FENCE = re.compile(r"```.*?```", re.DOTALL)
HTML_TAG = re.compile(r"</?[a-zA-Z][^>]*>")
TRAILING_WS = re.compile(r"[ \t]+$", re.MULTILINE)
TOO_MANY_BLANKS = re.compile(r"\n{3,}")


def format_text(raw: str) -> tuple[str, list[str]]:
    """Returns (cleaned, notes)."""
    notes: list[str] = []

    if not raw:
        return "", notes

    # Stash code blocks so the rest of the pipeline doesn't touch them.
    fences: list[str] = []

    def stash(match: re.Match[str]) -> str:
        fences.append(match.group(0))
        return f"\x00FENCE{len(fences) - 1}\x00"

    body = CODE_FENCE.sub(stash, raw)

    # Normalize line endings.
    body = body.replace("\r\n", "\n").replace("\r", "\n")

    # Strip HTML tags and unescape entities.
    tag_count = len(HTML_TAG.findall(body))
    if tag_count:
        body = HTML_TAG.sub("", body)
        notes.append(f"stripped {tag_count} HTML tags")
    body = unescape(body)

    # Trim trailing whitespace per line.
    body = TRAILING_WS.sub("", body)

    # Collapse triple+ blank lines to exactly two.
    collapsed = TOO_MANY_BLANKS.sub("\n\n", body)
    if collapsed != body:
        notes.append("collapsed extra blank lines")
    body = collapsed

    # Restore code fences verbatim.
    for i, fence in enumerate(fences):
        body = body.replace(f"\x00FENCE{i}\x00", fence)

    return body.rstrip() + "\n", notes


def main() -> int:
    try:
        raw = sys.stdin.read()
    except OSError as e:
        print(f"format.py: stdin read failed: {e}", file=sys.stderr)
        return 1

    cleaned, notes = format_text(raw)
    sys.stdout.write(cleaned)

    for note in notes:
        print(f"format.py: {note}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
