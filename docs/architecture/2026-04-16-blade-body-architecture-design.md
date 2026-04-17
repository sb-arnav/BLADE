# BLADE Body Architecture

**Date:** 2026-04-16
**Updated:** 2026-04-17 — backend-state table verified against source (178 `.rs` files, 764 `#[tauri::command]`s, 73 event-emit sites, 10 tentacles, 4 heads, 10 hormones, 12 body systems, 149 modules mapped in `body_registry.rs`).
**Status:** Design (vision) + live implementation status at bottom.
**Scope:** Full architectural redesign — how every part of BLADE connects, communicates, and evolves.

---

## The Metaphor (and it's not just a metaphor)

BLADE is a living body installed on your machine.

- **Skin** — the only thing the user touches. Speaks, shows, listens. Zero intelligence.
- **Brain** — receives intent from Skin. Understands the body's anatomy. Delegates ALL real work. Assembles results. Never touches the outside world directly.
- **Organs** — specialist agents that LIVE inside platforms. Always alive. Always maintaining their space. Each one is an expert in one place. They don't wait to be asked.
- **Nervous System** — how everything communicates. Shared state, shared knowledge, event bus.
- **Immune System** — self-evolution. When the body can't do something, it grows a new organ.
- **DNA** — the shared understanding of who the user is. Every organ reads from and writes to this. It's what makes BLADE *yours*.

---

## Layer 0: DNA (Shared Knowledge)

Every organ contributes to and reads from a shared knowledge layer. This is not one file — it's a structured collection that represents BLADE's understanding of the user and their world.

### Identity Files

| File | What It Captures | Who Writes | Who Reads |
|------|-----------------|------------|-----------|
| `identity.md` | Name, role, company, timezone, language, bio | Deep Scan, User | Every organ |
| `voice.md` | How the user communicates — per platform, per person, per formality level. Vocabulary, sentence structure, emoji usage, humor style | Slack Organ, Email Organ, Social Organs, Chat history | Any organ that writes on behalf of user |
| `personality.md` | Big-5 traits, decision-making style, risk tolerance, communication preferences, pet peeves | All organs observe and contribute | Brain (for delegation style), Communication organs |
| `goals.md` | Short-term (this week), medium-term (this quarter), long-term (career/life). Active projects. What the user is trying to achieve right now | User directly, Journal Organ, Project Organs | Brain (prioritization), Proactive suggestions |
| `preferences.md` | Tools, themes, notification settings, work hours, do-not-disturb rules, delegation comfort levels per category | User directly, Learning from behavior | Every organ (respect boundaries) |

### Relationship Files

| File | What It Captures | Who Writes | Who Reads |
|------|-----------------|------------|-----------|
| `people/{name}.md` | Per-person profile: role, relationship, communication style with them, response priority, last interaction, shared context, how user talks to them specifically | Slack/Email/Calendar/Social Organs | Any organ replying to or about this person |
| `teams/{team}.md` | Team composition, dynamics, communication norms, decision-making patterns, standup format | Meeting Organ, Project Organ, Slack Organ | Brain (when delegating team-related tasks) |
| `companies/{company}.md` | Tech stack, infrastructure, repos, deploy pipelines, conventions, org chart, key contacts | GitHub Organ, Cloud Organ, Deep Scan | Dev organs, Ops organs, Brain |

### Observation Files

| File | What It Captures | Who Writes | Who Reads |
|------|-----------------|------------|-----------|
| `patterns.md` | Recurring behaviors: "user always reviews PRs before standup", "checks email at 9am and 3pm", "deploys on Fridays" (with confidence scores) | Activity Organ, all platform organs | Brain (anticipation), Proactive engine |
| `expertise.md` | What user knows well, what they're learning, what they struggle with. Per-domain skill map | GitHub Organ (languages/frameworks), Screen Organ (what they read/study), Chat history | Brain (calibrate explanations), Dev organs |
| `journal/{date}.md` | Daily record: what happened, what was accomplished, blockers, mood signals, key decisions | Journal Organ (auto-generated from all organ reports) | User directly, Brain (context for today) |
| `decisions.md` | Decisions made with context and outcome. "Chose Postgres over MongoDB because X. Outcome: Y" | Brain (records delegations), User | Brain (avoid repeating mistakes) |
| `incidents.md` | Things that went wrong: production outages, missed deadlines, miscommunications. What caused them, what was learned | Ops Organ, Dev Organ, Comms Organ | Brain (risk assessment), relevant organs |

### World Model

