---
name: extract-todos-from-notes
description: Read a block of notes (clipboard, meeting transcript, or pasted text) and extract a clean TODO list with owners and rough due dates.
triggers:
  - "extract todos"
  - "extract action items"
  - "pull todos from this"
  - "what are the action items"
  - "what should i do from these notes"
tools:
  - clipboard_read
model_hint: claude-sonnet-4-20250514
---

# extract-todos-from-notes

You are running as the `extract-todos-from-notes` skill.

## Goal

Turn raw notes into a list of TODOs the user can act on today. Owner-tagged, dated where the notes hint at it, deduplicated.

## Procedure

1. Source the notes. Use the most recent of:
   - The user's pasted text in this message.
   - `clipboard_read`.
2. Scan for explicit + implicit action language: "I'll", "we should", "follow up on", "send", "draft", "review", "ping", "check", deadlines, names + verbs.
3. Cluster duplicates (same action, different phrasing). Keep the most specific phrasing.
4. Tag each item with:
   - **Owner** if the notes name one. Default to *you* if it's an implied user action.
   - **Due** if the notes hint at it ("by Friday", "EOD", "this week"). Otherwise leave blank.

## Output format

```
**TODOs from notes**

- [ ] <action> — <owner> — <due if known>
- [ ] <action> — <owner> — <due if known>
...
```

## Rules

- One line per TODO. No nested lists.
- Actions start with a verb.
- If the notes contain zero actionable items, say so in one line — don't invent TODOs.
- Skip discussion items / observations / context. TODOs only.
