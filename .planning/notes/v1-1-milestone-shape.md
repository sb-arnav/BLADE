---
title: "v1.1 milestone shape — locked during /gsd-explore"
date: 2026-04-20
context: >
  Locked during /gsd-explore session 2026-04-20 between Arnav and Claude.
  Reframes v1.1 from "ship a JARVIS demo moment" to "make BLADE actually
  function as the thing it already is" — the backend largely exists; what's
  missing is wiring, smart defaults, and accessibility.

  This note is the planning input for /gsd-new-milestone. The milestone
  workflow should consume it and produce REQUIREMENTS.md + ROADMAP.md
  consistent with the shape below; deviations from this shape need explicit
  justification, not silent revision.
status: locked
audience: /gsd-new-milestone, /gsd-plan-phase, downstream phases
---

# BLADE v1.1 — Functionality, Wiring, Accessibility

## Anchor

> **v1.1 = "make BLADE actually work as the thing it already is."**

Not a new feature milestone. The V1 substrate (10 phases, 130+ Rust modules, 145 React components, 50+ routes) is shipped. Tester pass surfaced that most of it is **either unwired, unreachable, or uses bad defaults that make the surface feel empty**. v1.1 fixes that.

## Why this framing (not the JARVIS-moment framing Claude initially proposed)

Claude initially proposed a v1.1 anchored on a single push-to-talk → cross-app demo (the "JARVIS moment"). Arnav corrected this on 2026-04-20:

> *"I think first making the app functional would be better — we already have the backend for it I believe but not proper usage and wiring."*

Tester evidence supports the reframe:
- Chat broken for first message (silent failure, no error surfaced).
- Deep scan found 1 repo (the scanner is dumb).
- Dashboard pages feel empty (backend exists, not piped).
- Background terminal noise (no in-UI activity surface for trust).
- UI cluttered (no pad, no breathing room).
- Options the tester expected to find weren't reachable.
- Groq+llama produced nothing useful (no capability-aware routing).

JARVIS becomes natural *after* v1.1, because v1.1 builds the wiring it would consume. JARVIS belongs in v1.2+.

## The 6 phases

### Phase 0 — Inventory & Wiring Audit

**Goal:** Produce `WIRING-AUDIT.md` as planning input for every other phase.

**Catalog:**
- Every Rust module (130+) — what it does, what triggers it, what UI surface (if any) it has.
- Every UI route (50+) — what it shows, what data it needs, is the data flowing.
- Every settings option / config field — discoverable from where, what UI control.

**Tag each item one of:**
- **ACTIVE** — backend used, surfaced in UI, working
- **WIRED-NOT-USED** — UI exists, backend never triggered (dead UI)
- **NOT-WIRED** — backend exists, no UI surface (invisible feature)
- **DEAD** — deletable, no current or planned usage

**Falsifiable success:** WIRING-AUDIT.md exists, every Rust module under `src-tauri/src/` is classified, every route in App.tsx is classified, gap list (NOT-WIRED items) becomes the Phase 4 backlog.

---

### Phase 1 — Smart Provider Setup

**Goal:** Onboarding doesn't lock users into the 6 hardcoded provider cards. Probe the actual model. Route by capability.

**Ships:**
- **Custom config paste** — paste cURL, JSON config, Python snippet → BLADE auto-extracts provider, model, base_url, headers. Both onboarding flow and Settings → Providers expose this.
- **API key validation** — on save, BLADE makes one test call: pulls model name, context window, vision support, audio support, tool-calling support.
- **Capability-aware routing** — config now stores per-capability provider preference. If primary model lacks vision, prompt for a vision-capable fallback key. Same for audio, long-context, tool use.
- **"Plug in better key" empty-states** — instead of dashboard going blank on weak models, show actionable upgrade prompt that explains why and offers to add a richer key.

**Falsifiable success:** Pasting a raw OpenAI cURL command auto-fills provider + model + key. Adding a key with no vision support causes vision-needing UI surfaces to show "needs vision-capable model" prompt with an "add key" CTA.

---

### Phase 2 — Smart Deep Scan

**Goal:** Replace dumb 12-scanner sweep with a lead-following scanner that reads folders intelligently, like a developer would when onboarding to a new machine.

**Sources to probe:**
- Filesystem walk: `~/Projects`, `~/repos`, `~/src`, `~/code`, common parent dirs, every `.git` underneath
- Git remotes config — list remotes, pull org/repo names
- IDE workspaces — `.code-workspace`, `.idea/`, Cursor state, recent-projects lists
- AI session history — `~/.claude/projects/`, `~/.codex/`, `~/.cursor/`, browser-AI history if reachable
- Shell history — `.bash_history`, `.zsh_history`, `.fish_history` for tool/repo signals
- Filesystem MRU — most-recently-modified files across home dir
- Browser bookmarks
- Installed apps + CLIs (`which` sweep over a curated list)

**Algorithm:**
- Builds its own to-do list at scan start: highest-priority leads first (recent-edited repos, active sessions), then breadth.
- Streams results to the activity log (Phase 4) so user sees the scan think out loud.
- Output: structured profile (repos, stack, accounts, people, rhythm, files) — editable, source-linked, persisted.

