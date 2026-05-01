---
name: git-status-summary
description: Summarize the working tree state across staged, unstaged, and untracked changes. Use when the user wants a one-line read on what's pending in a git repo.
license: Apache-2.0
metadata:
  category: dev-workflow
  exemplar_for: bash-wrapper
---

# git-status-summary

A skill that wraps the native `bash` tool to produce a compact, single-line
read on a git repository's working tree state.

## When to use

Use this skill when the user asks any of:
- "what's the status of this repo?"
- "anything pending in git?"
- "give me a quick read on the working tree"
- "is this repo clean?"

Do **not** use this skill when the user wants to see actual diffs or commit
history — that's a different concern.

## How to invoke

The skill expects to be called inside a git repository (caller's CWD). It runs:

```sh
git status --short
```

Then summarizes the output as `<staged> staged · <unstaged> unstaged · <untracked> untracked`.

## Implementation hints (for the model)

- `git status --short` output column 1 is the index/staged state, column 2 is
  the working tree state. Untracked files show as `??`.
- If no output, the tree is clean → respond with "clean".
- If `--short` reports only staged changes, prefer "N staged" over "N staged · 0 unstaged · 0 untracked" — be terse.

## Output shape

Single line. Examples:
- `clean`
- `3 staged`
- `2 staged · 5 unstaged`
- `7 unstaged · 3 untracked`
- `1 staged · 2 unstaged · 4 untracked`

## Constraints

- Never run any mutating command (no `git add`, `git checkout`, etc).
- Caller's CWD is the source of truth — do not `cd` elsewhere.