| File | What It Captures | Who Writes | Who Reads |
|------|-----------------|------------|-----------|
| `infrastructure.md` | Servers, databases, services, domains, SSL certs, cloud accounts, regions, costs | Cloud Organ, Ops Organ, Deep Scan | Dev/Ops organs, Brain |
| `codebases/{repo}.md` | Architecture, entry points, hot paths, test coverage, dependencies, conventions, recent changes | GitHub Organ, Indexer | Dev organs, Brain |
| `services.md` | SaaS tools in use: what, why, who manages them, costs, renewal dates | Deep Scan, Browser Organ, Finance Organ | Brain, relevant organs |
| `integrations.md` | What BLADE is connected to, authentication state, health status, capabilities per connection | Immune System, all organs | Brain (knows what's possible), Immune System |

---

## Layer 1: Skin (User Interface)

The Skin has exactly three capabilities:

### 1. Listen
- Text input (chat)
- Voice input (push-to-talk or always-on)
- Image input (screenshots, photos, drag-and-drop)
- File input (drag-and-drop)
- Gesture input (clicks on suggestions, approvals, dismissals)

### 2. Speak
- Text responses (streaming, markdown)
- Voice responses (TTS)
- Sounds (notification chimes, task completion, alerts)

### 3. Show
- Chat messages (the conversation)
- Live cards (Omi-style contextual cards that appear/disappear):
  - "Currently watching: VS Code — auth.rs"
  - "Slack: 3 messages waiting"
  - "Deploy succeeded 2 min ago"
  - "Meeting in 15 min — prep notes ready"
- Dashboards (hive status, organ health, activity feed)
- Previews (before posting to X, before sending an email, before merging a PR)
- Approval prompts (with context, not just "allow Y/N")
- Progress indicators (multi-step tasks showing which organ is working)

### What Skin does NOT do
- Think
- Decide
- Route
- Process
- Remember

Skin receives everything pre-assembled from Brain. If Brain says "show this card", Skin shows it. If Brain says "stream these words", Skin streams them.

---

## Layer 2: Brain (Orchestrator)

Brain is ONE model call that receives the user's intent and produces a plan. It does not execute the plan — it delegates.

### What Brain Knows (its system prompt)

```
1. Who the user is (from identity.md — 5 lines max)
2. The body's anatomy — a registry of every organ:
   - Name
   - What it's expert in
   - What it can do (capabilities list)
   - Current status (active/dormant/error)
   - What it's been observing lately (1-line summary per organ)
3. Current moment:
   - What user is doing right now (from Screen Organ — 1 line)
   - Time, day, timezone
   - Any urgent items (from organ alerts — max 3 lines)
4. Conversation history (last N turns with this user)
```

That's it. ~2000-4000 tokens. Small. Focused. No hallucination bait.

### What Brain Does

Given a user message, Brain produces a **plan** — a JSON array of steps:

```json
{
  "understanding": "User wants to post on X about current work",
  "plan": [
    {"organ": "screen", "action": "get_current_activity", "reason": "what is user working on right now"},
    {"organ": "journal", "action": "get_today", "reason": "what has user done today"},
    {"organ": "github", "action": "get_recent_commits", "reason": "what code changes happened"},
    {"organ": "social.x", "action": "get_profile_context", "reason": "user's X voice, audience, premium status"},
    {"tool": "synthesize", "inputs": ["screen", "journal", "github"], "instruction": "combine into a coherent summary of what user is working on"},
    {"tool": "generate", "inputs": ["synthesis", "social.x_context"], "instruction": "write X post in user's voice, respect character limits, suggest media attachments"},
    {"organ": "browser", "action": "post_to_x", "inputs": ["generated_post"], "reason": "open X in Arc, upload post"}
  ],
  "approval_needed": true,
  "show_preview": true
}
```

Brain is a PLANNER, not an executor. It knows the anatomy, it knows what each organ can do, and it knows how to break a task into organ-level operations.

### Brain's Decision Framework

For every user message, Brain classifies:

| Dimension | Options | Example |
|-----------|---------|---------|
| **Complexity** | Single-organ / Multi-organ / Multi-step | "what time is it" = single, "post on X" = multi-step |
| **Urgency** | Immediate / Can wait / Background | "call 911" = immediate, "organize downloads" = background |
| **Risk** | Reversible / Irreversible / Destructive | "draft email" = reversible, "send email" = irreversible, "drop database" = destructive |
| **Approval** | Auto / Preview / Confirm / Block | Based on risk + user's autonomy settings |
| **Capability** | Can do / Partially can / Cannot do → Evolve | If missing capability → trigger Immune System |

---

## Layer 3: Organs (Specialist Agents)

Each organ is a PERSISTENT agent that:
1. Lives inside a specific platform or domain
2. Is always running (polling, watching, maintaining)
3. Has its own small, focused LLM prompt (~500-1000 tokens)
4. Contributes to DNA files continuously
5. Responds to Brain's requests with structured data
6. Can act autonomously within its domain (based on autonomy level)

### Communication Organs

| Organ | Lives In | Always Doing | Can Do On Command | Contributes To |
|-------|----------|-------------|-------------------|----------------|
| **Slack** | Slack workspace | Reading channels, classifying messages, tracking who's waiting for responses, understanding team dynamics | Reply as user, summarize channels, find messages, create channels, manage threads | voice.md, people/*.md, teams/*.md, patterns.md |
| **Email** | Gmail/Outlook | Triaging inbox (Critical/Response/FYI/Spam), detecting invoices, tracking response times | Draft replies, send (with approval), unsubscribe, forward, archive, search | people/*.md, voice.md, services.md |
| **Discord** | Discord servers | Monitoring mentions, moderating, tracking community health | Reply, moderate, summarize, welcome members, manage roles | people/*.md, voice.md |
| **WhatsApp** | WhatsApp (via browser) | Reading messages, tracking response urgency, detecting family/personal patterns | Draft replies (never auto-send without approval), summarize | people/*.md, voice.md |
| **LinkedIn** | LinkedIn | Monitoring messages, connection requests, engagement opportunities | Reply to recruiters, engage with network posts, draft thought leadership | people/*.md, voice.md, expertise.md |
| **X/Twitter** | X/Twitter | Monitoring mentions, DMs, engagement on posts, trending topics in user's domain | Post, reply, retweet, schedule, draft threads | voice.md, expertise.md |
| **Calendar** | Google Cal / Outlook | Tracking upcoming meetings, detecting conflicts, monitoring free/busy | Schedule, reschedule, decline, create prep notes, block focus time, post-meeting notes | patterns.md, people/*.md, journal/*.md |
| **Meetings** | Zoom/Teams/Meet | Listening to meetings (when permitted), extracting action items, noting decisions | Generate meeting notes, create follow-up tasks, summarize | people/*.md, decisions.md, journal/*.md |

### Development Organs

| Organ | Lives In | Always Doing | Can Do On Command | Contributes To |
|-------|----------|-------------|-------------------|----------------|
| **GitHub** | GitHub repos | Watching PRs, issues, CI status, releases, security alerts, contributor activity | Review PRs, triage issues, create PRs, merge, release, write changelogs | codebases/*.md, expertise.md |
| **IDE** | VS Code / Cursor (via extension or screen reading) | Watching what user is editing, detecting errors, understanding current focus | Suggest refactors, navigate code, explain code, run commands | expertise.md, patterns.md, journal/*.md |
| **Terminal** | Shell history / screen reading | Watching commands, detecting failures, tracking long-running processes | Suggest commands, kill hung processes, explain errors | expertise.md, patterns.md |
| **CI/CD** | GitHub Actions / Jenkins / etc | Monitoring all pipelines, detecting failures, tracking build times | Trigger builds, restart failed, auto-fix trivial failures (lint, format) | codebases/*.md, incidents.md |
| **Database** | Postgres / MySQL / MongoDB | Monitoring query performance, watching for slow queries, schema tracking | Run queries (read-only by default), suggest indexes, generate migrations | infrastructure.md |
| **Logs** | Application logs / Sentry | Tailing logs, detecting anomalies, correlating errors across services | Search logs, create error groups, link errors to deploys | incidents.md, infrastructure.md |

### Operations Organs

| Organ | Lives In | Always Doing | Can Do On Command | Contributes To |
|-------|----------|-------------|-------------------|----------------|
| **Cloud** | AWS / GCP / Azure | Monitoring costs, resource utilization, predicting budget overruns | Provision, scale, tear down (with approval), generate cost reports | infrastructure.md, services.md |
| **Servers** | VPS / K8s / Docker | Watching CPU/RAM/disk, detecting zombie processes, monitoring uptime | Restart services, scale pods, clean disk, run health checks | infrastructure.md, incidents.md |
| **DNS/SSL** | Cloudflare / registrars | Monitoring cert expiry, DNS propagation, CDN performance | Update records, renew certs, flush cache | infrastructure.md |
| **Monitoring** | Grafana / Datadog / PagerDuty | Watching dashboards, correlating alerts, tracking SLAs | Acknowledge alerts, create incidents, silence noise | incidents.md, infrastructure.md |

### Personal Organs

| Organ | Lives In | Always Doing | Can Do On Command | Contributes To |
|-------|----------|-------------|-------------------|----------------|
| **Screen** | Desktop (perception_fusion) | Watching active window, reading OCR text, detecting errors, tracking focus | Capture screenshots, describe what's visible, detect what app is active | patterns.md, journal/*.md, expertise.md |
| **Browser** | Arc / Chrome (CDP) | Tracking tabs, reading page content on dwell time >2min, detecting phishing | Navigate, fill forms, download, take screenshots, automate web tasks | patterns.md, services.md |
| **Files** | Local filesystem | Watching Downloads, detecting duplicates, tracking project directories | Organize, move, archive, search, clean up | codebases/*.md |
| **Journal** | Obsidian vault | Maintaining daily notes from all organ reports, weekly summaries, monthly reviews | Create entries, link notes, search history, generate reports | journal/*.md (primary writer) |
| **Finance** | Bank accounts, Stripe, invoicing | Tracking transactions, detecting subscriptions, monitoring spending patterns | Generate reports, flag anomalies, track invoices, tax summaries | services.md |
| **Health** | Screen time, break patterns, posture (future: wearables) | Correlating screen time with productivity, detecting burnout signals | Force breaks, suggest exercise, report trends | patterns.md |
| **Music/Media** | Spotify / YouTube | Tracking listening patterns, understanding mood from music choices | Play, pause, create playlists, queue songs, summarize podcasts | personality.md |
| **Smart Home** | Home Assistant / IoT | Monitoring devices, tracking home state | Control lights, temperature, locks, cameras | preferences.md |
| **Notes** | Obsidian / Notion / Apple Notes | Indexing all notes, tracking knowledge base, detecting stale info | Create, search, link, summarize, update stale docs | expertise.md |

### Project Organs (one per active project)

| Organ | Lives In | Always Doing | Can Do On Command | Contributes To |
|-------|----------|-------------|-------------------|----------------|
| **Project-{name}** | The project's full context | Watching repo, tracking issues, understanding architecture, monitoring CI | Full project awareness: code, issues, PRs, deploys, team, docs | codebases/{repo}.md |

### Business Organs (when user runs a company)

| Organ | Lives In | Always Doing | Can Do On Command | Contributes To |
|-------|----------|-------------|-------------------|----------------|
| **Hiring** | Job boards, applicant tracking | Screening resumes, scheduling interviews, tracking pipeline | Draft job posts, evaluate candidates, send updates | people/*.md, teams/*.md |
| **Analytics** | Mixpanel / PostHog / GA | Watching key metrics, detecting drops correlated with deploys | Generate reports, run queries, compare time periods | companies/{company}.md |
| **Support** | Zendesk / Intercom / email | Reading tickets, classifying urgency, detecting patterns | Draft responses in company voice, escalate, close resolved | people/*.md |
| **Legal/Compliance** | Contracts, policies | Tracking contract renewals, compliance deadlines | Review contracts, flag risks, generate summaries | companies/{company}.md |

---

## Layer 4: Nervous System (Communication)

### How Organs Talk to Brain

Every organ exposes a standard interface:

```
organ.query(action, params) → structured result
organ.status() → health + 1-line summary of current state
organ.recent_observations() → last 3 notable things it noticed
```

Brain calls organs through this interface. Organs respond with structured data, not free text. The Brain's LLM interprets the structured data, not the organ's LLM.

### How Organs Talk to Each Other

Organs don't call each other directly. They communicate through DNA files:
- Slack Organ writes to `people/john.md`: "John seems frustrated in #engineering today"
- Email Organ reads `people/john.md` when drafting a reply to John: adjusts tone
- Calendar Organ reads `people/john.md` when scheduling with John: suggests async instead

And through an event bus:
- GitHub Organ emits: `deploy_failed{repo: "api", branch: "main", error: "..."}`
- Slack Organ receives: auto-posts to #incidents
- Logs Organ receives: starts tailing error logs
- Ops Organ receives: checks server health

### How Brain Assembles Results

Brain's plan is a DAG (directed acyclic graph). Steps can run in parallel when they don't depend on each other:

```
Step 1 (parallel): screen.get_activity + journal.get_today + github.get_recent
Step 2 (depends on 1): synthesize all inputs
Step 3 (parallel with 2): social.x.get_context
Step 4 (depends on 2+3): generate post
Step 5 (depends on 4): preview to user
Step 6 (depends on user approval): browser.post_to_x
```

This is what the Swarm system already does. Brain produces the DAG, Swarm executes it.

---

## Layer 5: Immune System (Self-Evolution)

This is what makes BLADE not just an automation tool but something that GROWS.

### When BLADE Can't Do Something

The Brain detects capability gaps:

```
User: "Upload this video to YouTube"
Brain: I need a YouTube organ. I don't have one.
       → Trigger Immune System
```

### Immune System Response

```
1. SEARCH: Can I find a tool for this?
   - Check MCP server registry (official + community)
   - Check NPM / pip / cargo for CLI tools
   - Check if browser automation can do it (CDP)
   - Check if an existing organ can stretch (browser organ → YouTube via web)

2. ACQUIRE: Get the capability
   - Install MCP server → new organ with full tool access
   - Install CLI tool → new native tool available to existing organs
   - Build browser automation → teach browser organ a new workflow
   - Spawn Claude Code → write a custom integration

3. INTEGRATE: Wire it into the body
   - Register new organ in the anatomy registry
   - Update Brain's knowledge of available organs
   - Set initial autonomy level (low — ask for everything)
   - Start the organ's always-on monitoring loop

4. LEARN: Improve over time
   - Track success/failure of the new capability
   - Adjust autonomy based on user feedback
   - The organ gets better as it observes the user's patterns
```

### Examples of Self-Evolution

| User Request | Missing Capability | Immune Response |
|-------------|-------------------|-----------------|
| "Upload video to YouTube" | No YouTube organ | Install YouTube MCP or build CDP automation for youtube.com |
| "Play Minecraft for me" | No gaming capability | Install game automation framework, build screen-reading game agent, learn controls from observation |
| "Monitor my Shopify store" | No Shopify organ | Discover Shopify MCP server, install, spawn organ, begin monitoring |
| "Track my workouts" | No fitness organ | Connect to Apple Health/Google Fit API, or read fitness app via screen organ |
| "Manage my Terraform" | No IaC organ | Install Terraform CLI, learn state files, spawn IaC organ |
| "Reply to Reddit comments" | No Reddit organ | Build CDP automation for reddit.com, learn user's Reddit voice from history |
| "Trade crypto for me" | No trading capability | Install exchange API, but BLOCK autonomous trading (max risk) — require approval for every trade |
| "Write and deploy a new microservice" | Needs full SDLC chain | Spawn Claude Code for coding, use GitHub organ for PR, CI organ for pipeline, Cloud organ for deploy — orchestrate as multi-organ operation |

### The Forge (tool_forge.rs — already exists)

When no existing tool or MCP server can do the job, BLADE can BUILD tools:

1. Brain identifies the capability gap
2. Brain writes a spec for the needed tool (inputs, outputs, behavior)
3. Forge spawns Claude Code / Codex to build the tool
4. Tool is tested in sandbox
5. Tool is registered as a native tool or MCP server
6. Organ that needs it gets access

This means BLADE's capability set is unbounded. If it can be done on a computer, BLADE can eventually do it — by building the tool itself.

---

## Layer 6: Access & Authentication

### How BLADE Gains Access to Platforms

| Method | Platforms | How It Works |
|--------|----------|-------------|
| **OAuth** | GitHub, Google (Gmail, Calendar, Drive), Slack, Discord, LinkedIn, Twitter, Spotify, Notion | BLADE runs OAuth flow in browser, stores tokens in OS keychain |
| **API Keys** | OpenAI, Anthropic, AWS, Stripe, Datadog, PagerDuty, custom APIs | User provides keys, stored in OS keychain, never logged |
| **MCP Servers** | Any platform with an MCP server | Auto-discovered or manually added, runs as subprocess |
| **Browser Control (CDP)** | ANY website — WhatsApp Web, YouTube, Reddit, Shopify, banking, anything | BLADE controls the browser, logs in as user, operates the UI |
| **Screen Reading** | ANY application | OCR + active window detection — works with zero setup |
| **File System** | Local machine | Direct access — reads configs, project files, dot files |
| **CLI Tools** | git, docker, kubectl, terraform, aws-cli, etc. | Uses tools already installed or installs them |
| **SSH** | Remote servers | Uses existing SSH keys, establishes connections |
| **Database Connections** | Postgres, MySQL, MongoDB, Redis | Connection strings from env files or user-provided |

### Access Discovery (Deep Scan + Continuous)

BLADE doesn't wait for the user to set everything up. It discovers:

1. **Startup scan** (deep_scan.rs — already exists):
   - Scans for `.env` files → database connections, API keys
   - Scans for `.git` repos → GitHub/GitLab remotes
   - Scans for config files → `~/.aws`, `~/.kube`, `~/.ssh`
   - Scans for installed apps → detects Slack, Discord, VS Code, etc.
   - Scans for MCP configs → Claude Code, Codex server definitions

2. **Continuous discovery** (organs report back):
   - Screen organ sees Slack → "user has Slack, not connected yet"
   - Browser organ sees Jira → "user uses Jira, should I connect?"
   - File organ finds `.env.production` → "found production database credentials"
   - Each discovery → prompt user: "I noticed you use X. Want me to connect to it?"

3. **Progressive trust**:
   - First connection: ask for everything, explain what BLADE will do
   - After 10 successful autonomous actions: suggest raising autonomy
   - After 100: suggest full autonomy for low-risk actions
   - Destructive actions: ALWAYS require approval, forever

---

## Layer 7: Autonomy Gradient

Not every action needs the same level of permission. BLADE operates on a gradient:

| Level | Actions | Default Setting |
|-------|---------|----------------|
| **0 — Observe** | Read messages, monitor services, watch screen, index files | Always on |
| **1 — Inform** | Surface information: "you have 3 unread", "CI failed", "meeting in 15 min" | Always on |
| **2 — Suggest** | Draft replies, propose fixes, recommend actions — but don't execute | Default for new organs |
| **3 — Act with preview** | Execute but show preview first: "I'll post this to X. OK?" | After trust builds |
| **4 — Act and report** | Execute and tell user after: "Posted to X. Here's the link." | For trusted, reversible actions |
| **5 — Act silently** | Execute without telling user unless something goes wrong | Only for routine, proven patterns |

Each organ has its own autonomy level. Each action type within an organ can have its own level:
- Slack organ: read messages = level 5, reply to routine = level 4, reply to boss = level 2
- GitHub organ: auto-merge dependabot = level 5, merge feature PR = level 3, force push = NEVER

Autonomy levels adjust based on:
- User feedback (approved → raise, rejected → lower)
- Success rate (consistent success → gradual raise)
- Risk level (destructive actions have a ceiling)
- Relationship (messages to family → lower autonomy than messages to newsletters)

---

## How It All Flows: End-to-End Examples

### Example 1: "Post on X about what I'm working on"

```
SKIN receives text message

BRAIN receives intent + current context:
  - Screen Organ status: "VS Code — blade/src-tauri/src/hive.rs, editing for 45 min"
  - No urgent alerts
  
BRAIN produces plan:
  1. [parallel] 
     - screen.get_detailed_activity → "editing hive.rs, the distributed agent mesh"
     - journal.get_today → "refactored perception_fusion, fixed self_critique double-call bug, working on hive architecture"
     - github.get_recent_commits → "3 commits: perception loop, ambient refactor, LLM wrapper cleanup"
  2. social.x.get_profile_context → "user has premium, 2800 followers, tech audience, usually posts about building in public, prefers concise + slightly irreverent tone, often includes code snippets"
  3. [tool: synthesize] combine activity data → "user spent the day building a distributed AI agent system (BLADE) — merged perception layers, fixed API call waste, now designing the full hive architecture"
  4. [tool: generate] write post → "spent today teaching my AI agent to stop being wasteful — found it was making the same API call twice on every response. also designing the 'hive' architecture where every platform you use gets its own dedicated AI agent that runs 24/7. the main model just orchestrates. thread? 🧵"
  5. [tool: check] verify: under 280 chars? has media suggestion? → "attach screenshot of the hive architecture diagram"
  6. PREVIEW to user via Skin
  7. [on approval] browser.open_x_and_post

SKIN shows: preview card with the post, character count, suggested image attachment
USER approves (or edits)
BROWSER ORGAN executes: opens X in Arc, pastes post, attaches image, submits

POST-ACTION:
  - Journal organ records: "posted on X about hive architecture"
  - Social.x organ records: "post sent, tracking engagement"
  - Patterns: "user posts about work around 8pm, usually after a productive coding session"
```

### Example 2: User is stuck debugging for 30 minutes (no explicit request)

```
SCREEN ORGAN notices: same file open for 30 min, terminal showing repeated error, clipboard has same error 3 times

SCREEN ORGAN → event bus: "user_stuck{file: auth.rs, error: borrow_checker, duration: 30min}"

BRAIN receives event (not from Skin — from organ):
  - Checks autonomy level for proactive assistance
  - Checks patterns.md: "user prefers being offered help after 15 min of stuck, not before"

BRAIN produces plan:
  1. screen.get_error_details → full error text + file context
  2. github.get_file_history → recent changes to this file
  3. [tool: analyze] understand the error with code context
  4. [tool: generate] produce a fix suggestion

SKIN shows: gentle card (not intrusive):
  "Looks like you've been fighting a borrow checker issue in auth.rs for 30 min. 
   I think the issue is on line 142 — you're trying to mutate through an immutable reference.
   Want me to show you a fix?"

USER: "yeah fix it"

BRAIN → IDE organ: apply fix
IDE ORGAN: modifies file, runs cargo check, confirms it compiles

SKIN: "Fixed. The issue was [explanation]. cargo check passes."

POST-ACTION:
  - expertise.md updated: "user encountered borrow checker issue with shared references — showed them Arc<Mutex> pattern"
  - patterns.md updated: "stuck detection → proactive help accepted after 30 min (adjust threshold to 20 min next time)"
```

### Example 3: BLADE managing a company's morning

```
6:00 AM — No user interaction. Organs are working.

EMAIL ORGAN: triaged overnight inbox
  - 2 Critical (client escalation, production alert)
  - 5 Response needed (team questions, vendor follow-up)
  - 12 FYI
  - 23 Spam (auto-archived)

SLACK ORGAN: scanned overnight messages
  - #incidents: resolved P2, no action needed
  - #engineering: 2 questions waiting for user's input
  - DM from CTO: "can we discuss the Q3 roadmap today?"

GITHUB ORGAN: overnight activity
  - 3 PRs merged by team (all CI green)
  - 1 PR waiting for user's review (from junior dev, 47 lines)
  - 2 dependabot PRs (auto-merged, tests pass)
  - 1 security advisory on a dependency

CALENDAR ORGAN: today's schedule
  - 9:00 standup (15 min)
  - 11:00 1:1 with CTO (prep notes: they want to discuss Q3 roadmap — see Slack DM)
  - 14:00 design review (prep: PR #47 is the subject)

JOURNAL ORGAN: writes morning entry
  - Compiles all organ reports into today's daily note

8:30 AM — User opens BLADE

SKIN shows morning briefing (Omi-style cards):
  ⚡ Client escalation email — needs response before 9am standup
  📋 Standup in 30 min — yesterday you worked on hive architecture, today's plan TBD
  👀 PR #47 needs your review (47 lines, junior dev, touches auth module)
  🔒 Security advisory: lodash vulnerability — dependabot PR ready to merge
  💬 CTO wants to discuss Q3 roadmap in your 11am 1:1
  
USER: "handle the security advisory and prep me for standup"

BRAIN produces plan:
  1. github.merge_dependabot_pr → auto-merge the lodash fix
  2. [parallel] journal.get_yesterday + github.get_recent_activity → standup context
  3. [tool: generate] standup update: "yesterday: shipped perception fusion refactor + self-critique fix. today: continuing hive architecture design. blockers: none"
  
SKIN shows: "Merged lodash security fix. Here's your standup update: [preview]. Want me to post it to #standup?"
```

### Example 4: BLADE can't do something — self-evolution

```
USER: "Monitor my Kubernetes cluster for anomalies"

BRAIN: I need a Kubernetes organ. Checking anatomy... not found.
BRAIN → IMMUNE SYSTEM: capability gap — Kubernetes monitoring

IMMUNE SYSTEM:
  1. SEARCH:
     - Found: kubectl CLI (already installed on machine ✓)
     - Found: kubernetes MCP server (community registry)
     - Found: user has ~/.kube/config (discovered by deep_scan)
  
  2. ACQUIRE:
     - Install kubernetes MCP server via npx
     - Verify connection with kubectl cluster-info
  
  3. INTEGRATE:
     - Register new organ: "kubernetes"
     - Capabilities: list pods, get logs, describe services, watch events, scale deployments
     - Autonomy: level 2 (suggest only — new organ, low trust)
     - Start monitoring loop: check pod health every 60s
  
  4. REPORT TO USER:
     SKIN: "I didn't have Kubernetes access before, but I found your kubeconfig and set up monitoring. 
            I can now watch your cluster. Currently seeing: 12 pods across 3 namespaces, all healthy.
            I'll alert you if anything goes wrong. Want me to show more detail?"

POST-ACTION:
  - integrations.md updated: "kubernetes — connected via kubeconfig, monitoring active"
  - infrastructure.md updated: cluster topology, namespaces, services
  - New organ running: kubernetes tentacle, 60s polling
```

---

## Implementation Strategy

This is too large for one implementation cycle. The build order matters because each layer enables the next.

### Phase 1: The Bridge (highest leverage, minimal risk)
Wire the existing hive into the chat flow. Brain reads from hive state instead of assembling 17 context priorities. This makes chat immediately smarter while making prompts smaller.

**Changes:** brain.rs gets hive digest, commands.rs routes through Brain planning model instead of direct tool calls.

### Phase 2: DNA Files
Create the shared knowledge structure. Make existing organs (perception_fusion, activity_monitor, people_graph, typed_memory) write to DNA files. Brain reads from DNA files for context.

**Changes:** New file structure in blade config dir, organ writers, brain readers.

### Phase 3: Brain as Planner
Separate the planning model from the chat model. Chat model (Skin) is cheap/fast. Planning model (Brain) is smart/focused. Brain produces DAGs, Swarm executes them.

**Changes:** New planning call in commands.rs, plan-to-swarm converter.

### Phase 4: Immune System
When Brain's plan references an organ that doesn't exist, trigger self-evolution. MCP discovery, CLI installation, browser automation, tool forging.

**Changes:** New capability gap detection in Brain planning, immune_system.rs module.

### Phase 5: Organ Enrichment  
Make each organ actually maintain its DNA files and expose the standard query interface. Start with the organs that have the most existing code (GitHub, Slack, Screen, Email).

**Changes:** Organ interface trait, per-organ DNA writers, query handlers.

### Phase 6: Autonomy Gradient
Implement per-organ, per-action autonomy levels with learning. Each approved action raises trust, each rejected lowers it.

**Changes:** Extend decision_gate.rs with organ-level granularity.

---

## What Already Exists vs What's New

_All rows below verified against live source on 2026-04-17 — every claim cites file path, lines are approximate and may drift as modules evolve. Check the code before relying on line numbers._

### Hive mesh

| Component | Status | Evidence | Gap |
|---|---|---|---|
| Hive tick loop | **Exists** | `src-tauri/src/hive.rs` — tokio 30s loop, TSH-modulated via `homeostasis.rs` | Wire digest into chat context by default (partial today) |
| Tentacles (10) | **Exists** | `src-tauri/src/tentacles/` — github_deep, slack_deep, email_deep, terminal_watch, filesystem_watch, calendar_tentacle, discord_deep, linear_jira, log_monitor, cloud_costs. ~10.5k lines total, 598–1950 per file | Standardize `Tentacle` trait (see "Standard organ interface" below) |
| Head models (4) | **Exists** | `src-tauri/src/tentacles/heads.rs` — CommsHead / DevHead / OpsHead / IntelHead with LLM synthesis | — |
| Big Agent (cross-domain) | **Partial** | Aggregation logic lives inside `hive.rs` rather than a standalone module | Extract to `big_agent.rs` for clean Brain-planner integration |

### Decision & autonomy

| Component | Status | Evidence | Gap |
|---|---|---|---|
| Decision Gate | **Exists** | `src-tauri/src/decision_gate.rs` — `DecisionOutcome { ActAutonomously, AskUser, QueueForLater, Ignore }`, `Signal`, `DecisionRecord` with feedback field, learned per-source thresholds | — |
| Autonomy gradient | **Partial** | `src-tauri/src/organ.rs` — `OrganCapability.autonomy_level ∈ { Autonomous, PromptUser, ReadOnly }`; `hive_set_autonomy(level: f32)` command | Per-action-within-organ granularity; tighter decision_gate ↔ organ-id routing |

### Perception & memory

| Component | Status | Evidence | Gap |
|---|---|---|---|
| Perception Fusion | **Exists** | `src-tauri/src/perception_fusion.rs` — `PerceptionState` (OCR + tags + user_state + vitals), 30s refresh loop | — |
| Activity Monitor | **Exists** | `src-tauri/src/activity_monitor.rs` — window + file tracking | Feed patterns into DNA layer |
| Typed Memory (7 categories) | **Exists** | `src-tauri/src/typed_memory.rs` — `MemoryCategory { Fact, Preference, Decision, Relationship, Skill, Goal, Routine }` + confidence weights | — |
| Memory Palace | **Exists** | `src-tauri/src/memory_palace.rs` — episodic recall, consolidate, add-manual | — |
| Knowledge Graph | **Exists** | `src-tauri/src/knowledge_graph.rs` — entity ↔ relationship, `smart_context_recall` via hybrid BM25+vector | — |
| People Graph | **Exists** | `src-tauri/src/people_graph.rs` + `social_graph.rs` — per-person relationship + style, multi-platform | Wire to DNA `people/*.md` writer |
| Embeddings (fastembed) | **Exists** | `src-tauri/src/embeddings.rs` — hybrid BM25 + vector store | — |
| Dream Mode (idle consolidation) | **Exists** | `src-tauri/src/dream_mode.rs` — triggers at idle 20+ min, prunes typed_memory, promotes long-term | Also prune knowledge_graph + stale people |
| Screen Timeline | **Exists** | `src-tauri/src/screen_timeline.rs` — 30s screenshots (configurable), 5-day retention default, semantic search | — |
| Audio Timeline | **Exists** | `src-tauri/src/audio_timeline.rs` — ambient capture, meeting detection, action-item + decision extraction | — |

### Brain & planning

| Component | Status | Evidence | Gap |
|---|---|---|---|
| Brain Planner (separate LLM → DAG) | **Exists** | `src-tauri/src/brain_planner.rs` — `plan_task()`, plan caching via prefrontal working memory; **wired** from `commands.rs::send_message_stream` before provider call | Tune when planner is invoked vs bypassed (latency tradeoff) |
| Brain prompt assembly | **Exists** | `src-tauri/src/brain.rs` — system prompt builder (identity + context + tools + memory) | — |
| Swarm (DAG orchestration) | **Exists** | `src-tauri/src/swarm.rs` — `SwarmTask { depends_on: Vec<String>, … }`, `is_ready_to_execute()`; `swarm_planner.rs::decompose_goal_to_dag()` | — |

### DNA (shared knowledge)

| Component | Status | Evidence | Gap |
|---|---|---|---|
| DNA module (read-only query layer) | **Partial** | `src-tauri/src/dna.rs` — `get_identity()`, `get_voice()`, `get_person()`, `get_people_context()`; reads `persona.md` from config dir | Design describes a full `.md` file structure (identity / voice / personality / goals / preferences / people/* / teams/* / companies/* / patterns / expertise / journal/* / decisions / incidents / infrastructure / codebases/* / services / integrations). Today those writes happen in source modules to **SQLite**, not markdown — DNA is a read-only facade, not the markdown file manager the design envisions. |
| Brain bible (identity, style tags, prefs, memories, nodes, edges, skills) | **Exists** | `src-tauri/src/brain.rs` commands: `brain_get_identity`, `brain_set_identity`, `brain_get/add_style_tag`, `brain_get/upsert_preference`, `brain_get/add_memory`, `brain_get/upsert_node`, `brain_get/upsert_edge`, `brain_get/upsert_skill`, `brain_add_reaction` | — |

### Body + homeostasis

| Component | Status | Evidence | Gap |
|---|---|---|---|
| Body Registry | **Exists** | `src-tauri/src/body_registry.rs` — maps 149 modules across 12 body systems (cardiovascular, respiratory, nervous, digestive, urinary, reproductive, immune, lymphatic, endocrine, integumentary, skeletal, muscular); commands `body_get_map`, `body_get_system`, `body_get_summary` | — |
| Bio sub-registries | **Exists** | `cardiovascular.rs`, `urinary.rs`, `reproductive.rs`, `joints.rs`, `supervisor.rs`, `prefrontal.rs`, `soul_commands.rs` — each a thin facade over real modules | — |
| Homeostasis (hormone bus) | **Exists** | `src-tauri/src/homeostasis.rs` — `HormoneState` with 10 hormones: arousal, energy_mode, exploration, trust, urgency, hunger, thirst, insulin, adrenaline, leptin. TSH modulates hive tick frequency | Expose hormone stream to UI |
| Organ registry + interface | **Exists** | `src-tauri/src/organ.rs` — `OrganCapability { action, description, mutating, autonomy_level }`, `OrganStatus { name, health, summary, recent_observations, capabilities }`, `OrganQueryResult { success, data, summary, suggested_action }` | Design doc asks for `query(action, params) / status() / recent_observations()` uniform trait across all tentacles; structs exist but tentacles don't yet implement a single trait — each has its own public surface |

### Immune system & evolution

| Component | Status | Evidence | Gap |
|---|---|---|---|
| Immune System | **Exists** | `src-tauri/src/immune_system.rs` — `resolve_capability_gap()` cascade: `check_mcp_catalog → check_cli_tools → can_browser_handle → tool_forge` | — |
| Autoskills | **Exists** | `src-tauri/src/autoskills.rs` — MCP + auth cascade | — |
| Tool Forge | **Exists** | `src-tauri/src/tool_forge.rs` — dynamic tool creation; commands `forge_new_tool / list_tools / delete_tool / test_tool` | — |
| Evolution | **Exists** | `src-tauri/src/evolution.rs` — level, suggestions, catalog, install-suggestion, run-now, log-capability-gap | — |
| Self-Upgrade | **Exists** | `src-tauri/src/self_upgrade.rs` — OTA updates; events `blade_auto_upgraded`, `blade_auto_show`; pentest authorization gate | — |
| Self-Code (introspection) | **Exists** | `src-tauri/src/self_code.rs` + `indexer.rs` + `file_indexer.rs` — `blade_index_project`, `find_symbol`, `project_summary`, `blade_source_path_resolve` | — |
| Auto-Fix pipeline | **Exists** | `src-tauri/src/auto_fix.rs` — `ParsedError`, `FileEdit`, `FixPlan`, `CIFailure`, `FixResult`; analyze → edit → verify → push; events `auto_fix_analyzing/editing/verifying/pushing/complete/failed` | — |

### Proactivity & reasoning

| Component | Status | Evidence | Gap |
|---|---|---|---|
| God Mode (3 tiers) | **Exists** | `src-tauri/src/godmode.rs` — Normal (5min capture) / Intermediate (2min) / Extreme (1min); `ProactiveTask`, `StuckErrorState`, smart-interrupt at 300s | — |
| Proactive Engine | **Exists** | `src-tauri/src/proactive_engine.rs` — 5 signal detectors → routes through decision_gate | — |
| Proactive Vision | **Exists** | `src-tauri/src/proactive_vision.rs` — vision-based cards, focus score | Wire cards to UI |
| Ghost Mode | **Exists** | `src-tauri/src/ghost_mode.rs` — 5s chunk buffer, 120s rolling context, content-protected overlay | — |
| Pulse / morning briefing | **Exists** | `src-tauri/src/pulse.rs` — heartbeat, morning briefings, daily digest; event `blade_briefing` | Omi-style card UI surface |
| Learning Engine | **Exists** | `src-tauri/src/learning_engine.rs` — `BehaviorPattern`, `UserPrediction`; pattern types: time_of_day / topic_cluster / workflow / tool_combo; confidence + recency decay | Feed patterns into DNA |
| Reasoning Engine | **Exists** | `src-tauri/src/reasoning_engine.rs` — `ReasoningStep`, `ReasoningTrace`; step types: decompose / analyze / hypothesize / verify / conclude; mandatory self-critique | Integrate more tightly with Brain Planner |
| Negotiation / Debate | **Exists** | `src-tauri/src/negotiation_engine.rs` — debates, scenarios, steelman, roleplay, critique | — |
| Code Sandbox | **Exists** | `src-tauri/src/code_sandbox.rs` — multi-language safe execution | — |
| Metacognition + Self-critique | **Exists** | `metacognition.rs`, `self_critique.rs` | — |

### Execution plumbing

| Component | Status | Evidence | Gap |
|---|---|---|---|
| Background Agent | **Exists** | `src-tauri/src/background_agent.rs` — subprocess spawning for Claude Code / Aider / Goose / Codex | Persistent sessions vs one-shot |
| Authority Engine | **Exists** | `src-tauri/src/authority_engine.rs` — 9-specialist delegation | — |
| Agent Factory | **Exists** | `src-tauri/src/agent_factory.rs` — NosShip-inspired spawn-from-description | — |
| Managed Agents | **Exists** | `src-tauri/src/managed_agents.rs` — external orchestration | — |
| MCP Client | **Exists** | `src-tauri/src/mcp.rs` (~631 lines) — health monitoring, tool quality ranking, auto-reconnect | — |
| MCP in-process servers | **Exists** | `src-tauri/src/mcp_memory_server.rs` (240 lines), `mcp_fs_server.rs` (401 lines) — memory exposes typed_memory, fs exposes safe file ops | — |
| Integration Bridge | **Exists** | `src-tauri/src/integration_bridge.rs` — persistent MCP polling (Gmail/Calendar/Slack/GitHub) | — |
| Native tools (37+) | **Exists** | `src-tauri/src/native_tools.rs` — bash / files / search / clipboard / browser / system / security / IoT | — |

### Voice, perception I/O

| Component | Status | Evidence | Gap |
|---|---|---|---|
| Voice core | **Exists** | `src-tauri/src/voice.rs` — record, transcribe (file + blob) | — |
| Voice Global (PTT + conversational) | **Exists** | `src-tauri/src/voice_global.rs` | — |
| Wake Word ("Hey BLADE") | **Exists** | `src-tauri/src/wake_word.rs` — configurable phrase + sensitivity | — |
| Whisper local | **Exists** (feature-gated) | `src-tauri/src/whisper_local.rs` — behind `local-whisper` feature flag; default build skips | — |
| Voice Intelligence | **Exists** | `src-tauri/src/voice_intelligence.rs` — emotion, language, session context | — |
| TTS | **Exists** | `src-tauri/src/tts.rs` — speed, interruption event `tts_interrupted` | — |
| VAD | **Exists** | `src-tauri/src/vad.rs` | — |
| Deepgram streaming | **Exists** | `src-tauri/src/deepgram.rs` | — |
| Multimodal (vision) | **Exists** | `src-tauri/src/multimodal.rs` — analyze_file, extract_code, extract_diagram, OCR, analyze_UI | — |
| Document Intelligence | **Exists** | `src-tauri/src/document_intelligence.rs` — ingest, search, answer, cross-synthesis, study notes | — |

### Discovery & access

| Component | Status | Evidence | Gap |
|---|---|---|---|
| Deep Scan (12 scanners) | **Exists** | `src-tauri/src/deep_scan.rs` — system config / installed tools / databases / env / git repos / dependencies / security / networks / hardware / browser extensions / installed apps / recent files | — |
| Discovery | **Exists** | `src-tauri/src/discovery.rs` — capability discovery, MCP discovery | — |

### Skin (UI)

| Component | Status | Evidence | Gap |
|---|---|---|---|
| Streaming chat | **Exists** | `src-tauri/src/commands.rs::send_message_stream` — token + thinking stream, fast-ack, cancel | — |
| Overlay Manager | **Exists** | `src-tauri/src/overlay_manager.rs` — HUD bar, toasts, update loop | — |
| System tray | **Exists** | `src-tauri/src/tray.rs` | — |
| QuickAsk window | **Exists** | Created in `src-tauri/src/lib.rs:1275` — 500×72, transparent, always-on-top; toggled via global shortcut `lib.rs:274` | Cross-platform vibrancy fallbacks |
| Ghost overlay window | **Exists** | Created by `ghost_mode.rs` at runtime | — |

### Summary stats (live)

| Metric | Count |
|---|---|
| Total `.rs` files under `src-tauri/src/` | 178 |
| `#[tauri::command]` functions | 764 |
| `app.emit` / `emit_all` call sites | 73 |
| Tentacle modules | 10 |
| Head models | 4 |
| Typed-memory categories | 7 |
| Homeostasis hormones | 10 |
| Body systems | 12 |
| Modules mapped in `body_registry.rs` | 149 |
| God-mode tiers | 3 |
| Reasoning step types | 5 |
| Deep-scan scanners | 12 |

### What's genuinely still to build (from this design)

1. **DNA as the `.md` file store the design describes.** Today DNA is a thin SQLite-backed query facade. The full `identity.md / voice.md / personality.md / goals.md / preferences.md / people/* / teams/* / companies/* / patterns.md / expertise.md / journal/{date}.md / decisions.md / incidents.md / infrastructure.md / codebases/{repo}.md / services.md / integrations.md` hierarchy is not a live filesystem — it lives as SQLite rows across persona_engine, people_graph, typed_memory. Either rebuild DNA as the markdown writer the design names, or update the design to reflect the SQLite-first reality.
2. **Standard `Organ` trait** across all tentacles. The structs (`OrganCapability`, `OrganStatus`, `OrganQueryResult`) exist, but each tentacle exposes its own ad-hoc surface. A single trait with `query(action, params) / status() / recent_observations()` would let Brain address organs uniformly.
3. **Per-action autonomy granularity** inside each organ. Today autonomy is per-capability enum (Autonomous / PromptUser / ReadOnly) + a per-organ float, but the design calls for learned thresholds that differentiate "reply to routine" vs "reply to boss" within the same organ.
4. **Big Agent extraction** from `hive.rs` into `big_agent.rs` with a clean interface back to Brain Planner. Logic exists; modularity doesn't.
5. **Omi-style card UI surface** for pulse digests + proactive nudges. The backend emits them; the frontend has to render them as ambient cards, not modals.
6. **Identity-bootstrap first run** per design: Deep Scan's 12 scanners already produce the data; the onboarding flow needs to surface findings, ask the 5 persona questions, and hand off to `complete_onboarding`.
