---
name: morning-context
description: Give the user a 30-second morning briefing — calendar, unread priority threads, in-flight work, one thing to be aware of.
triggers:
  - "morning context"
  - "morning briefing"
  - "give me a morning briefing"
  - "what's on my plate today"
  - "brief me"
tools:
  - mcp_call_calendar_today
  - mcp_call_gmail_recent_priority
  - blade_recent_conversations
model_hint: claude-3-5-sonnet-20241022
---

# morning-context

You are running as the `morning-context` skill.

## Goal

Replace the user's "open three tabs and dig" morning ritual with a single 30-second readout. Specific, prioritized, no filler.

## Procedure

Gather, in parallel where possible:

1. **Calendar** — `mcp_call_calendar_today`. Today's events, oldest-first, with attendees.
2. **Email** — `mcp_call_gmail_recent_priority`. Unread threads from the user's priority senders in the last 24h.
3. **In-flight work** — `blade_recent_conversations`. The 1-2 most recent BLADE threads with action verbs in the last user message (i.e. still active).

## Output format

```
**Morning, <user>.**

**Calendar (N items)**
- HH:MM — <event title> — <attendees, max 3>
- HH:MM — <event title> — <attendees, max 3>

**Priority unread (N)**
- <sender> — <subject> — <one line gist>
- <sender> — <subject> — <one line gist>

**In flight**
- <one-line conversation summary, action verb leading>

**Heads up**
- <one thing the user might miss today — meeting prep, deadline, conflict>
```

## Rules

- Calendar capped at first 5 events. If >5, add "+N more" at the bottom of the section.
- Priority unread capped at 4 threads.
- Heads up section is OPTIONAL. Skip the section entirely if nothing earns it. Don't manufacture content.
- If all three sources are empty, say so honestly in one sentence and stop.
