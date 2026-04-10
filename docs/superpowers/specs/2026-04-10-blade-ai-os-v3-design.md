# Blade AI OS v3 — Design Spec
**Date:** 2026-04-10  
**Status:** Approved  
**Scope:** Character Bible (Brain) + Mission DSL + Template Library + Live Operator Dashboard + Brain-Mission integration loop

---

## What This Is

Blade is already the most ambitious personal AI desktop app in existence. Phase 1 shipped core chat, voice, vision, and MCP. Phase 2 shipped a 12-runtime Operator system with mission planning, task graphs, security engagements, and a Claude managed-agent runner.

This spec completes the loop. The Operator can run missions. The Fleet can execute work. But nothing learns from any of it. Every session starts from zero. This spec builds the Brain — and then wires it into everything.

Archon (the closest comparable project) does deterministic workflow orchestration for dev teams via YAML. Blade does this for ONE person, across ALL domains, with a living brain that compounds. This is not the same category.

---

## Architecture

Three layers feeding each other in a perpetual loop:

```
THE BRAIN ──injects context──→ THE OPERATOR ──routes to──→ THE FLEET
     ↑                               │                          │
     └──────── learns from ──────────┘                          │
     ↑                                                          │
     └──────── extracts facts from ────────────────────────────┘
```

- **The Brain** knows who you are. Grows from every conversation, reaction, and mission.
- **The Operator** executes multi-stage missions. Routes each stage to the right runtime.
- **The Fleet** does the work. 12 runtimes already built and detected.
- **Every completed mission makes the Brain smarter.** The smarter Brain makes future missions more personalized. This is the compound loop.

---

## System 1: The Brain (Character Bible)

### Data Model

One canonical SQLite-backed structure. Persisted via `db.rs` using a new `character_bible` table family.

```typescript
interface CharacterBible {
  identity: {
    name: string;
    role: string;
    workingStyle: string[];        // "ships fast", "no fluff", "prefers examples"
    preferences: PreferenceEntry[]; // derived from feedback loop
  };
  knowledge: KnowledgeNode[];      // people, tools, projects, concepts, companies
  relationships: KnowledgeEdge[];  // directed edges: "Arnav works on Blade", "Blade uses Tauri"
  skills: LearnedSkill[];          // auto-discovered patterns → named capabilities
  memories: MemoryEntry[];         // extracted facts, newest-first, with source + TTL
}

interface PreferenceEntry {
  id: string;
  text: string;               // "prefers bullet lists over prose"
  confidence: number;         // 0–1, derived from signal strength
  source: "feedback" | "manual";
  updatedAt: number;
}

interface KnowledgeNode {
  id: string;
  label: string;
  kind: "person" | "project" | "tool" | "concept" | "company" | "url";
  summary: string;
  mentionCount: number;
  lastSeenAt: number;
}

interface KnowledgeEdge {
  from: string;  // node id
  to: string;    // node id
  label: string; // "works on", "uses", "knows", "owns"
  weight: number; // co-occurrence count
}

interface LearnedSkill {
  id: string;
  name: string;
  triggerPattern: string;   // what user was doing when this emerged
  promptModifier: string;   // injected into system prompt when skill is active
  tools: string[];          // MCP tools to enable
  usageCount: number;
  createdAt: number;
}

interface MemoryEntry {
  id: string;
  text: string;             // "Arnav is building Blade with Tauri 2 and React 19"
  sourceConversationId: string;
  entities: string[];       // knowledge node ids this memory references
  confidence: number;
  createdAt: number;
  expiresAt?: number;       // optional TTL for ephemeral facts
}
```

### Four Input Channels

#### Channel 1: 👍👎 Reactions (Feedback Loop)

