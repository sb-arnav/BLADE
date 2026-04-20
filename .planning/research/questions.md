# Open Research Questions

Open questions surfaced during exploration that need deeper investigation before committing to a design or phase. Add new questions at the bottom; resolve by linking to the answer (a phase, a note, or a decision in CONTEXT.md).

---

## Browser tentacle

### Q1 — Does `browser-use/browser-harness` solve our browser-control problem?
- **Source:** /gsd-explore session, 2026-04-20
- **Link:** https://github.com/browser-use/browser-harness
- **Why it matters:** v1.1 anchor is push-to-talk → cross-app action (e.g. *"post something about myself from my Arc account"*). Reliable browser automation is the load-bearing capability. We currently have `browser_native.rs` (CDP) and `browser_agent.rs` (vision-driven loop), both built in V1. Question is whether `browser-use/browser-harness` would replace, supplement, or be irrelevant to those.
- **What to evaluate:**
  - What problem does it solve that our current CDP path doesn't?
  - Does it support Arc / Brave / Edge or only Chrome?
  - Auth/session model — can it act inside an already-logged-in browser, or does it spin up a fresh profile?
  - Latency profile vs our current vision loop
  - License + maintenance posture
- **Decision deadline:** Before v1.1 plan-phase for the JARVIS-moment phase
- **Status:** open
