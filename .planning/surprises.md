# BLADE — Surprise Log

Append-only. One entry per session where my prior was contradicted. Read at session start.

Pattern: `## YYYY-MM-DD — <one-line title>` with **Prior**, **Reality**, **Implication**.

---

## 2026-05-12 — vierisid/jarvis is in BLADE's exact lane, not adjacent

**Prior:** Per VISION.md lines 117-125 + my first read of vierisid/jarvis's README, jarvis was a *daemon+sidecar agent-runtime* targeting a different topology than BLADE. I treated them as "competitive but optimizing for cloud-deployable team tool; different bet" — see my 2026-05-12 turn-N response.

**Reality:** Their VISION.md (which I didn't read on first pass) opens with *"The AI that doesn't ask permission. Dangerously powerful by design."* and goal *"Destroy OpenClaw. Outclass ChatGPT Agent."* — the same wedge BLADE's VISION.md claims as structurally open. They've shipped 16 milestones including Authority & Autonomy, Continuous Awareness, Workflow Automation, Autonomous Goal Pursuit. BLADE's competitive table doesn't list them.

**Implication:** The "agency-not-safety lane is open" premise in VISION line 125 needs an asterisk. Either the lane separates at scale (jarvis = always-on server / homelab, BLADE = personal-machine app) and we can defend that distinction in the README rewrite, or it doesn't and BLADE needs to articulate a sharper wedge. Logged to decisions.md as a load-bearing finding.

---

## 2026-05-12 — The ecosystem of Claude upgrades is larger than my bubble — and BLADE's vision is already in it

**Prior:** My operating-mode setup (AGENT_OPERATING_MODE.md, two hooks, memory files, decisions log) is a reasonable agent-quality upgrade. The plugins loaded in this session are a menu of skills to invoke, not a library of patterns to learn from.

**Reality:** The `compound-engineering:agent-native-architecture` skill — installed the whole session — contains the missing thesis statement for BLADE: parity between UI and tools, features as outcomes achieved by an agent operating in a loop with atomic primitives. Reframes the v1.6 cut list as an architectural correction, not a narrowing pass. Sharpens BLADE's positioning vs Goose/Claude Code/jarvis. I never read it before today even though it sits one Skill invocation away.

Adjacent findings from the same 5-min audit: Claude Code has 14 hook lifecycle events (I used 3), the GSD plugin already ships `gsd-session-state.sh` (similar to my blade-preflight, older), the compound-engineering plugin has 30+ skills with sophisticated methodology (ce-debug's "causal chain gate" beats my default debugging), and there's a public list of 100+ subagents at VoltAgent/awesome-claude-code-subagents I haven't browsed.

**Implication:** The single highest-leverage move for me is **always check the ecosystem before building new mechanisms.** Specifically: scan the loaded plugins' SKILL.md files for relevant patterns, audit `~/.claude/hooks/` for existing hooks before writing new ones, browse `awesome-claude-code` periodically for new patterns. The cost is ~5 min per session; the upside is finding thesis-grade insight like the agent-native reframe.

This is the structural fix for the "growing linked to your environment, can't see the bigger picture" failure Arnav called out. The wandering loop rule (rule 6 in AGENT_OPERATING_MODE.md) is the start; the explicit version is "audit the ecosystem before building in isolation."

---

## 2026-05-12 — The narrowing pass is targeting features, not LOC weight

**Prior:** v1.6 narrowing per VISION.md would meaningfully reduce codebase complexity. The "60% surface area" framing suggested a major engineering effort (1-2 weeks).

**Reality:** Total Rust src-tauri/src = 165,902 LOC. The full v1.6 cut+reduce+hold list = 17,472 LOC = 10.5% of Rust. Meanwhile the top 5 *infrastructure* modules (runtimes.rs, loop_engine.rs, commands.rs, native_tools.rs, brain.rs) total ~21,700 LOC and aren't on any cut list. runtimes.rs alone (5,780) is bigger than financial_brain + health_guardian + pentest combined.

**Implication:** Two things. (a) v1.6 narrowing is 3-5 focused days, not 1-2 weeks — fits in one milestone alongside the forge demo. (b) The real cleanup opportunity may be dead code *inside* the infrastructure modules, which the vision doesn't touch. A 5,780-line file in a 5-month-old codebase probably has 1,000+ lines of entropy. Worth auditing before v2.0 build assumes those files are clean.

---