- Add reaction buttons to every assistant message in `MessageList.tsx`
- `useFeedbackLoop` records: reaction polarity + message content + active context (model, mode, tool count)
- After 5+ reactions: pattern detection runs — compares positive vs negative message characteristics
- Derived preferences written to `identity.preferences` with confidence scores
- Examples: "prefers concise answers (conf: 0.82)", "dislikes long preambles (conf: 0.71)"
- Preferences with confidence > 0.6 get injected into system prompt on every call

#### Channel 2: Post-Conversation Memory Extraction

- On conversation end (user navigates away or starts new conversation), call `invoke("learn_from_conversation", { conversationId })`
- `memory.rs` already exists — enhance to return structured `MemoryEntry[]` not just raw text
- Backend extracts: entity mentions, decisions made, facts stated, preferences expressed
- Deduplication: new memory within 80% semantic similarity of existing → merge (update confidence) not append
- Frontend `useMemory.addFromConversation()` writes to SQLite via `db_commands`
- Hard cap: 500 memory entries. When full, oldest + lowest-confidence entries expire first.

#### Channel 3: Knowledge Graph

- `useKnowledgeGraph` scans every conversation for entity mentions using lightweight NLP (regex + LLM-assisted extraction for ambiguous cases)
- Entity types: person names, project names, tool names, company names, URLs, concept terms
- Nodes accumulate with `mentionCount` and `lastSeenAt`
- Edges form when two entities appear in the same message: edge weight += 1 per co-occurrence
- This runs client-side, async, after each conversation — never blocks chat

#### Channel 4: Mission Outcomes (covered in Brain-Mission Integration below)

### System Prompt Injection

`brain.rs` gets a new exported function: `character_bible_context(budget_tokens: usize) -> String`

Injection priority order (most important first, trim from bottom when over budget):

```
1. Identity block (always, ~150 tokens)
   "You are talking to {name}, a {role}."
   "Working style: {workingStyle.join(', ')}"
   
2. Preferences (always, ~100 tokens)
   "User preferences: {top 5 preferences by confidence}"

3. Active projects (always, ~100 tokens)
   Top 3 KnowledgeNodes of kind "project" by lastSeenAt

4. Recent memories (~200 tokens, trim oldest first)
   Newest 10–20 entries from memories[]

5. Knowledge graph summary (~150 tokens, trim lowest-weight edges first)
   Top 10 most-relevant nodes based on recency × mentionCount
```

Total budget: ~700 tokens by default, configurable. Never exceeds this.

### Character Bible UI

New route: `/character` — accessible via command palette ("Open Character Bible") and settings sidebar icon.

**Three tabs:**

**Identity tab** — editable, immediate save-on-blur:
- Name and role as inline-editable text fields
- Working style as tag chips: click × to delete, type + Enter to add
- Preferences list: each row shows text + confidence badge ("82%") + source badge ("derived" or "manual") + override button to edit/delete
- Footer: "Last updated from conversation · 3 minutes ago"

**Knowledge Graph tab:**
- SVG force-directed graph, hand-rolled with D3-style physics (no new npm deps — implement a minimal force simulation in ~150 lines)
- Nodes: circles colored by kind (person=blue, project=green, tool=purple, concept=gray, company=amber)
- Edges: lines with opacity proportional to weight
- Click a node → right-side panel slides in showing: node label, kind, summary, mention count, and all memories that reference this node
- Search bar above graph: filters visible nodes by label
- "Add node manually" button for things the system missed

**Skills & Memories tab** — two sections, same page:
- **Skills** (top): each card shows name, trigger pattern, usage count, "Active" toggle, edit/delete
- **Memories** (bottom): reverse-chronological feed, each entry shows text + source conversation link + entity badges + delete button
- "Forget all" button at bottom with confirmation

---

## System 2: Mission DSL + Template Library

### The MissionSpec Format

Missions are no longer ephemeral in-memory objects. They are JSON specs stored in `~/.blade/missions/`. Portable, re-runnable, shareable.

