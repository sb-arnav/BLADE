# Forge Demo — recording placeholder

This file holds the demo asset paths the README + Show HN post + Twitter thread all reference. Until the operator records the demo per `scripts/demo/launch-forge-demo.md`, the asset paths point to placeholders.

## Asset paths (load-bearing — referenced by README/HN/Twitter)

| Asset | Path | Use |
|---|---|---|
| Demo GIF (≤8MB, looping) | `docs/launch/assets/forge-demo.gif` | README line 3 (right under install command) |
| Demo MP4 (≤90s, h264) | `docs/launch/assets/forge-demo.mp4` | Twitter tweet 1, Show HN inline embed |
| Demo poster frame | `docs/launch/assets/forge-demo-poster.png` | YouTube/Twitter video thumbnail |
| Forge moment screenshot | `docs/launch/assets/forge-moment.png` | Show HN comment replies, Reddit r/LocalLLaMA |

## What the demo MUST show (per VISION line 40)

1. User asks BLADE to do a task it doesn't have a tool for.
2. BLADE detects the gap. Chat shows `[forge] gap_detected`.
3. BLADE writes a new tool. Chat shows `[forge] writing → testing → registered`.
4. BLADE uses the tool. Chat streams the actual result.
5. Second prompt — same tool, no forge. Just runs. (Proves persistence.)

If steps 1–5 aren't all visible in a single take, re-record. The wedge is the WHOLE loop, not just the forge moment.

## Recording the demo

See `scripts/demo/launch-forge-demo.md` for the full 75-second take plan. Real terminal. No music. Voice narration. Single uncut take.

## Asset substitution

Once recorded, drop `forge-demo.gif` + `forge-demo.mp4` + `forge-demo-poster.png` into `docs/launch/assets/`. The README and HN/Twitter copy already reference these paths — no other edits needed.

## Backup demo gaps if HN forge fixture is exhausted

1. arXiv recent abstracts on a query (v2.1 fixture)
2. RSS feed extraction from a niche feed (v2.1 fixture)
3. PyPI package metadata pull (v2.1 fixture)

Each one is wired with an integration test already. They're harder to make visually intuitive than HN, but they prove the same primitive.
