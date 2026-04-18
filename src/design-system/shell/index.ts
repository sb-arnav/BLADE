// src/design-system/shell/index.ts — Shell primitives barrel.
//
// Append-only — each subsequent plan adds one line, never reshapes the API
// (D-51). Phase 2 Wave 1 shipped TitleBar (Plan 02-03). Wave 2 (this file)
// adds NavRail + CommandPalette + NavIcon (Plan 02-05). Wave 3 will add
// GlobalOverlays (Plan 02-06).
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-51

export { TitleBar } from './TitleBar';
export { NavRail } from './NavRail';
export { CommandPalette } from './CommandPalette';
export { NavIcon } from './navrail-icons';
