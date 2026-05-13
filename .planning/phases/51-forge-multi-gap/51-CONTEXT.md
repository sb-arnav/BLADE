# Phase 51 — Forge Multi-Gap Robustness

**Milestone:** v2.1 — Hunt + Forge + OAuth Depth
**Status:** Pending
**Requirements:** FORGE-GAP-ARXIV, FORGE-GAP-RSS, FORGE-GAP-PYPI, FORGE-PROMPT-TUNING, FORGE-PRECHECK-REFINE
**Goal:** Forge fires reliably on 4 gaps total (HN from v2.0 + arXiv + RSS + PyPI). Improves the tool-writing prompt and pre-check.

## Reference: v2.0 HackerNews forge

v2.0 Phase 47 shipped HackerNews top-N as the first proven gap. `src-tauri/tests/forge_e2e_integration.rs` has 5/5 passing tests against a mocked LLM provider returning a known-good HN scraper.

Per `47-CONTEXT.md` "Gap chosen" section, the chosen gap shape is:
- Public unauthenticated API (no auth tokens to manage)
- Simple JSON shape
- LLM training corpus likely knows the API

The new gaps follow the same shape.

## Approach

### FORGE-GAP-ARXIV

Capability: "fetch the abstract of an arXiv paper by ID or URL."
- Public API: `https://export.arxiv.org/api/query?id_list=<id>` (returns Atom XML).
- LLM-writable: requests + XML parsing (xml.etree or feedparser).
- Add fixture in `tool_forge.rs` or new `src-tauri/tests/fixtures/forge_arxiv.rs`.
- Add integration test in `forge_e2e_integration.rs`.

### FORGE-GAP-RSS

Capability: "extract titles + summaries from an RSS or Atom feed URL."
- No specific API needed — feeds are just HTTP.
- LLM-writable: requests + feedparser.
- Add fixture + integration test.

### FORGE-GAP-PYPI

Capability: "pull PyPI package metadata (latest version, description, dependencies)."
- Public API: `https://pypi.org/pypi/<package>/json`.
- LLM-writable: requests + JSON.
- Add fixture + integration test.

### FORGE-PROMPT-TUNING

The v2.0 forge prompt was tuned for HN. Verify it works for all 4 gaps. Iterate the system prompt if any gap fails consistently:
- More explicit "use Python, use requests if needed, return JSON"
- Better few-shot examples with the HN tool as the in-context demo
- Test success rate before/after the tuning run; record in 51-SUMMARY.md

### FORGE-PRECHECK-REFINE

`pre_check_existing_tools` currently checks the native tool catalog + MCP catalog (`immune_system::check_mcp_catalog`). Refine:
- Distinguish "MCP exists in catalog" (would short-circuit to "install this MCP" advice) vs "MCP exists AND user has it installed" (would actually handle the gap).
- For gaps where MCP is in catalog but NOT installed → forge can still fire if the user prefers in-app tool over installing an MCP. Surface to chat: *"Could install Slack MCP, or forge a quick scraper now — picking forge."* (per user's autonomy preference).

## Risks

1. **arXiv XML parsing complexity** — feedparser is standard; verify LLM picks it. If LLM writes raw xml.etree, the tool might still work but be brittle.
2. **PyPI rate limiting** — for build-time tests, mock the response so we don't hit pypi.org.
3. **RSS feed format diversity** — Atom vs RSS 2.0 vs RSS 1.0. The forged tool should handle the dominant Atom format; brittleness on edge formats is acceptable for v2.1.
4. **Forge prompt over-fits to the 4 test gaps** — hold a 5th holdout gap with NO fixture and NO test. After tuning, manually verify a forge run on the holdout still produces a working tool. (E.g., "Reddit top posts of a subreddit" or "GitHub trending repos.")

## Success criteria

- [ ] arXiv fixture + integration test pass
- [ ] RSS fixture + integration test pass
- [ ] PyPI fixture + integration test pass
- [ ] `forge_e2e_integration.rs` test count grows from 5 to 8+ (HN baseline + 3 new gaps + any new prompt-tuning regression tests)
- [ ] Forge prompt tuning documented in SUMMARY (before/after success rates)
- [ ] `pre_check_existing_tools` distinguishes MCP-installed vs MCP-cataloged
- [ ] Holdout gap (no fixture, manually tested) produces a working tool
- [ ] cargo check + tsc clean; verify:all ≥36/38
