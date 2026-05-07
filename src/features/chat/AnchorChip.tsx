// src/features/chat/AnchorChip.tsx — Phase 36 Plan 36-08 (INTEL-06).
//
// Inline chip rendered when a user message contains an @screen / @file: /
// @memory: anchor token. Mirrors the backend regex in
// src-tauri/src/intelligence/anchor_parser.rs (\B word-boundary discipline).
//
// Render shape:
//   - One <span> with three visual variants keyed by `variant`.
//   - No icon library dependency (the chat surface uses design-system
//     primitives only — see CHIP precedent in JarvisPill.tsx). A short
//     uppercase glyph carries the type signal. Tailwind v4 utility classes
//     are intentionally minimal so the chip inherits the surrounding bubble
//     palette; a `data-anchor-variant` attribute is exposed for downstream
//     theme overrides without rebuilding the component.
//
// Security (T-36-45):
//   - The `payload` prop is rendered through standard JSX children. React's
//     auto-escaping applies — script-shaped strings flow as literal text. We
//     do NOT interpolate `payload` into a className or attribute that could
//     be reinterpreted as markup, and we never bypass React's child-escaping.
//
// Streaming contract (MEMORY.md project_chat_streaming_contract):
//   - This component is invoked by MessageBubble's text renderer. The
//     rendering path runs only after a user-message commits; the in-progress
//     assistant streaming bubble does not pass through the anchor regex
//     (assistant tokens never contain user-typed @-syntax).
//
// @see src-tauri/src/intelligence/anchor_parser.rs (`\B@(screen|file:|memory:)…`)
// @see .planning/phases/36-context-intelligence/36-08-PLAN.md §AnchorChip props
// @see .planning/phases/36-context-intelligence/36-CONTEXT.md §INTEL-06

import type { CSSProperties } from 'react';

export type AnchorVariant = 'screen' | 'file' | 'memory';

export interface AnchorChipProps {
  /** Which anchor type the user typed. Determines glyph + label prefix. */
  variant: AnchorVariant;
  /** Path (file) or topic (memory). Undefined for screen — @screen has no
   *  payload per the backend regex. */
  payload?: string;
}

/** Three-letter glyph shown to the left of the label. Plain text — no icon
 *  library dependency. Matches the "design-system primitives only" rule
 *  the rest of `src/features/chat/` follows. */
const GLYPH: Record<AnchorVariant, string> = {
  screen: 'SCR',
  file: 'FIL',
  memory: 'MEM',
};

/** Inline styles use design-token CSS variables with conservative fallbacks
 *  (matching the CostMeterChip pattern in InputBar.tsx). This keeps the chip
 *  in palette without bespoke styling and avoids the v1.1 ghost-token trap
 *  documented in MEMORY.md project_ghost_css_tokens. */
const CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: '4px',
  margin: '0 2px',
  padding: '1px 6px',
  borderRadius: '4px',
  fontSize: '0.85em',
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  fontFeatureSettings: '"tnum"',
  whiteSpace: 'nowrap',
  verticalAlign: 'baseline',
  background: 'var(--accent-bg, rgba(120, 160, 220, 0.12))',
  color: 'var(--accent-fg, #8db4ff)',
  border: '1px solid var(--accent-border, rgba(120, 160, 220, 0.30))',
};

const GLYPH_STYLE: CSSProperties = {
  fontSize: '0.7em',
  letterSpacing: '0.05em',
  fontWeight: 600,
  opacity: 0.75,
};

/**
 * Render a single anchor chip. The component is intentionally pure — no
 * memoization, no event handlers — because the parent message-content
 * renderer key-stamps each chip per match index, so React reconciles
 * cheaply.
 */
export function AnchorChip({ variant, payload }: AnchorChipProps) {
  const labelText = payload ? `@${variant}:${payload}` : `@${variant}`;
  return (
    <span
      className={`anchor-chip anchor-chip--${variant}`}
      data-anchor-variant={variant}
      style={CHIP_STYLE}
      title={labelText}
      aria-label={`Context anchor: ${labelText}`}
    >
      <span aria-hidden="true" style={GLYPH_STYLE}>
        {GLYPH[variant]}
      </span>
      <span>{labelText}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// renderWithAnchors — message-text renderer.
//
// Walks `text` once, splitting on the unified anchor regex. Returns an array
// of ReactNodes suitable for `{...}` spread into a JSX child position. The
// regex mirrors the backend (anchor_parser.rs `\B@(screen|file:\S+|memory:\S+)`)
// — `\B` enforces word-boundary discipline so e.g. `email@screen` does NOT
// match.
//
// When `enabled = false`, the function short-circuits and returns the text
// verbatim — this is the CTX-07 escape hatch parity with the backend's
// `config.intelligence.context_anchor_enabled = false` branch.
// ---------------------------------------------------------------------------

const ANCHOR_RE = /\B@(?:(screen)\b|file:(\S+)|memory:(\S+))/g;

export function renderWithAnchors(
  text: string,
  enabled: boolean,
): React.ReactNode[] {
  if (!enabled || !text) return [text];

  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;

  // Iterate matches with a fresh regex copy so concurrent calls don't race
  // on the global lastIndex slot.
  const re = new RegExp(ANCHOR_RE.source, ANCHOR_RE.flags);
  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    const full = match[0];

    // Push the text segment between the previous match and this one.
    if (idx > last) {
      out.push(text.slice(last, idx));
    }

    const screen = match[1];
    const filePath = match[2];
    const memTopic = match[3];

    if (screen) {
      out.push(<AnchorChip key={`anchor-s-${i++}-${idx}`} variant="screen" />);
    } else if (filePath) {
      out.push(
        <AnchorChip
          key={`anchor-f-${i++}-${idx}`}
          variant="file"
          payload={filePath}
        />,
      );
    } else if (memTopic) {
      out.push(
        <AnchorChip
          key={`anchor-m-${i++}-${idx}`}
          variant="memory"
          payload={memTopic}
        />,
      );
    }

    last = idx + full.length;
  }

  // Trailing text after the last match.
  if (last < text.length) {
    out.push(text.slice(last));
  }

  return out;
}
