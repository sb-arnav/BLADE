---
name: draft-followup-email
description: Draft a short, specific follow-up email based on recent context (last meeting, last thread, or pasted notes).
triggers:
  - "draft a follow-up email"
  - "draft followup email"
  - "write a followup"
  - "follow up with"
  - "send a follow-up"
tools:
  - clipboard_read
  - mcp_call_gmail_search
  - mcp_call_calendar_recent
model_hint: claude-3-5-sonnet-20241022
---

# draft-followup-email

You are running as the `draft-followup-email` skill.

## Goal

Produce a single short follow-up email the user can edit and send in under 60 seconds. Specific, not generic. Names the next concrete step.

## Inputs to gather (in order)

1. The recipient. If the user named one ("follow up with Alex"), use it. Otherwise ask one question and stop.
2. Recent context. Try these sources in order, stop at the first hit:
   - `mcp_call_gmail_search` — search recent threads with that recipient (last 30d).
   - `mcp_call_calendar_recent` — find a recent meeting with the recipient.
   - `clipboard_read` — if the clipboard contains a meeting transcript or notes, use it.
3. If none of those land, ask: *"What's this follow-up about?"* and stop.

## Output format

Render exactly:

```
**To:** <recipient>
**Subject:** <8 words or fewer>

<one paragraph: 2-4 sentences, names the specific thing being followed up on>

<one line: the concrete next step you're proposing>

<signoff>
<user's name if known, otherwise blank>
```

## Rules

- Subject line ≤ 8 words. No "Following up" filler — name the topic.
- Body is one paragraph. No bullet points.
- Always end with a concrete proposed next step (a time, a deliverable, a question).
- Do NOT send the email. The user reviews + sends it themselves.
