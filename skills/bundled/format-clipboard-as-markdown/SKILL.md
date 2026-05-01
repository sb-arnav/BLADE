---
name: format-clipboard-as-markdown
description: Format the current clipboard contents as clean Markdown. Use when the user has copied messy text (HTML, terminal output, slack messages) and wants it reformatted before pasting somewhere else.
license: Apache-2.0
compatibility: requires python3 on PATH
metadata:
  category: editing
  exemplar_for: skill-with-scripts
allowed-tools:
  - Bash(python3:*)
---

# format-clipboard-as-markdown

A skill that takes raw clipboard text and produces clean Markdown by stripping
HTML, normalizing whitespace, and converting common rich-text artefacts into
their Markdown equivalents.

## When to use

The user has copied something (a Slack message, a webpage excerpt, an email
quote, a terminal output block) and wants it pasted into a Markdown document
without manual cleanup. Common cues:

- "format this as markdown"
- "clean up the clipboard"
- "paste this into the doc but make it readable"

Do **not** use this skill when:
- The source is already clean Markdown — reformatting risks breaking it.
- The user wants to *generate* Markdown from a description — that's writing,
  not formatting.

## Approach

1. Read clipboard contents (caller passes them as stdin to the script).
2. Run [`scripts/format.py`](scripts/format.py) to produce cleaned Markdown.
3. Surface the result for the user to copy / paste / verify.
4. If the script reports it couldn't find recognizable structure, surface the
   raw input back unchanged — never silently lose the user's text.

## Constraints

- Never write the cleaned output back to the clipboard automatically — leave
  that for the user to confirm. Skill stays observational.
- Never call out to a remote API — formatting must work offline.
- Preserve code blocks verbatim (don't reformat inside ``` fences).

## Output shape

Cleaned Markdown emitted to stdout. Stderr carries diagnostic notes (e.g.
"detected HTML; stripped 12 tags") for debug only.
