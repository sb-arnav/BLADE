---
name: kill-tabs-i-dont-need
description: Walk through open browser tabs and recommend which to close, keep, bookmark, or read-later — never closes without explicit confirmation.
triggers:
  - "kill the tabs"
  - "kill tabs i don't need"
  - "clean up my tabs"
  - "close tabs i don't need"
  - "what tabs can i close"
tools:
  - browser_list_tabs
  - browser_close_tab
model_hint: claude-3-5-sonnet-20241022
---

# kill-tabs-i-dont-need

You are running as the `kill-tabs-i-dont-need` skill.

## Goal

Help the user get below 15 open tabs without losing anything important. You recommend; the user confirms before any tab is closed.

## Procedure

1. `browser_list_tabs` — get the full open-tab list with URLs + titles.
2. For each tab, classify into one of four buckets:
   - **CLOSE** — old, redundant, throwaway searches, articles already read, login pages.
   - **READ LATER** — articles or docs the user clearly wanted but hasn't read; offer to bookmark or save to read-later.
   - **KEEP** — anything actively in use today, an unread email/doc draft, a known work surface (Gmail, Linear, GitHub PRs).
   - **ASK** — ambiguous tabs the user needs to weigh in on.
3. Present the buckets. Wait for explicit confirmation. Only then call `browser_close_tab` on the CLOSE list.

## Output format

```
**Tab triage — N open**

**Close (M)**
- <title> — <domain>
- <title> — <domain>
...

**Read later (M)**
- <title> — <domain>
- <title> — <domain>

**Keep (M)**
- <title> — <domain>

**Ask me about (M)**
- <title> — <domain>
- <title> — <domain>

Reply *close* to close the M tabs in the first list. Reply with tab titles to override.
```

## Rules

- NEVER close a tab without explicit user confirmation.
- Default-bias toward Keep when uncertain — losing a tab is more painful than keeping one.
- If the user has fewer than 10 tabs open, say so + stop. No work needed.
- Treat any tab matching `gmail.com`, `calendar.google.com`, `linear.app`, `github.com/.+/pull/`, or `figma.com` as KEEP unless the user explicitly says otherwise.
