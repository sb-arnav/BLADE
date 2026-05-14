# BLADE Launch Forge Demo — 75-second screencast script

**Purpose:** Capture the VISION line 40 wedge moment — BLADE writing its own tool mid-task and continuing without stopping. The video is the single highest-leverage launch artifact. Real terminal, no music, voice narration. Goes on Twitter, embeds in Show HN, headlines the README.

**Target:** 75 seconds. Single uncut OBS recording. No edits except a 1-2s fade in/out.

---

## Pre-flight (do this once, before the recording)

1. **Reset BLADE state** so the forge can fire on a real-feeling gap:
   - Quit BLADE
   - `mv ~/.blade ~/.blade.backup-demo-$(date +%Y%m%d)` (or pick a clean machine entirely)
   - Relaunch — first-run hunt onboarding will fire
   - Run through hunt minimally (skip OAuth — not needed for this demo)
2. **Open one extra terminal alongside BLADE** showing `tail -f ~/.blade/blade.log` — proves nothing's staged.
3. **Pre-clean** the LLM's prior knowledge: if you've used BLADE on this machine before, the HN forge fixture is already cached. The demo should look like a real gap, so either fresh-install or temporarily rename `~/.blade/forged_tools/` to a backup name.
4. **OBS settings**:
   - 1920×1080, 60fps, CRF 18, single-display capture (the display with BLADE + tail terminal)
   - Audio: voice from a USB mic if available, otherwise built-in. Levels: peak around -12 dB.
   - Hotkey: Cmd/Ctrl+F8 to start/stop. Set a 3s countdown.
5. **Window arrangement**: BLADE chat on the left ~70% of screen, tail terminal on the right ~30%. Both windows visible the entire take.

---

## The 75-second take

| Time | What you do | What you say (voice over) |
|---|---|---|
| 0–4s | BLADE chat focused, cursor in the input. Take a breath. | "OK. So this is BLADE. It's an open-source desktop AI agent." |
| 4–8s | Type the prompt into BLADE's chat input: `Pull the top 5 Hacker News stories that mention BLADE` | "I'm going to ask it to do something it doesn't have a tool for." |
| 8–10s | Hit enter. Chat starts streaming. | "Watch what happens." |
| 10–18s | First chat line appears: `[forge] gap_detected — no tool for: hackernews-top-mentions`. Then: `[forge] writing — drafting tool...` | "No tool for HackerNews. So it's writing one." |
| 18–28s | Chat shows: `[forge] testing — running new tool...` then `[forge] registered — hackernews-top-mentions now available`. | "Wrote it. Tested it. Now it has it." |
| 28–48s | Tool runs. Chat streams the actual 5 HN stories mentioning BLADE (or matching the seed query if no BLADE mentions). The terminal tail shows real log entries. | "Now it's using the tool it just wrote." |
| 48–58s | Chat shows the final synthesized response — 5 stories with titles + links. | "Done. That tool stays installed. Next time, no forge — just runs." |
| 58–68s | Click into Settings → Skills (or the dev-tools route from v2.2). Show the new tool sitting in the registry. | "Here it is. Persisted. Mine now." |
| 68–75s | Cut back to chat. Type a follow-up: `What did the top story actually argue?` Press enter. Chat starts streaming an answer using the same tool. | "Second time. No forge. Just works." |

---

## Failure modes and recovery

- **Forge fails on first try.** Don't re-record — re-fire the prompt. The retry chat-line (`[forge] retrying`) is actually GOOD content; it proves persistence (VISION primitive #2).
- **Tool returns no BLADE mentions.** Have a backup phrasing ready: `Pull the top 5 Hacker News stories from today` — falls back to general HN top stories, still demonstrates forge.
- **Cost-line hits the soft cap mid-demo.** Pre-set the budget to $5.00 (`blade config set forge_budget 5.00`) before recording. $3 default may not be enough for the HN forge round-trip + follow-up.
- **Mic clipped or breath-noise.** Re-record audio over the screencast in post — but only if absolutely necessary. Pattern-3 from the launch research (founder-voice with imperfections > polished narration) — don't sterilize it.

---

## What NOT to do in the demo

- No music. Music reads as marketing in 2026.
- No on-screen captions overlaying the chat (the chat IS the caption).
- No B-roll. No cuts.
- No "Hey everyone, today I'm going to show you" intro. Start with the action.
- No mention of "AI" generically. The wedge is forge, not "yet another AI app."
- No comparison to ChatGPT/Claude/Cursor. Let the action speak; comparisons go in the thread reply.

---

## Post-recording checklist

- [ ] Watch back once at 1x. If pacing drags anywhere, do one more take.
- [ ] Export to MP4 + GIF. The GIF goes in README (line 3, right under the install command). The MP4 goes on Twitter (the platform compresses to its own format anyway).
- [ ] Trim to ≤90s for Twitter (75s target gives 15s buffer). Twitter video cap is 2:20 but engagement drops sharply after 1:30.
- [ ] Drop the MP4 file in `docs/launch/assets/forge-demo.mp4` and the GIF in `docs/launch/assets/forge-demo.gif`. Reference paths are already wired in the README + show-hn-post.md.
- [ ] Send to Daniel Miessler via the DM template at `docs/launch/miessler-dm.md` — 48 hours before Show HN goes up.
- [ ] Then post Show HN per `docs/launch/show-hn-post.md`. Mon or Tue, 10–11am ET.
- [ ] Cross-post Twitter thread per `docs/launch/launch-tweet-thread.md` 2 hours before the HN post.

---

*The launch-research bet is that one real, unedited, founder-narrated 75s screencast of BLADE writing its own tool beats every other launch artifact combined. This script is the entire production plan. It's deliberately not a storyboard — the action is the asset.*
