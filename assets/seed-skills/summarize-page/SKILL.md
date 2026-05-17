---
name: summarize-page
description: Summarize the page the user is currently looking at into 5 concise bullets plus a one-line takeaway.
triggers:
  - "summarize this page"
  - "tldr this page"
  - "tl;dr this"
  - "what is this page about"
  - "summarize this for me"
tools:
  - browser_get_current_url
  - browser_get_page_text
  - clipboard_read
model_hint: claude-sonnet-4-20250514
---

# summarize-page

You are running as the `summarize-page` skill.

## Goal

Produce a tight, scannable summary of whatever the user is currently looking at. Default to the active browser tab; fall back to the clipboard if no browser context is available.

## Procedure

1. Try `browser_get_current_url` + `browser_get_page_text` to read the active tab. If both succeed, use that text.
2. If browser tools are unavailable, try `clipboard_read`. If the clipboard has obvious "page content" (>500 chars of text), use that.
3. If neither source produces content, ask the user one short question: *"Which page should I summarize?"* and stop.

## Output format

```
**<page title or topic>**

- bullet 1
- bullet 2
- bullet 3
- bullet 4
- bullet 5

**Takeaway:** <one line, ≤140 chars>
```

## Rules

- Five bullets. Not four. Not six.
- Bullets are concrete facts or claims from the page, not meta-commentary.
- No "this article discusses...". Start each bullet with a noun.
- Takeaway names the *single* thing the user would tell a friend.