**Falsifiable success:** Cold-install scan on Arnav's machine surfaces ≥10 repos (currently 1), ≥5 accounts, ≥3 daily-rhythm signals, ≥3 IDE/AI tool signals. Profile page renders with edits that round-trip.

---

### Phase 3 — Self-Configuring Ecosystem (3b: full auto, observe-only)

**Goal:** Phase 2's scan results silently activate observer-class capabilities. **Watching, not editing.** No destructive surprises.

**What auto-enables based on scan findings:**
- N repos found → repo-watcher tentacle on (file change events, git activity).
- Slack token in env / `~/.slack/` config → Slack monitor on (read-only triage).
- Vercel CLI installed + auth'd → deploy-monitor on (status reads).
- GitHub CLI auth'd → PR-watcher on (read-only).
- Active Cursor/Claude Code sessions detected → session-context bridge on.
- Calendar API key → calendar-monitor on.
- Etc.

**Hard rule:** every auto-enabled tentacle is observe-only in v1.1. Anything that *acts* (reply, post, push, deploy) requires explicit user enablement in Settings even if the credential is present.

**User control:** Settings page lists every auto-enabled tentacle with a one-click disable. Each tentacle row explains *why* it was enabled (what scan finding triggered it).

**Falsifiable success:** Cold install + Phase 2 scan results in ≥5 tentacles auto-enabled, all observe-only, all listed in Settings with rationale, all toggleable.

---

### Phase 4 — Wiring & Accessibility Pass

**Goal:** Close the gaps from Phase 0's WIRING-AUDIT.md. Make every backend feature reachable. Re-pass A11y on the new surface.

**Four sub-streams:**

**(a) Wire NOT-WIRED backends.** Every backend module without a UI surface gets one — either a dedicated route, a dashboard card, a Settings tab, or a command-palette entry. Dashboard cards bind to real data from Phase 2/3.

**(b) Surface WIRED-NOT-USED features.** UI exists but never triggered — fix the trigger or remove the dead UI.

**(c) A11y sweep.** Keyboard navigation, visible focus, contrast (re-run V1 verify gates against new surfaces), screen-reader labels on every new control, dialog focus trapping, reduced-motion respect on new animations.

**(d) Activity log strip.** Persistent "BLADE is doing…" surface (top bar or side strip). Click any entry → drawer with payload + reasoning. Resolves the trust gap.

**Falsifiable success:** WIRING-AUDIT.md NOT-WIRED count drops to 0 or each remaining item has a documented "deferred to v1.2" rationale. Existing 18 verify gates extend with a11y-pass-2 and feature-reachability scripts. Activity log emits an event for every cross-module action.

---

### Phase 5 — Density + Polish

**Goal:** Now that content exists (Phases 1-4), make the surface feel intentional.

**Ships:**
- Padding/spacing audit — every card, every page, every modal against the spacing ladder.
- Card gaps — fix the screenshot-density problem.
- Background image dominance — content first, ambient art second.
- Top bar overstuff — visual hierarchy pass.
- Empty-state copy rewrite — *"BLADE is still learning — give me 24h"* not *"No recent decisions"*. Every empty state includes a CTA or expected timeline.

**Falsifiable success:** UI review across all 50 routes — 0 padding violations against spacing ladder, every empty state has either real content or a real CTA, dashboard hero pulls 3+ live signals.

---

## Sequencing

```
   Phase 0 (audit)
       │
       ▼
  ┌────┴────┐
  │         │
Phase 1   Phase 2     ← parallel; Phase 2 needs Phase 1's model
  │         │
  └────┬────┘
       ▼
   Phase 3 (consumes 2's output)
       │
       ▼
   Phase 4 (consumes 0's audit)
       │
       ▼
   Phase 5 (consumes everything)
```

## Out of scope (deferred to v1.2+)

- The JARVIS push-to-talk demo moment (becomes natural after v1.1)
- Browser tentacle deep work (`browser-use/browser-harness` research stays in `research/questions.md`)
- Everything in `notes/v2-vision-tentacles.md` — Slack/Discord/WhatsApp/Email/LinkedIn/Twitter, GitHub deep, CI auto-fix, k8s, calendar, finance, head models, big agent, business SDK, Linux niche, Hyprland
- Acting tentacles (anything that posts, replies, deploys, modifies external state)

## Open items entering /gsd-new-milestone

- Mac smoke (M-41..M-46) for V1 closure — tracking separately, doesn't gate v1.1 start
- Model strategy (richness slider vs auto-tier) — covered by Phase 1 capability-aware routing
- The 7 task IDs from the conversation (#1-#7) — #1, #2, #3 already shipped (4ab464c); #4, #5, #6, #7 absorb into the phases above

## Authority

This shape is locked. /gsd-new-milestone may flesh out requirements, success criteria, dependencies — but should not silently change the phase list, sequencing, or scope. Any deviation needs explicit user sign-off.
