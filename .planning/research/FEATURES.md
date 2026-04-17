# Feature Landscape — BLADE Skin Rebuild

**Domain:** Desktop AI agent — ambient presence, memory, autonomy, voice, multi-window overlays
**Researched:** 2026-04-17
**Confidence:** HIGH (grounded in live prototypes + backend source + named competitor analysis)

---

## How to Read This Document

BLADE has ~18 distinct surface clusters. Each section below covers one cluster, organized as:
- **Table stakes** — missing = surface feels broken
- **Differentiators** — competitive advantage when done well
- **Anti-features** — explicitly do NOT build; why; what to do instead
- **Complexity** — Small / Medium / Large for the full surface

Prior art is named for every cluster. Confidence is HIGH for items derived from BLADE's own prototype HTML or backend source; MEDIUM for items derived from widely-documented competitor behavior.

---

## Surface 1: QuickAsk / Spotlight Overlay

**Prior art:** Raycast, Alfred, Arc Max inline commands, Cursor CMD+K, Cleanshot X overlay, macOS Spotlight, Superhuman Instant, Bing Copilot pill.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Global hotkey invocation (Cmd+K or Ctrl+Space) | Every launcher product since Spotlight — users muscle-memorized it | Small | BLADE uses Ctrl+Space in proto; Cmd+K from dashboard. Both must work. |
| Dismiss with Esc in one keypress | Universal escape hatch; users panic if trapped in an overlay | Small | Already in proto: `q-esc` element |
| Input cursor autofocused on open | Raycast, Spotlight — zero-friction typing starts immediately | Small | No click required |
| Keyboard arrow navigation (↑↓) through result rows | Raycast, Alfred — mouse optional; keyboard-native | Small | Proto footer shows ↑↓ navigate hint |
| Enter to execute top result | Raycast, Alfred — most common action in one key | Small | Proto: ↵ open |
| Grouped results with section labels | Raycast groups by type (Actions / Recent / Files); Spotlight does same | Small | Proto shows Actions / Recent chats / Files & context groups |
| Streaming inline AI answer above result list | Arc Max inline answers; Bing Copilot streaming response | Medium | Proto renders `.ai-inline` with animated streaming dots |
| Mode indicator (Ask BLADE vs Search vs Command) | Cursor CMD+K mode pill; Raycast mode toggle | Small | Proto has `.mode-pill` with green dot |
| Result rows show subordinate metadata (time, model, path) | Raycast, Alfred — scannable without opening | Small | Proto shows model name, timestamp, file path in sub-rows |
| Keyboard shortcut footer with all bindings visible | Raycast bottom bar; Arc — discoverable on first use | Small | Proto has full footer: ↑↓ / ↵ / ⌘↵ / Tab |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Cmd+Enter to escalate one-shot answer to a full chat session | Raycast does AI-only OR chat — BLADE bridges both worlds; user can start fast then go deep | Small | Proto shows "Open in chat panel — continue as a full session" row with ⌘↵ |
| Context-aware pre-populated answer using live perception state | BLADE knows what's on screen right now (Figma comment seen, Git branch detected) — answer is pre-assembled before user finishes typing | Large | Requires perception_fusion → QuickAsk pipeline; backend exists (`perception_fusion.rs`), wire is the work |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Pinning / bookmarking results inside QuickAsk | Alfred has this; it creates maintenance burden and a second mental model. QuickAsk is ephemeral by nature | Save to a specific Memory entry via keyboard shortcut that opens Memory Palace with the content pre-filled |
| Fuzzy-match highlights inside the answer text | Superhuman does this; in a streaming AI answer, match highlighting is visually noisy and semantically meaningless | Highlight only the matched tokens in the result list rows (titles, paths), never in the streamed prose |
| Animated transition on open (slide in, scale up) | ChatGPT Desktop, Copilot pill — adds 100-200ms perceived latency; jarring on keyboard shortcut | Fade-in only, 80ms max; no transform. Instant first frame. |

**Complexity estimate:** Medium (overlay shell + streaming inline + grouped results + keyboard nav)

---

## Surface 2: Voice Orb (Ambient Presence)

**Prior art:** Humane AI Pin, Rabbit R1, Meta AI, Apple Siri orb, Copilot sidebar overlay, Superwhisper, Aqua.ai, Wispr Flow, JARVIS references.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| 4 distinct visual states: Idle / Listening / Thinking / Speaking | Siri, Meta AI, Humane Pin all have state-driven orb visuals; without them, user can't tell if the system is working | Medium | Proto has 4 phase buttons and `data-phase` attribute driving CSS transitions on orb rings |
| Live transcript display below orb during Listening | Superwhisper, Wispr Flow — user must see their words to trust the system | Small | Proto: `.live-caption` with final (white) + partial (dimmed) spans + caret |
| Phase state chip (label + elapsed time) | Aqua.ai, Siri — labeled state chip disambiguates "is it thinking or broken?" | Small | Proto: `.phase-chip` with pulsing green dot + label + mono timer |
| Keyboard invoke hotkey (Ctrl+Shift+B) | Push-to-talk convention from Superwhisper; must be global, system-wide | Small | Proto footer shows Ctrl+Shift+B |
| Wake-word invoke ("Hey BLADE") | Siri, Alexa, Meta AI — hands-free mode is table stakes for ambient agents | Medium | Backend exists (`wake_word.rs`); frontend needs to listen for the Tauri event and transition orb state |
| Send/commit with Enter key | Superwhisper, Wispr Flow — terminates recording, sends transcript | Small | Proto key hints: Send = Enter |
| Cancel with Esc (no send) | Siri, Aqua — user must be able to abort without consequence | Small | Proto key hints: Cancel = Esc |
| Hover-reveal minimal controls (pause / close) | Cluely-style invisible overlay; controls appear only on hover, not permanent chrome | Small | Proto `.hover-controls` opacity: 0 → 1 on hover |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Orb animations driven by audio amplitude in real time | Meta AI and Humane Pin do this; BLADE's orb rings breathing in sync with voice energy makes it feel alive rather than a static spinner | Large | Requires VAD amplitude → Tauri event → CSS custom property pump at 60fps. VAD exists (`vad.rs`). |
| Phase-specific color + motion language (not just label change) | Siri (iOS 18) differentiated phases with glow palette, not just label. Blade's prototype uses ring radius + arc animation per phase — carries more information per pixel | Medium | CSS-only, already partially defined in `orb.css` |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Persistent waveform visualization while idle | Amazon Echo show, Copilot sidebar — constant motion draws the eye, burns into ambient focus. Idle should be near-invisible | Use proto's dormant pill (opacity ~0.45, slow breathe) — presence implied, not announced |
| Modal window chrome (title bar, resize handles) | Kills the "it floats over everything" illusion. Siri on macOS suffered from this | Tauri `decorations: false` + `transparent: true` — already set in main window config; enforce for orb window |
| Auto-play TTS for every short response | Rabbit R1 shipped this; users universally hated it for casual queries. TTS should be opt-in per session or explicit per message | Default: stream text to caption; TTS only when voice mode is explicitly active |

