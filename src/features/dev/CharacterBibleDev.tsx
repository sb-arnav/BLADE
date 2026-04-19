// src/features/dev/CharacterBibleDev.tsx — DEV-only isolation route for CharacterBible.
//
// Phase 6 Plan 06-07 Task 1. Mounts <CharacterBible/> in the main-window route
// tree so Playwright can assert SC-4 pragmatic closure (CharacterBible renders
// consolidated bible content + honest "trait evolution log deferred" card per
// D-155) without needing a live character.rs backend.
//
// The Playwright shim (tests/e2e/identity-character-bible.spec.ts) intercepts
// `get_character_bible` / `consolidate_character` /
// `consolidate_reactions_to_preferences` / `update_character_section` invokes
// and returns canned rows matching the CharacterBible Rust struct shape (flat
// {identity, preferences, projects, skills, contacts, notes, last_updated} —
// see src/lib/tauri/identity.ts for the interface declaration). The dev route
// body is a passthrough; all mocking lives in the test shim.
//
// @see tests/e2e/identity-character-bible.spec.ts
// @see .planning/phases/06-life-os-identity/06-07-PLAN.md Task 1

import { CharacterBible } from '@/features/identity/CharacterBible';

export function CharacterBibleDev() {
  return <CharacterBible />;
}
