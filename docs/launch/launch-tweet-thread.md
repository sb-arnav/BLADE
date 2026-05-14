# Launch tweet thread

## Posting time

**2 hours before Show HN goes up.** Mon 8am ET (if HN is 10am Mon) or Tue 8am ET (if HN is 10am Tue). Gives the thread enough time to gather initial engagement before HN clicks land — so HN voters see "this is real, people are already talking" not "fresh post with 0 engagement."

## Account

Arnav's main Twitter/X account. If brand-new or under-followed, no boost from an alt — the algorithm reads engagement-rate, not absolute follower count, and a tweet that hits 5k impressions on a 200-follower account looks fine in 2026.

## Tweet 1 — the hook (attach the 75-second forge demo MP4)

```
I asked BLADE to pull my top Hacker News stories. It didn't have a tool for that.

So it wrote one.
Then used it.

(real session, single uncut take)

[attach: docs/launch/assets/forge-demo.mp4]
```

**Notes:**
- No emojis. No bracketed [TAG] prefixes. No "🚀 We're excited to launch."
- The parenthetical "(real session, single uncut take)" pre-empts the "this is staged" reply that killed Devin's launch credibility per the launch research.
- Hard-cut sentences. Each line under 12 words. Reads as terminal output, not marketing.
- The video is the load-bearing element. If the video isn't compelling, the whole thread fails — re-record before posting.

## Tweet 2 — the technical bona fides (reply to tweet 1)

```
BLADE is an open-source desktop AI agent (Tauri + Rust).

The forge primitive: hits a capability gap, writes a new tool, tests it, registers it, keeps going. Persistent — second time, no forge.

One command to install:
curl -sSL slayerblade.site/install | sh

Repo: github.com/sb-arnav/BLADE
```

**Notes:**
- "Open-source" in tweet 2, not tweet 1. Tweet 1 is the hook; tweet 2 is the proof.
- Install command on its own line, no backticks (Twitter strips formatting). Reads as a copyable string.
- Repo link last so it doesn't compete with the install command for clicks.

## Tweet 3 — the reply bait (reply to tweet 2)

```
What would you give it a tool for?

I'll record it doing whatever wins the thread.
```

**Notes:**
- Question + offer. Question generates replies (algo weight); offer commits you to follow-up content (next week's thread fuel).
- "Whatever wins the thread" creates a competitive frame — voters pile on for the response they want recorded.
- Don't ask for upvotes/RTs. Algo penalizes "boost this" phrasing in 2026.

## Tweet 4 — optional, only post if first 3 are landing (≥50 likes by hour 2)

```
For context — the forge moment in the demo is the v2.0 Hacker News fixture firing. BLADE handles arXiv, RSS, PyPI metadata + adds new ones live.

The whole thing is local. Pick your provider — Claude, GPT, Groq, Gemini, Ollama. Your model. Your machine. Your tools.
```

**Notes:**
- Save this one. If tweets 1–3 are flat, posting tweet 4 makes the thread look desperate. Only fire on green light.
- Multi-provider message + local-first lands AFTER the demo has done its work. Lead with action, follow with values.

## Show HN cross-link (post 30 minutes after HN goes up, ONLY if HN post survives — top of front page, ≥10 upvotes, no fast flag)

```
Show HN is up if you want to dig deeper on the architecture:
news.ycombinator.com/item?id=[fill in]
```

**Notes:**
- Posted as a reply to tweet 3 (the reply-bait), not as a new tweet. Keeps the thread engagement consolidated.
- "If you want to dig deeper" is permission language — readers self-select to HN if they're technical.
- DO NOT post the HN link from a fresh account or via a bot. HN's anti-circle-jerk filter catches this within hours and flags the submission.

## What NOT to do

- ~~Quote-tweet other AI launches saying "BLADE does this too!"~~ Cringes, looks small.
- ~~Tag every AI Twitter influencer in the thread.~~ Auto-flag for spam.
- ~~Post on the weekend.~~ Tech Twitter weekend engagement is half weekday. Mon/Tue only.
- ~~Add a thread emoji 🧵.~~ Reads as marketing. Twitter algo doesn't need it; the reply structure already builds the thread.
- ~~Schedule via Buffer/Hootsuite/etc.~~ Live-posting from the Twitter app/web is treated better by the algo than third-party posters.

## Followup posts (next 7 days)

Day +1: Reply to top comment in tweet 1 with a 30s "BLADE doing the thing the commenter asked for" clip. (Per tweet 3 commitment.) Reply to top question in tweet 2 thread with a technical explanation.

Day +2: New tweet on the @sb-arnav account: *"The HN post hit [N] points yesterday. Here's what I learned about how people use BLADE in the first 100 installs — [link to a docs/launch/post-launch-learnings.md you write after the dust settles]."* Shows real engagement, not vanity metrics.

Day +5: Reply with a screen recording of "BLADE writing a tool for [the most-replied-to request from tweet 3]." Continues the thread engagement past the launch spike.

Day +7: One synthesis tweet: *"Top 3 things people built BLADE tools for this week. None of these existed in the codebase 7 days ago."* Cements the forge-as-real-thing positioning.

## Reply-management rules

- **First 30 min:** reply to every comment. Even "looks cool" gets a thank + one follow-up question.
- **30 min – 2h:** reply to comments with substance; like the rest.
- **After 2h:** reply only to technical questions or feature suggestions. The thread is in algo-mode, less needs hand-holding.
- **Never:** delete a negative comment. Reply once with the most charitable response, then drop it. The downvote ratio is what kills threads, not single negative comments.