**Complexity estimate:** Large (4 states + CSS animation engine + audio amplitude feed + wake-word wiring)

---

## Surface 3: Ghost Mode / Meeting Whisper

**Prior art:** Cluely, Cluely-derivatives (Interview Coder, SensAI), Otter.ai live transcript panel, Fireflies live companion, Zoom AI Companion overlay, Shhh app.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Content protection — overlay invisible to screen share and recording software | This is the entire value proposition of ghost mode; without it the feature is unusable | Small | Backend exists: `ghost_mode.rs:472` sets `NSWindowSharingNone` / `WDA_EXCLUDEFROMCAPTURE`. Frontend needs the window HTML entry and shell. |
| Near-invisible dormant state (pill, not a card) | Cluely's idle pill design — presence without distraction. Card popping up unprompted during a meeting is hostile UX | Small | Proto: `.ghost-idle` pill, 6px dot, low opacity |
| Card format with headline + bullets (not prose) | Cluely, Interview Coder — during a meeting the user needs scannable answer, not a paragraph | Small | Proto `.gc-headline` + `.gc-bullets` — max 60ch, bullet-per-point |
| Hotkey to dismiss card (Esc) | Universal dismiss; user must be able to kill it while speaking without clicking | Small | Proto footer: Dismiss = Esc |
| Hotkey to expand card into full chat (Cmd+Enter) | Cluely Pro feature — go deep on a whisper answer | Small | Proto footer: Expand = ⌘ Enter |
| Hotkey to clear transcript and reset (Cmd+R) | Cluely — new topic in meeting; start fresh | Small | Proto footer: Clear = ⌘ R |
| Source + model attribution in card footer | Fireflies, Otter — user must trust the answer; knowing model used matters | Small | Proto: `.gc-footer .model` shows model name |
| Confidence-gated firing (50%+ confidence a question was asked) | Cluely fires only on detected questions — unprompted firing for statements is irritating | Medium | Backend: `ghost_mode.rs` has 5s chunk buffer + 120s context. Wire confidence threshold to UI suppression logic. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Invisible-to-screen-share callout as a one-time tutorial | Cluely does not explain the protection clearly; showing `NSWindowSharingNone` by name (as in BLADE's proto callout) builds sophisticated user trust | Small | One-time tooltip on first Ghost Mode activation; dismiss after 5s |
| Multi-card stack for back-to-back questions | Zoom AI Companion doesn't handle rapid question sequences well — cards need to stack/scroll | Medium | Queue model: newest card on top, older ones dim below |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Auto-fire ghost card on every meeting sentence | Otter.ai live does this — creates constant notification anxiety. Ghost mode is for deliberate questions, not continuous annotation | Use the confidence gate (>50% question probability) + 5s chunk minimum. Err toward silence. |
| Full transcript scroll panel overlaid on meeting | Fireflies' in-meeting panel obscures video tiles. Meeting context belongs in the Audio Timeline post-meeting, not in-meeting overlay | Keep overlay to single answer card only; transcript is stored silently and surfaced in AudioTimeline after call ends |
| Permission banner on every meeting app launch | Windows Copilot overlay asks for mic access every session — users ignore it within a week | Request mic permission once at onboarding; remember state in config. Surface a tray icon indicator not a modal. |

**Complexity estimate:** Medium (new window HTML entry + content-protection wiring + card renderer + confidence gate)

---

## Surface 4: Dashboard / Daily Driver

**Prior art:** Arc Browser home, Mercury home feed, Linear inbox (today/triage view), Superhuman split inbox, Raycast AI chat home, Omi (contextual morning cards).

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| "Right Now" hero card — what the user is currently doing | Omi-style ambient card; users expect an AI dashboard to know what's happening right now, not just history | Medium | Proto: `.right-now` card with active app, file path, branch, flow time, focus score |
| Live clock + date in top bar | Every productivity dashboard; minimal orientation anchor | Small | Proto topbar has `.mono` time + date |
| Signal feed / hive pulse — timestamped events from integrations | Mercury / Linear — "what happened while I was heads-down?" requires a feed | Medium | Proto: `.signal-feed` rows with source badges (GitHub / Mail / Slack / Cal) and message previews |
| Integration status pills with health indicators | Superhuman / Linear — live/warn/off indicators; user must know if an integration is broken | Small | Proto: `.int-grid` with `.ind.live` / `.ind.warn` / `.ind.off` dots |
| Upcoming calendar events in a secondary card | Superhuman, Arc — next meeting context prevents "oh no I'm late" moments | Small | Proto: `.calendar` card with colored urgency bands (hot / soon / neutral) |
| Command palette trigger (Cmd+K) prominently in top bar | Raycast — search pill as the primary interaction target; signals "this is keyboard-driven" | Small | Proto: `.search-pill` with ⌘ K badge |
| FAB / chat button to open chat panel | Linear, Notion — floating action button opens conversation in context | Small | Proto: `.fab.primary-cta` bottom-right |
| Greeting with user's name and contextual line | Omi, Mercury — personal greeting makes it feel like an agent not a dashboard | Small | Proto: "Good afternoon, Arnav. Here's where you are." |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Proactive "BLADE noticed" observation inside Right Now card | Omi does event-card suggestions; BLADE goes further — the agent comments on the user's work session ("you skipped lunch / your wrists are tired") | Large | Requires proactive_vision.rs wire to dashboard card. Backend exists; frontend card component needs to accept proactive_insight prop. |
| Tentacle grid with per-tentacle live signal count | Raycast doesn't show multi-agent health; BLADE's hive-pulse grid (10 tentacles each with live status dot + count) is unique to BLADE's architecture | Medium | Proto: `.tentacles` grid with `.t-dot.live` / `.t-dot.warn` states |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| News feed / web headlines widget | Raycast Extensions, Windows Copilot sidebar — generic info unrelated to user's actual work. Wastes viewport and dilutes signal-to-noise | Show only signals from connected integrations and detected on-device context |
| "Streaks" gamification prominently on dashboard | Duolingo, Notion AI weekly recap — streak counters in primary view feel childish in a professional context | Surface streak_stats.rs data in a dedicated HealthView or as a tiny ambient strip element, not on the hero dashboard |
| Auto-playing animations on dashboard cards | Motion that's not user-triggered creates visual noise. ARC browser's boost page backgrounds are a known complaint | Static cards with one breathing dot for "live" status; motion only on data-change transitions (fade-in new signal row) |

**Complexity estimate:** Large (Right Now live state + hive pulse feed + integration grid + calendar + proactive wire)

---

## Surface 5: Chat Panel

**Prior art:** Cursor AI chat sidebar, Linear AI panel, Notion AI side-panel, Slack AI summary panel, Raycast AI chat.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Streaming response — tokens appear as generated | ChatGPT, Claude.ai, Cursor — users expect streaming; a pause-then-dump feels broken | Medium | Backend: `send_message_stream` already emits tokens. Wire Tauri `listen` to append tokens to bubble. |
| User message bubble on right, AI on left | Universal chat convention since iMessage; violating it creates instant confusion | Small | Proto: `.msg.user` right-aligned, `.msg.ai` left-aligned with avatar |
| Tool call inline rendering (name + status dot) | Cursor shows tool invocations inline; users must see the agent "working" | Small | Proto: `.tool-call` with green dot, tool name, arg preview, and result summary |
| Active model pill in chat header (with cost hint) | Cursor shows model name + "GPT-4" selector; LibreChat shows cost; both matter to power users | Small | Proto: `.model-pill` with provider logo, model name, and `$0.04 est` |
| Multiline text input that expands | Cursor, Claude.ai — single-line input feels cramped for complex prompts | Small | Proto: `.input-shell` textarea with natural expand |
| File / image attachment button in input toolbar | Cursor, Claude.ai, Notion AI — attach context without pasting raw content | Small | Proto: `.input-tools` has attachment-type icon buttons |
| Context chip strip above input (currently active context) | Cursor shows active file; Notion shows current page. User must know what context the AI has | Small | Proto: `.input-context` with `.ctx-chip` showing green dot + context label |
| History drawer / session list accessible from chat header | Raycast AI, Claude Desktop — revisit past sessions without leaving view | Medium | Proto: `.chat-head .icon-btn` row suggests icon for history |
| Approval dialog for irreversible tool calls (send email, push code) | Cursor has "Apply change?" confirmation; missing = users will never trust autonomous actions | Medium | Backend: decision_gate.rs emits act/ask outcomes. Wire `AskUser` outcome to inline approval card in chat. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Cmd+Enter escalation from QuickAsk into full chat session (context preserved) | Cursor does not bridge their inline assistant to their chat panel with context preserved. BLADE can carry the full QuickAsk conversation and context into chat | Medium | Pass QuickAsk session ID to chat; chat retrieves prior turns from backend. |
| Voice input button in chat toolbar (push-to-talk, not tap-and-hold) | Cursor, Notion AI — no voice input at all. Superwhisper plugs in externally. BLADE's native voice pipeline makes this a first-class feature | Medium | Backend: voice_global.rs. Wire record → transcribe → paste-into-input or send-direct. |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Full-screen mode as default (taking over the whole window) | ChatGPT Desktop made this mistake in early versions — users want to see their context (code, doc) while chatting | Side-panel over dashboard is the prototype's approach — chat is 560px wide column; dashboard remains visible |
| Markdown rendered as raw HTML (pre-processed but escaped wrong) | Slack's early Markdown rendering had escape bugs. Notion's inline AI sometimes renders `**bold**` as literal asterisks | Use a battle-tested markdown renderer; test edge cases: code blocks, nested lists, LaTeX, tables |
| Regenerate button that discards tool call results | Some chat UIs regenerate the whole turn including tool calls, causing side effects (email drafted again, etc.) | Regenerate must re-run only the LLM call, reusing prior tool results; or offer "regenerate + re-run tools" as explicit option |

**Complexity estimate:** Large (streaming + tool call rendering + approval dialogs + history drawer + voice input)

---

## Surface 6: Settings + Key Vault

**Prior art:** OpenRouter settings, LibreChat provider config, LM Studio model manager, Ollama WebUI, Jan.ai settings, 1Password key vault UX.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Provider cards with logo, status badge (Active / Rate limited / Off), and key masked | LibreChat, LM Studio — visual identity for each provider; masked key for security | Small | Proto: `.vault-item` with provider logo, `.v-state.ok/.warn/.off`, masked key `sk-ant-•••` |
| Smart paste: auto-detect provider from key format | OpenRouter dev portal shows key prefixes (`sk-ant-`, `sk-proj-`, `AIza`, `gsk_`); BLADE should auto-detect on paste | Small | Proto: `input[placeholder="Paste a key — sk-..., gsk_..., AIza..., or pick below"]` |
| Key validation test button per provider | LM Studio, LibreChat — paste → test → green/red feedback. Without this, user can't know if key is valid until they try to chat | Small | Proto: `.icon-btn[title="Test"]` row per vault item |
| Model list per provider (with pills) | LM Studio, Ollama WebUI — seeing which models are available per key matters for routing decisions | Small | Proto: `.v-models .m-pill` list per vault item |
| Per-provider monthly spend vs budget | LM Studio doesn't have this; Jan.ai doesn't; it's a BLADE differentiator but users of multi-provider setups will expect it once they see it | Small | Proto: `.v-usage .big` + `.sm` ("$28.12 of $50/mo") |
| Routing config — per-task model assignment | OpenRouter has a routing API; users of multi-provider setups want to set "use Opus for reasoning, Haiku for chat" | Medium | Proto: `.routing` 4-column grid (Deep reasoning / Daily chat / Fast replies / Vision) |
| Fallback chains per routing row | OpenRouter fallback chains; LM Studio does not have this. Multi-provider = needs fallback | Small | Proto: `.r-fb` shows `→ gpt-5 · gemini-2.5-pro` |
| Separate section for local models (Ollama endpoint) | LM Studio, Jan.ai — local models have different UX (no key, just URL, model pull) | Small | Proto settings side-nav: "Local" group with Ollama, Whisper local, Offline mode |
| Tab navigation across major settings sections | Every settings UX: Provider / Memory / MCP / Personality / Hive / Privacy / About | Small | Proto: `.tab-strip` with 7 tabs |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Key stored in OS keychain with explicit messaging | 1Password's "stored in Keychain" badge creates trust. LibreChat stores in plaintext config — security risk. BLADE's proto explicitly states "encrypted in your OS keychain, BLADE never phones home" | Small | Copy in proto already exists; wire to keyring.rs `store_key` call |
| MCP server management as a first-class settings tab | LM Studio, Jan.ai — no MCP. OpenRouter — no MCP. BLADE's MCP tab is unique; shows connected servers, health, tool quality scores | Medium | Backend: mcp.rs has health monitoring and tool quality ranking. Wire to MCP settings tab. |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Raw JSON config editor as primary settings UI | LM Studio forces JSON editing for advanced config; only 5% of users can use it confidently | Provide structured UI for all common settings; show JSON view as "Advanced / Export config" only |
| Provider-level on/off toggle without explaining impact | Jan.ai has a simple toggle — users don't understand that disabling a provider that's in a fallback chain will break routing | Show downstream impact: "Disabling Groq removes it from 2 fallback chains. Chains will fall back to Haiku." |
| Automatic model sync that changes user's routing without consent | OpenRouter's model list updates silently; can break user's routing rules | Show "3 new models available" notification; let user explicitly add to routing. Never mutate routing without user action. |

**Complexity estimate:** Medium (vault list + smart paste + test button + routing grid + tab navigation)

---

## Surface 7: Onboarding

**Prior art:** ChatGPT Desktop (first-run), Claude Desktop (API key modal), Raycast AI onboarding (3 steps), Perplexity Desktop, Cursor first-run.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Step indicator (1/3, 2/3, 3/3) visible at all times | Raycast, Cursor — user must know how far they are; unbounded onboarding causes abandonment | Small | Proto: `.onb-steps` with step pills in states: active / pending / done (green checkmark) |
| Provider grid with visual identity (logo + name + model list) | Cursor first-run, Claude Desktop — selecting a provider without seeing what it is feels blind | Small | Proto: 6-card provider grid with logo badges, model names, badges (recommended / fast / free) |
| Single recommended option pre-selected | Raycast, Cursor — remove decision paralysis; Anthropic is default. User can change. | Small | Proto: `provider.selected` class on Anthropic card with white checkmark |
| API key input in monospace font with inline show/hide toggle | 1Password, Claude Desktop — key visibility matters for verification | Small | Proto: monospace `paste` input; show/hide via `.icon-btn[title="Reveal"]` in vault (same component) |
| Key security assurance copy visible before user pastes key | Claude Desktop (shows privacy note before key entry) — breaks user hesitation | Small | Proto: lock icon + "Keys are encrypted in your OS keychain. BLADE never phones home." |
| Back navigation to previous step without data loss | Cursor, Raycast — user picks wrong provider; must go back without restarting | Small | Standard prev/next nav with state preserved in memory |
| "Ready" state that triggers deep scan before launching | Raycast initial scan; Cursor project indexing — user is primed to wait if they know something productive is happening | Medium | Backend: deep_scan.rs with 12 scanners. Show progress bar per scanner; display findings summary. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Deep scan findings summary as identity bootstrap | Raycast onboarding doesn't show you anything it learned. BLADE can say "Found 4 Git repos, 2 Slack workspaces, AWS config, 3 .env files — I already know your stack." This turns setup into a reveal moment | Medium | Backend: deep_scan.rs produces structured findings. Parse and render as discovery cards on the Ready screen. |
| "Skip for now / try local model (Ollama)" path | Cursor, Claude Desktop require a paid API key to proceed. BLADE can let users start with a local model (Ollama) before committing a key — removes the payment barrier | Small | Add Ollama as a zero-key path; "Start local, add cloud keys later" |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| More than 3 steps before the user reaches the app | ChatGPT Desktop's 6-step onboarding (name / interests / tone / features / notifications / done) causes abandonment before first value | Hard cap at 3 steps: Provider → Key → Scan. Everything else is discoverable settings. |
| Asking for permissions (notifications, accessibility) during onboarding | macOS shows system dialogs which block the app; multiple dialogs in sequence train users to click "Don't Allow" | Request permissions lazily, at the moment the feature is first used, with clear contextual explanation |
| Requiring account / email signup | Linear AI, Notion AI both require account. BLADE is local-first; account requirement breaks the "zero telemetry" promise | No account, no email. Key → OS keychain → done. Analytics opt-in can be offered post-onboarding. |

**Complexity estimate:** Small (3 screens, already prototyped; deep scan wiring is Medium)

---

## Surface 8: Body Map / Hormone Bus / System Health

**Prior art:** No direct competitor. Closest: Raycast Extensions health panel, iOS battery widget, macOS Activity Monitor, developer dashboards (Grafana). Conceptually: Notion's database health views, Linear's cycle health, Humane AI Pin diagnostic screen.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Named list of all 12 body systems with current status | If the body metaphor is the product's core identity, the user must be able to see the body. A settings page with no body map is a missed affordance | Medium | Backend: body_registry.rs, `body_get_map`, `body_get_system`, `body_get_summary`. Render as a system grid or anatomy sidebar. |
| Per-system module list (expandable, shows module health) | Grafana-style drill-in; user must be able to go from "nervous system" to "perception_fusion" to see what's happening | Medium | `body_get_system` returns module list per system |
| 10-hormone bus with current values and trend | Homeostasis.rs exposes arousal/energy/exploration/trust/urgency/hunger/thirst/insulin/adrenaline/leptin. Without visibility, the user can't understand why BLADE behaves differently at different times | Medium | Backend emits hormone state; frontend needs a live strip or radial chart |
| Simple health indicator (green/yellow/red) per system | iOS battery widget, Activity Monitor — aggregate health must be scannable without reading every module | Small | Derive from module statuses; show system-level badge |
| Last-updated timestamp per system | Grafana, Datadog — stale metrics are worse than no metrics; user must know when data is fresh | Small | Expose from body_registry |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Hormone bus as a live ambient strip on the dashboard | No competitor surfaces internal AI state in real time. Showing that trust=0.8, urgency=0.3 tells power users exactly why BLADE is being cautious right now | Large | Requires homeostasis event stream → Tauri emit → UI strip. Backend gap: "Expose hormone stream to UI" flagged in body architecture doc. |
| Click-through from body system → relevant settings section | Grafana dashboard → alert rule edit. If "endocrine system" is yellow, clicking it should navigate to the relevant config | Medium | Requires cross-route link from body map to settings sub-sections |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| 3D anatomical body visualization | Visually impressive but cognitively expensive; adds no information beyond what a table conveys. Would take weeks to build. | Use a structured grid or list with system icons; reserve "body" metaphor for naming, not rendering |
| Real-time animation of every hormone changing | Grafana "breathing" gauges — distracting when the system is stable. Motion should signal change, not steady state. | Animate only on threshold crossings (>±20% hormone delta in 30s); steady state is static |
| Exposing hormone names to casual users without explanation | "insulin = 0.34" is meaningless without context. Replika does something similar and it confuses users. | Translate to human-readable labels: "Energy mode: Focused" (not "energy_mode: 0.78"); show raw values on hover/expand |

**Complexity estimate:** Large (body map grid + hormone stream + drill-in routing)

---

## Surface 9: Memory Palace / Knowledge

**Prior art:** Mem.ai memory feed, Reflect.app notes, Obsidian graph view, Character.ai memory panel, Replika relationship memory, Notion AI linked mentions.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Searchable memory list (BM25 or semantic) | Mem.ai, Obsidian — memory without search is a black hole. User must be able to find stored facts | Medium | Backend: embeddings.rs with hybrid BM25+vector `smart_context_recall`. Wire to a search input. |
| Memory categories visible (Fact / Preference / Decision / Skill / Goal / Routine / Relationship) | Obsidian tags, Mem.ai collections — typed memory is meaningless without visible type labels | Small | Backend: typed_memory.rs has 7 MemoryCategory variants. Show as filter chips or tag badges. |
| Add memory manually (user-triggered) | Mem.ai, Reflect — "remember this" is a primary user intent | Small | Backend: `memory_palace_add_manual`. Wire to a "+" button in memory list. |
| Delete / forget a memory with confirmation | Mem.ai, Character.ai — GDPR-style right to forget; privacy-critical | Small | Backend: typed_memory delete via `id`. Confirmation dialog: "Forget this fact? BLADE will stop using it." |
| Memory source attribution (which conversation / organ wrote it) | Obsidian backlinks, Mem.ai source attribution — trust in memory requires provenance | Small | Show timestamp + source tag (e.g., "from chat on Apr 14" or "from GitHub organ") |
| Confidence score visible on each memory | Mem.ai doesn't show confidence. Reflect doesn't. BLADE's typed_memory has confidence weights — surfacing them is a trust signal | Small | Show as subtle percentage or dot indicator; high-confidence memories read as facts, low-confidence as guesses |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Memory Palace as visual episodic timeline | Obsidian graph is relationship-centric. Mem.ai is list-centric. BLADE's memory_palace.rs has episodic recall — a timeline view (when was this learned, what else was happening) would be unique | Large | Requires screen_timeline integration for temporal anchoring |
| Dream Mode indicator — "memory consolidating" state | No competitor surfaces idle memory consolidation. BLADE's dream_mode.rs runs at 20+ min idle and prunes/promotes memories. A subtle "consolidating" indicator during idle makes the system feel alive without being intrusive | Small | Listen for dream_mode Tauri events; show a small pulsing indicator in Memory Palace header |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Automatic memory editing without user visibility | Replika has been caught modifying user relationship memories silently; caused major trust crisis | Every auto-written memory must be visible in a review queue; user can confirm/reject. Show "BLADE learned X — confirm?" |
| Graph visualization as the default view | Obsidian graph view is beautiful but 90% of users never use it. It's high-build-cost, low-utility default | List view as default; graph view as an opt-in "Knowledge Graph" sub-route (KnowledgeGraphView already in scope) |
| Memory flooding dashboard with "did you know" cards | Character.ai shows memory facts unprompted — creates noise. Memory should respond to context, not broadcast | Surface memories only when contextually relevant (BLADE already does this via smart_context_recall in brain.rs) |

**Complexity estimate:** Medium (list + search + categories + add/delete + source attribution)

---

## Surface 10: Persona / Soul / Identity

**Prior art:** Character.ai persona settings, Replika personality slider, Stella.ai identity config, Friend.com relationship memory, ChatGPT custom instructions.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| User-editable identity fields (name, role, timezone, bio) | ChatGPT Custom Instructions, Character.ai — the AI must know who you are before it can be useful | Small | Backend: brain_get_identity, brain_set_identity in brain.rs |
| Communication style tags visible and editable | ChatGPT custom instructions tone field; Character.ai personality — user must be able to shape voice | Small | Backend: brain_get/add_style_tag in brain.rs |
| Preferences list (tools, work hours, notification rules) | ChatGPT instructions, Replika preferences — must be queryable and editable | Small | Backend: brain_get/upsert_preference |
| Big-5 personality trait display (read-only, system-inferred) | Replika shows inferred traits. Character.ai shows them on persona. Users find it revealing — and it explains AI behavior | Medium | Backend: persona_engine.rs has personality traits. Wire to a read-only trait display with brief descriptions. |
| Goals list (short/medium/long-term, editable) | Notion AI, Reflect — goals provide context for every suggestion the AI makes | Small | Backend: brain_get/add_memory with Goal category from typed_memory |
| Character feedback (thumbs up/down on responses) | ChatGPT thumbs, Claude.ai thumbs — feedback loop is table stakes for personalization | Small | Backend: character.rs `feedback_learning` (thumbs up/down → behavioral traits). Wire to message bubble actions. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Personality Mirror — chat style extraction from imported data | Character.ai lets you set style manually. BLADE's personality_mirror.rs extracts style from user's actual Slack/email history — inferred, not configured. Display what was learned and let user adjust | Large | Backend: personality_mirror.rs. Frontend: show extracted style tags + edit interface. |
| CharacterBible view — unified read of DNA files | Obsidian character pages, Notion personal CRM. No AI product shows you a "this is who I think you are" summary across all dimensions in one view | Medium | Aggregate: identity + voice + personality + expertise + goals + decisions + patterns into a structured single page |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Personality sliders (introvert ↔ extrovert, formal ↔ casual) | Replika has these — they feel like a toy and train the model toward extremes. User-legible sliders don't map cleanly to prompt behavior | Use style tag tokens (e.g., "concise", "technical", "direct") that map directly to system prompt injections. Show preview of how each tag changes a sample response. |
| "Clear all memories" nuclear button without granular control | Replika offered this after their memory controversy — users who clicked it were devastated. Mass deletion is irreversible. | Offer export-first ("Download all my data"), then category-by-category deletion, then full wipe. Never one-click. |
| Roleplay mode toggle that breaks BLADE's core persona | Character.ai has a "character" mode that completely resets identity. Friend.com is entirely roleplay-first. BLADE is a professional agent, not a companion sim. | If roleplay via negotiation_engine.rs is exposed, scope it to specific tasks (debate, steelman) — never let it overwrite the core identity. |

**Complexity estimate:** Medium (identity form + style tags + goals list + feedback wiring)

---

## Surface 11: Agents Cluster

**Prior art:** AutoGPT UI, LangFlow, n8n, Taskade AI agents, Cursor background agent, Claude Code (background agent mode).

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Active agent list with status (running / waiting / done / error) | AutoGPT, n8n — agent without status is unmonitorable | Small | Backend: swarm.rs task statuses. Wire to AgentDashboard list. |
| Per-agent step trace (which tool was called, with args and result) | Cursor background agent shows step log; n8n shows node execution trace — users need to understand what the agent did | Medium | Backend: agents/executor.rs step execution. Emit per-step events; render as step trace in AgentDetail. |
| Cancel / pause a running agent | Cursor, AutoGPT — must be able to abort. Without this, runaway agents are unrecoverable | Small | Backend: swarm cancel patterns exist (`CANCEL: AtomicBool`). Wire to UI kill button. |
| Approval gate rendering for irreversible steps | Cursor "approve change" before applying. n8n webhook confirmation — agents must pause on destructive actions | Medium | Backend: decision_gate.rs `AskUser` outcome. Wire to inline approval card inside AgentDetail. |
| Spawn agent from natural language description | AutoGPT goal input, Agent Factory pattern — user describes goal; agent is created from description | Medium | Backend: agent_factory.rs `spawn_from_description`. Wire to AgentFactory form. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Swarm DAG visualization (parallel task graph) | n8n has a node graph but it's pre-built; BLADE's swarm_planner.rs generates DAGs dynamically from goals. Showing the live DAG as it executes is uniquely compelling and builds trust | Large | Visualize `SwarmTask.depends_on` graph; animate node state transitions (pending → running → done) |
| Background agent delegation to Claude Code / Aider / Goose | No desktop AI product ships with a built-in "spawn Claude Code to write this feature" flow. BLADE's background_agent.rs already supports this | Medium | Wire BackgroundAgentsPanel to background_agent.rs subprocess controls |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Chatting with individual sub-agents | AutoGPT's "message agent" feature — creates confusion about who's in charge. Users ended up in loops talking to the wrong agent | Agents report to the user through the main chat or through their detail panel. No separate per-agent chat thread. |
| Auto-spawning agents without user awareness | LangFlow multi-agent setups can spawn sub-agents invisibly — impossible to debug | Every agent spawn is announced: toast notification + entry in AgentDashboard. User always knows how many agents are running. |

**Complexity estimate:** Large (dashboard + detail + step trace + approval wiring + DAG visualization optional)

---

## Surface 12: Hive Mesh / Tentacle Drill-In

**Prior art:** No direct competitor. Closest: Grafana service map, Datadog infrastructure map, n8n node execution view, iOS Screen Time per-app breakdown.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Per-tentacle status (live / warn / error / dormant) | Grafana service health — 10 tentacles without health status is unmonitorable | Small | Backend: organ.rs `OrganStatus.health`. Wire to tentacle grid health dot. |
| Per-tentacle autonomy level control (slider or enum) | This is a core promise of BLADE — user controls how autonomous each tentacle is. If it's buried in settings only, users won't use it. Surface it on the tentacle card. | Medium | Backend: hive_set_autonomy(level: f32). Wire to per-tentacle autonomy control in tentacle detail. |
| Recent observations list per tentacle (last 3 events) | organ.rs `OrganStatus.recent_observations` — what has this tentacle noticed? Required for trust. | Small | Three most recent events from the tentacle's observation log |
| Tentacle capabilities list (what it can do on command) | organ.rs `OrganCapability` list — user must know what to ask each tentacle | Small | Collapsible capability list per tentacle card |
| Pending decision queue (decisions awaiting user input) | decision_gate.rs produces `AskUser` outcomes — these must be surfaced somewhere. Hive is the logical place. | Medium | Badge on Hive nav item showing pending decision count; dedicated queue section in HiveView |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Autonomy controls with visual impact preview | No competitor explains what autonomy level means in practice. BLADE can show: "At level 3 (Act with preview), I'll show you what I'm about to send before sending. At level 4, I'll tell you after." | Small | Tooltip or expansion per autonomy level enum value |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Exposing raw Rust module names (perception_fusion, activity_monitor) in the user-facing hive view | Grafana mistake — exposing internal naming confuses users who aren't developers. Only ~10% of BLADE users will be developers. | Map module names to human-readable organ names: "Screen Watcher" not "perception_fusion". Expose module names in developer/diagnostic view only. |
| Showing all 149 body_registry modules at once | Information overload — even developers would be lost. Grafana's unlimited service list is a usability anti-pattern. | Group by body system (12 groups); expand per system; search to find specific module. Default view shows only tentacles (10) + their head summaries. |

**Complexity estimate:** Medium (tentacle grid + drill-in + autonomy controls + decision queue)

---

## Surface 13: Screen Timeline / Total Recall

**Prior art:** Rewind.ai (now Limitless), Windows Recall (Copilot+), Screenpipe, Codeium's codebase index, Raycast clipboard history.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Chronological screenshot timeline with 30s granularity | Rewind.ai, Windows Recall — timeline view; user scrubs back to a moment | Medium | Backend: screen_timeline.rs 30s screenshots with 5-day retention. Wire to ScreenTimeline route with time scrubber. |
| Semantic search over timeline ("find when I was reading the auth docs") | Rewind.ai, Windows Recall — the only reason to store screenshots is to recall them by meaning | Large | Backend: screen_timeline.rs has semantic search. Wire search input to `screen_timeline_search` command. |
| Privacy redaction — exclude specific apps or windows from capture | Windows Recall had a privacy crisis because it captured everything. Rewind.ai added app exclusion after backlash. | Medium | Config: exclusion list of app bundle IDs / window titles. Show per-app toggle in Privacy settings. |
| Configurable retention period | Rewind.ai offers 1/7/30 day options. Windows Recall stores indefinitely. Users must own this choice. | Small | Settings toggle: 1 day / 5 days (default) / 30 days. Wire to screen_timeline.rs retention config. |
| Clear timeline manually | Rewind.ai, Windows Recall — right to delete; privacy-critical | Small | "Clear all timeline data" in Privacy settings with confirmation modal. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Audio timeline alongside screenshot timeline (synchronized) | Rewind.ai has audio transcription but it's separate from the visual timeline. BLADE's audio_timeline.rs runs in parallel — showing both on the same scrubber is a more complete recall experience | Large | Synchronize audio_timeline events with screen_timeline captures on shared timestamp |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Always-on screen capture without user-visible indicator | Windows Recall's launch controversy: users discovered capture was on by default and hidden. Privacy catastrophe. | Always show a visible indicator when screen capture is active (tray icon badge, HUD bar dot). First activation requires explicit opt-in during onboarding or first use. |
| Cloud upload of screenshots for processing | Rewind.ai's original architecture was cloud-processed — significant privacy concern. Feature killed their launch momentum. | All processing stays local. screen_timeline.rs is already local. Reinforce this in privacy settings copy. |

**Complexity estimate:** Large (timeline scrubber + semantic search + privacy settings + audio sync)

---

## Surface 14: Life OS (Health, Finance, Goals, Habits)

**Prior art:** Exist.app, RescueTime, Toggl Track, Notion Life OS templates, Day One journal, Copilot Money, Monarch Money, Strides habit tracker.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Focus score and screen time stats (daily/weekly) | RescueTime, iOS Screen Time — if BLADE monitors screen behavior, it must surface the data | Small | Backend: health_guardian.rs, activity_monitor.rs. Wire to HealthView stats cards. |
| Break reminder trigger + snooze | RescueTime, Time Out app — actionable from the notification; snooze for 15 min | Small | Backend: health_guardian.rs already detects screen time thresholds. Wire to toast with snooze action. |
| Financial transactions list with categories | Copilot Money, Monarch Money — chronological list with auto-categorization | Medium | Backend: financial_brain.rs with CSV import and subscription detection. Wire to FinanceView. |
| Subscription detection and list | Monarch Money, Copilot Money — subscription list with amounts and renewal dates is high-value | Small | Backend: financial_brain.rs subscription detection. |
| Goal list with progress tracking | Notion Life OS, Strides — goals without progress metrics are inert | Medium | Backend: typed_memory Goal category. Wire to GoalView with progress bar per goal. |
| Daily journal entry (auto-generated from organ reports) | Day One, Reflect — the value of a journal that writes itself from your actual activity is compelling | Medium | Backend: pulse.rs morning briefing + cron.rs journal trigger. Wire to DailyLogPanel. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Burnout signal detection with explanation | RescueTime tracks hours but doesn't diagnose burnout patterns. BLADE's learning_engine.rs has BehaviorPattern with confidence + recency decay — can surface "you've worked 14 consecutive days, your response quality is declining" | Large | Requires pattern correlation across activity_monitor + audio_timeline + health_guardian |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Calorie / step tracking integration | Exist.app does this; it requires wearable APIs and health data that are out of scope for a desktop AI. Scope creep. | Focus on desk-based health: screen time, break patterns, posture (when camera/webcam is available). Wearable integration is a future milestone. |
| Gamification points and leaderboards | Duolingo-style points on a professional AI dashboard are tonally wrong. streak_stats.rs data belongs in HealthView as context, not as a competitive system. | Show streak as a factual stat ("32-day coding streak") in a small card, not as the primary interface motivator |

**Complexity estimate:** Large (multiple sub-views; each Medium individually; coordination is the complexity)

---

## Surface 15: Dev Tools Cluster

**Prior art:** Warp terminal, VS Code integrated terminal, GitLens, GitHub Copilot inline suggestions, Cursor AI codebase explorer.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Terminal with shell history access | Warp — if BLADE can run bash tools (native_tools.rs), it must have a terminal view | Medium | Backend: native_tools.rs bash execution. Wire to Terminal route with output streaming. |
| File browser with search | VS Code explorer, Finder — basic file navigation | Small | Backend: native_tools.rs file ops. Wire to FileBrowser route. |
| Git panel with status, diff, commit | GitLens, GitHub Desktop — show current git status and allow basic commit/push | Medium | Backend: native_tools.rs git commands. Wire to GitPanel. |
| Code sandbox execution with output | Backend exists: code_sandbox.rs multi-language. Wire to CodeSandbox route with run button + output panel | Medium | |
| Document generation (from template or description) | Cursor, Copilot — generate a document from context | Small | Backend: document_intelligence.rs. Wire to DocumentGenerator route. |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Trying to be a full IDE replacement | Cursor is a full IDE; BLADE is an agent that wraps your existing tools. Trying to replicate VS Code's feature set is 2 years of work. | Focus on agent-mediated terminal + git + file ops. Deep IDE integration belongs in the IDE organ (background_agent.rs + self_code.rs) not in the UI. |

**Complexity estimate:** Large (multiple tools; each Medium; cross-tool context sharing is the challenge)

---

## Surface 16: Admin / Diagnostics Cluster

**Prior art:** Tauri DevTools, Sentry error dashboard, PostHog analytics, Datadog logs.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Decision log (what BLADE decided to act/ask/ignore and why) | Cursor shows which AI actions were taken; BLADE's decision_gate.rs emits DecisionRecord with feedback field. User must be able to audit decisions | Medium | Wire decision_gate records to DecisionLog route. |
| MCP server health (connected / disconnected / error per server) | Backend: mcp.rs health monitoring. If MCP is broken, user must know | Small | Wire mcp health state to McpSettings and IntegrationStatus views. |
| Model comparison test (same prompt, multiple models) | OpenRouter has a playground; LM Studio has a comparison mode. Power users need this. | Medium | Backend: providers/mod.rs unified gateway. Wire to ModelComparison route. |
| Security dashboard (scan results, flagged files, breach alerts) | Backend: security_monitor.rs (network, phishing, breach, sensitive files, code scan, dependency audit). Users need a security view. | Medium | Wire security_monitor events and scan results to SecurityDashboard. |
| Diagnostics (module startup times, error rates, event counts) | Tauri DevTools, Sentry — if something is broken, user needs a way to diagnose | Medium | Aggregate system health from body_registry + module error states. |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Surfacing raw Tauri IPC logs in the diagnostics UI | Developer-only information in user-facing UI confuses non-developer users | Gate raw logs behind a "Developer mode" toggle in About settings. Default: human-readable summaries only. |

**Complexity estimate:** Medium (mostly wiring existing backend data; no new backend needed)

---

## Surface 17: HUD Bar (Persistent Ambient Strip)

**Prior art:** macOS menu bar extras, Raycast menu bar, Superwhisper menu bar icon, YarnBuddy focus widget.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Always-on-top persistent window (separate Tauri window) | Every menu bar app; HUD is ambient presence — must stay above other windows | Small | Backend: overlay_manager.rs handles HUD bar window. Wire HTML entry. |
| Live state dot (active / working / error) | Superwhisper menu bar shows recording state; Raycast shows activity — ambient status without opening main window | Small | Listen for blade_* events; update state dot accordingly |
| Click to open main window | Every menu bar extra — HUD click-through to main app | Small | |
| Tentacle signal count (total active signals) | Unique to BLADE — show hive pulse count in ambient strip without opening dashboard | Small | Aggregate from hive state |

**Complexity estimate:** Small (overlay window exists in backend; needs HTML entry + basic React shell)

---

## Surface 18: Notification Center / Toast System

**Prior art:** macOS Notification Center, iOS notification grouping, Superhuman notification UX, Raycast toast extensions.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Toast notifications with auto-dismiss (3-5s) | Raycast extensions, every desktop app — transient feedback for completed actions | Small | Distinct from modal alerts. Slide in from bottom-right or top-right; fade out. |
| Action buttons on toasts (Approve / Dismiss / View) | Superhuman — actionable notifications; "Draft ready — Send?" should have inline Send button | Small | Decision_gate AskUser outcomes map to approval toasts |
| Toast grouping / stacking (max 3 visible at once) | Raycast, iOS notification grouping — unbounded toast stack is unreadable | Small | Stack latest 3; earlier ones collapse to "N more" |
| Notification history drawer | macOS Notification Center — user should be able to review missed notifications | Medium | Store toast history in-memory; open on bell icon click in top bar |
| Do-not-disturb / focus mode suppression | macOS Focus modes, Superhuman Do Not Disturb — suppress all non-critical toasts when user is in flow | Small | Backend: decision_gate already gates proactivity. Wire DND mode to suppress UI toast rendering. |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| System notification (OS-level push) for every agent event | Windows Copilot does this — 30+ system notifications in a work session trains users to disable all notifications | Keep all notifications inside BLADE's own toast system. Only escalate to OS notification for Critical-priority events (production down, security breach). |
| Notification badges on every nav item | Slack badge fatigue — unread badges on every nav item creates anxiety. | Badge only on items with pending user action (not informational events). Decision queue badge on Hive; draft-ready badge on Chat. |

**Complexity estimate:** Small (toast component + history drawer; core infra, low surface complexity)

---

## Feature Dependencies

```
Design System Primitives (Button, Card, Pill, GlassPanel, Orb)
    └──required by──> ALL 18 surfaces

Typed Tauri Wrapper (replaces 234 raw invokes)
    └──required by──> ALL 18 surfaces

Window HTML Entries (all 5 windows registered)
    └──required by──> Voice Orb, Ghost Mode, HUD Bar, QuickAsk

Onboarding (provider key in keychain)
    └──required by──> Chat, Settings, QuickAsk (any surface needing AI)

Dashboard Shell (nav rail + top bar + route system)
    └──required by──> Chat Panel, Settings, All cluster routes

Toast System
    └──required by──> Chat (approval dialogs), Agents (step events), Hive (decision queue)

Streaming chat wire (listen to blade_* events)
    └──required by──> Chat Panel, QuickAsk AI inline answer, Ghost Mode card

Perception_fusion → dashboard Right Now card
    └──required by──> Dashboard hero widget, QuickAsk context pre-population

Body Registry wire
    └──required by──> Body Map, Hive Mesh, Admin Diagnostics

Hormone bus emit
    └──required by──> Body Map, Dashboard ambient strip (differentiator)
```

---

## MVP Recommendation (V1 Skin Rebuild)

### Launch With (every surface the user touches must be coherent)

- [ ] Design system primitives — without these, nothing else ships consistently
- [ ] Typed Tauri wrapper — replaces 234 raw invokes; prevents silent failures
- [ ] Window entries (all 5) — 3 windows currently crash Rust on open
- [ ] Onboarding (3 screens) — entry gate to the entire product
- [ ] Dashboard (Right Now + Hive pulse + Calendar + Integrations) — daily driver
- [ ] Chat panel (streaming + tool calls + approval dialogs) — primary interaction
- [ ] QuickAsk (grouped results + streaming inline answer) — most common access pattern
- [ ] Voice Orb (4 states + live transcript) — ambient presence promise
- [ ] Ghost Mode (content-protected overlay + card) — competitive differentiator
- [ ] Settings (provider key vault + routing + tab navigation) — required for any API to work
- [ ] HUD bar (ambient window) — always-on presence
- [ ] Toast + notification system — foundation for all agent events

### Add After Validation (V1.x)

- [ ] Body map + hormone bus — BLADE-unique; builds understanding of the body metaphor
- [ ] Memory Palace (list + search + add/delete) — trust-building for autonomous memory
- [ ] Agents cluster (dashboard + step trace + approval) — unlocks autonomous task execution
- [ ] Hive mesh drill-in + autonomy controls — power user feature
- [ ] Screen Timeline (scrubber + semantic search) — high-value recall feature

### Future Consideration (V2+)

- [ ] Life OS cluster (Health, Finance, Goals, Habits) — high complexity, medium urgency
- [ ] Dev Tools cluster (Terminal, Git, Sandbox) — high complexity; IDE organs are better long-term path
- [ ] DAG visualization for swarm — impressive but deferred until agents cluster is stable
- [ ] Personality Mirror (style extraction from Slack/email) — requires OAuth connections to be stable first

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Design system primitives | HIGH | MEDIUM | P1 |
| Typed Tauri wrapper | HIGH | MEDIUM | P1 |
| Onboarding (3 screens) | HIGH | SMALL | P1 |
| Chat panel with streaming | HIGH | LARGE | P1 |
| QuickAsk overlay | HIGH | MEDIUM | P1 |
| Dashboard (Right Now + Hive) | HIGH | LARGE | P1 |
| Voice Orb (4 states) | HIGH | LARGE | P1 |
| Ghost Mode overlay | HIGH | MEDIUM | P1 |
| Settings + key vault | HIGH | MEDIUM | P1 |
| Toast / notification system | HIGH | SMALL | P1 |
| HUD bar window | MEDIUM | SMALL | P1 |
| Memory Palace | HIGH | MEDIUM | P2 |
| Body map + hormone bus | MEDIUM | LARGE | P2 |
| Agents cluster | HIGH | LARGE | P2 |
| Hive mesh drill-in | MEDIUM | MEDIUM | P2 |
| Screen Timeline | HIGH | LARGE | P2 |
| Life OS cluster | MEDIUM | LARGE | P3 |
| Dev tools cluster | MEDIUM | LARGE | P3 |
| DAG visualization | LOW | LARGE | P3 |
| Personality Mirror | MEDIUM | LARGE | P3 |

---

## Sources

- BLADE prototype HTML: `/home/arnav/blade/docs/design/` (11 files — dashboard, quickask, voice-orb, ghost-overlay, settings, onboarding-01/02/03, dashboard-chat, quickask-voice, voice-orb-states)
- BLADE backend: `/home/arnav/blade/CLAUDE.md` (module map), `/home/arnav/blade/docs/architecture/2026-04-16-blade-body-architecture-design.md`
- BLADE project scope: `/home/arnav/blade/.planning/PROJECT.md`
- Competitor prior art named inline (HIGH confidence — widely documented public behavior): Raycast, Alfred, Cursor, Cluely, Superwhisper, Rewind.ai, Windows Recall, Mem.ai, Replika, Character.ai, LM Studio, LibreChat, OpenRouter, n8n, AutoGPT, Copilot, Siri, Meta AI, Humane AI Pin

---

*Feature research for: BLADE Skin Rebuild — Desktop AI agent, ambient presence, memory, autonomy, voice, multi-window overlays*
*Researched: 2026-04-17*
