---
description: BLADE smoke test — start dev server, screenshot key routes, verify chat replies. Run before claiming any UI/runtime work done.
---

You are running the BLADE UAT smoke test. This is the gate v1.1 missed.

## Why this exists

v1.1 milestone closed with `27 verify gates green` + `tsc --noEmit clean`. The chat surface was actually broken — `groq` API received 40 calls during testing but no reply rendered. Provider page had a button below the viewport with scroll locked. UI was glitched on every route. Static gates can't see this. This skill is the runtime gate.

## Procedure

### 1. Pre-flight

Kill anything bound to the Tauri dev port so the server can come up clean:

```bash
lsof -ti:1420 | xargs -r kill -9 2>/dev/null || true
lsof -ti:1421 | xargs -r kill -9 2>/dev/null || true
```

### 2. Start dev server

```bash
cd /home/arnav/blade && npm run tauri dev
```

Run this in a background shell. Wait ~10–15 seconds for first paint. Watch for the line `BLADE_READY` or the Vite "ready in N ms" output. If you see Rust compilation errors, fix them first — there is no point screenshotting a non-running app.

### 3. Take screenshots

If `tauri-plugin-mcp` is wired into BLADE: use `mcp__plugin_tauri__browser_take_screenshot` against the BLADE webview window.

If not wired (current state): use Playwright against the existing test server, OR ask the user to manually screenshot the surface and drop it into `docs/testing ss/` (note the literal space). Then `Read` the screenshot.

Required surfaces (one screenshot each):
- **Dashboard** — at 1280×800 AND 1100×700 (responsive guardrail per project tokens)
- **Chat** — empty state, then after sending "hi"
- **Settings → Providers** — confirm "Save & switch" buttons are visible at 1100×700 (button-below-fold was the v1.1 grievance)
- **Cmd+K palette** — confirm centered

### 4. Verify chat round-trip

This is the v1.1 grievance. Procedure:
1. Open Chat
2. Type "hi"
3. Send
4. Observe: does the user message bubble appear? Does the assistant reply stream in?
5. If "working" indicator appears but nothing renders: the streaming event handler is broken. Check `commands.rs::send_message_stream` and the `blade_*` event subscribers in `src/components/Chat*.tsx`. The Groq dashboard counting calls means the API path works — the rendering path doesn't.

### 5. Cite evidence in your response

When you tell the user the work is done, your response MUST include:
- The screenshot file path (`docs/testing ss/<surface>.png` or new under that dir)
- A one-line observation per surface (e.g. "Dashboard: RightNowHero chips visible, no overlap, 4 live signals")
- The chat round-trip result ("Sent 'hi' → assistant replied 'Hello, ...' in 1.2s")

If any surface is broken, do NOT claim done. Open a phase/plan to fix it.

## What this skill does NOT do

- Does not auto-screenshot — Tauri's webview isn't trivially CDP-attachable from the host without `tauri-plugin-mcp` (P3GLEG) compiled into the BLADE binary. That's a v1.2 candidate, not part of this skill.
- Does not run the full 27-verify-gate chain — those are separate (`npm run verify:all`). UAT runs IN ADDITION to those, never instead.
- Does not block the agent — this is a procedure, not a hook. The Stop hook at `.claude/hooks/uat-evidence-required.sh` is the soft enforcement layer.