```typescript
interface MissionSpec {
  id: string;
  title: string;
  description: string;
  tags: string[];
  builtIn: boolean;           // true = ships with Blade, forkable but not deletable
  inputVars: Record<string, {
    label: string;
    placeholder: string;
    required: boolean;
  }>;
  stages: MissionStageSpec[];
  createdAt: number;
  lastRunAt?: number;
  schedule?: string;          // cron expression for automatic runs
}

interface MissionStageSpec {
  id: string;
  title: string;
  goalTemplate: string;       // can use {{varName}} from inputVars
  dependsOn: string[];        // stage ids — DAG structure
  runtimeHint: string;        // preferred runtime id
  loopUntil?: string;         // natural language condition — AI evaluates truth each iteration
  approvalGate?: boolean;     // pause execution, require human "Continue" before proceeding
  injectBrain?: boolean;      // inject Character Bible context (default: true)
  maxIterations?: number;     // safety cap for loop nodes (default: 5)
}
```

### Built-In Template Library (20 templates)

Stored as JSON files in `src/data/missions/` (bundled with the app binary — read-only at runtime). User-created missions and forks live in `~/.blade/missions/`. Shown in OperatorCenter with a lock icon.

| # | Title | Category | Runtimes Used | Key Stages |
|---|-------|----------|---------------|------------|
| 1 | Morning Briefing | Rituals | managed-agent, blade-native | Fetch emails + calendar → summarize → speak via TTS |
| 2 | Week Ahead | Rituals | managed-agent | Calendar + todos → weekly plan |
| 3 | PR Review Blast | Coding | claude-code | List open PRs → review each → post comments |
| 4 | Debug Session | Coding | claude-code | Reproduce error → trace → propose fix → run tests |
| 5 | Feature Sprint | Coding | claude-code | Plan → implement → test → commit |
| 6 | Test Sweep | Coding | claude-code | Scan for untested code → write tests → run |
| 7 | Research Deep Dive | Research | tavily-backend, managed-agent | Search → crawl → synthesize → save to knowledge base |
| 8 | Competitive Scan | Research | tavily-backend, managed-agent | Target list → research each → comparison table |
| 9 | Tech Radar | Research | tavily-backend | Topic list → research → tiered radar output |
| 10 | Blog Post Pipeline | Content | managed-agent | Outline → draft → edit → format → ready to post |
| 11 | Social Thread | Content | managed-agent | Topic → research → thread draft |
| 12 | Documentation Sprint | Content | claude-code, managed-agent | Read codebase → generate docs → PR |
| 13 | Security Recon | Security | blade-native (scope-limited) | Verify engagement → passive recon → scope map |
| 14 | Vulnerability Triage | Security | blade-native | Input: CVE list → assess each → severity ranking |
| 15 | Security Report Draft | Security | managed-agent | Findings input → full report structure → draft |
| 16 | Email Triage | Personal | managed-agent | Inbox → categorize → draft replies for important ones |
| 17 | Learning Summary | Personal | managed-agent | Topic → notes/links → structured learning summary |
| 18 | Repo Health Check | Automation | claude-code | Stale branches → open issues → dependency freshness |
| 19 | Dependency Audit | Automation | claude-code | package.json + Cargo.toml → outdated + vulnerable → PR |
| 20 | Recurring Digest | Automation | tavily-backend, managed-agent | Topic subscriptions → weekly digest → stored in KB |

Security templates only appear if a verified SecurityEngagement exists. Built-in security missions hard-code `securityEngagementId` as required.

### Mission Composer (completing the OperatorCenter "mission" tab)

The OperatorCenter already has goal input, route recommendation, and `handleDesignMission`. The composer tab needs the following render completion:

**State machine:** `idle` → `designing` → `planned` → `running` → `done/failed`

**Idle state:**
- Large goal textarea, prominent
- Two buttons: "Design mission (AI)" and "Use template"
- Recent missions list below (last 5, one-click re-run)

**Designing state:**
- Spinner with "Planning your mission..." 
- Uses existing `runtimes.designMission(goal)` → returns `OperatorMission`

**Planned state:**
- Stage list: each stage as a row with title, runtime badge, approval gate toggle, loop condition field (if AI suggested one), expand to edit `goalTemplate`
- Brain injection toggle (default on) per stage
- Input variable form if template has vars
- Two CTAs: "Run now" and "Save to library"

**Running state:** transitions to Live Operator Dashboard (see System 3)

---

## System 3: Live Operator Dashboard

### Execution View

Rendered inside OperatorCenter when a mission is running. Also accessible retroactively from mission library.

**Stage pipeline strip** (horizontal, top of panel):
- Each stage = a node: circle + label. Status colors: pending (gray) → running (green pulse) → awaiting approval (amber pulse) → done (accent checkmark) → failed (red ×)
- Edges between dependent stages as connecting lines
- Click any stage to focus it below

**Active stage panel** (main body):
- Stage title + runtime badge
- Live streaming log — each line as it arrives from the runtime event stream
- Artifacts panel: collapsible list of artifacts emitted so far (summary, code, web_results, verification, etc.)
- Loop iteration counter if stage is a loop node: "Iteration 2/5"

**Approval gate** — when a stage has `approvalGate: true` and previous stages are done:
- Amber full-width card: stage title + goal + latest artifact summary
- Three buttons: "Continue" / "Edit goal then continue" (opens inline edit) / "Stop mission"
- Timeout auto-stops to prevent runaway missions (default 5 minutes, configurable per-mission in spec)

**Completion summary:**
- All artifacts collected, organized by stage
- "Send to chat" button per artifact (calls `onSendToChat`)
- "Save findings to Knowledge Base" button (writes to Brain as memories)
- "Re-run mission" button

### Mission Library Panel

New tab inside OperatorCenter: "Library"

- Masonry grid of saved MissionSpec cards
- Each card: title, description excerpt, tag badges, runtime badges, last run time, "Run" button
- Built-in templates shown with lock icon + "Fork" button
- Custom missions: Run / Edit / Delete / Schedule
- Schedule modal: cron expression or natural language → converts to cron → confirms next 3 run times
- Filter bar: by tag, by runtime, by built-in/custom

---

## System 4: Brain-Mission Integration

This is what makes Blade genuinely compound. Not just Archon with nicer UI.

### Brain → Mission (context injection)

When a mission stage runs, `brain.rs` generates a stage-specific context slice:
- Full identity + preferences block (always)
- Knowledge nodes most relevant to the stage's `runtimeHint` and `goalTemplate` (semantic match, top 5)
- Recent memories whose entities overlap with the stage goal (top 5 by recency)
- Active learned skills matching the goal domain

This context is prepended to the stage's goal before it hits the runtime. Claude Code stages get coding conventions. Managed agent stages get writing voice. Security stages get verified scope details.

### Mission → Brain (outcome extraction)

On stage completion, `learn_from_mission_stage(stageId, artifacts)` runs:
- Artifact content is scanned for entity mentions → update knowledge graph
- Key findings are extracted as `MemoryEntry` items (e.g., "Tavily found competitor X has feature Y")
- Stage runtime + outcome (success/failure + reason) is tracked for routing improvement

### Self-Evolution → Mission Spawning

`useSelfEvolution` monitors two signals:
1. Repeated chat patterns (same type of request 3+ times)
2. Manually re-run missions (user has run the same mission 3+ times)

When signal threshold hit:
- For chat patterns: offer to create a LearnedSkill (slash command modifier) OR a MissionSpec from the most relevant template
- For repeated missions: offer to schedule the mission automatically
- Offers appear as a dismissible card in the chat sidebar, not as interruptions

### Scheduled Mission Runtime

System tray integration (already exists in `tray.rs`):
- Scheduled missions checked every minute via a background Tokio task
- On trigger: launch mission in background, tray icon badge shows "N running"
- Click tray → opens OperatorCenter on the running mission
- Completion: tray notification with summary of first artifact
- Failed missions: amber tray badge, click to see error

---

## What This Is NOT

To keep scope honest:

- **No cross-device sync** — Character Bible is local-only. Export/import manually.
- **No public mission marketplace** — missions are shareable as JSON files, not hosted.
- **No multi-user** — one Character Bible per Blade install.
- **No new Rust runtimes** — 12 is enough. Adding runtimes is a separate feature.
- **No monetization gating** — that's a separate spec.
- **No mission version control** — missions overwrite in place, no history.

---

## Implementation Phases

### Phase A — The Brain (Character Bible)
Build the data model, four input channels, UI, and system prompt injection. This is purely additive — no existing features change. Estimated: ~8 implementation sessions.

**Deliverables:**
- `character_bible` table in `db.rs`
- `learn_from_conversation()` enhanced to return structured `MemoryEntry[]`
- `useFeedbackLoop` wired to real storage
- `useKnowledgeGraph` wired to real storage
- `useMemory` wired to SQLite (not localStorage)
- Character Bible UI (`/character` route)
- Brain injection in `brain.rs`
- 👍👎 buttons in `MessageList.tsx`

### Phase B — Mission DSL + Template Library
Build the spec format, 20 built-in templates, and complete the Mission Composer tab. Estimated: ~6 sessions.

**Deliverables:**
- `MissionSpec` TypeScript type (extends existing `OperatorMission`)
- `~/.blade/missions/` persistence
- 20 JSON template files
- Completed OperatorCenter mission composer render (planned + running states)
- Mission library tab

### Phase C — Live Operator Dashboard
Complete the execution view, approval gates, and artifact browser. Estimated: ~4 sessions.

**Deliverables:**
- Stage pipeline visualization
- Streaming log panel
- Approval gate UI
- Completion summary with "Save to Brain" action

### Phase D — Brain-Mission Integration + Self-Evolution
Wire the compound loop. Estimated: ~3 sessions.

**Deliverables:**
- Stage-level brain context injection
- Mission outcome → memory extraction
- Self-evolution mission spawning
- Scheduled mission runtime (tray integration)

---

## Files Touched (by phase)

### Phase A
**New:**
- `src/components/CharacterBible.tsx` — full UI with 3 tabs
- `src/components/KnowledgeGraphView.tsx` — SVG force graph
- `src/hooks/useCharacterBible.ts` — unified Brain hook
- `src/data/characterBible.ts` — SQLite CRUD layer

**Modified:**
- `src-tauri/src/db.rs` — character_bible, knowledge, memories, skills tables
- `src-tauri/src/db_commands.rs` — new commands for brain CRUD
- `src-tauri/src/memory.rs` — return structured MemoryEntry[]
- `src-tauri/src/brain.rs` — inject character bible context
- `src/components/MessageList.tsx` — 👍👎 reaction buttons
- `src/App.tsx` — /character route + command palette entry

### Phase B
**New:**
- `src/data/missions/*.json` — 20 template files
- `src/lib/missionSpec.ts` — MissionSpec types + helpers

**Modified:**
- `src/components/OperatorCenter.tsx` — complete mission tab render
- `src-tauri/src/runtimes.rs` — persist MissionSpec to ~/.blade/missions/
- `src/types.ts` — MissionSpec type additions

### Phase C
**Modified:**
- `src/components/OperatorCenter.tsx` — live execution panel, approval gates, library tab

### Phase D
**Modified:**
- `src-tauri/src/brain.rs` — stage-context slicing for missions
- `src-tauri/src/runtimes.rs` — learn_from_mission_stage command
- `src/hooks/useSelfEvolution.ts` — mission spawning
- `src-tauri/src/tray.rs` — scheduled mission runtime
