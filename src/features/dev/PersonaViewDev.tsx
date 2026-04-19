// src/features/dev/PersonaViewDev.tsx — DEV-only isolation route for PersonaView.
//
// Phase 6 Plan 06-07 Task 1. Mounts <PersonaView/> in the main-window route
// tree so Playwright can assert the SC-3 / SC-4 approximation (4-tab persona
// dossier + traits tab renders persona-trait-card entries from
// persona_get_traits) without needing a live persona_engine / people_graph
// backend.
//
// The Playwright shim (tests/e2e/identity-persona-view.spec.ts) intercepts
// `persona_get_traits` / `persona_get_relationship` / `get_user_model` /
// `predict_next_need_cmd` / `get_expertise_map` / `persona_estimate_mood` /
// `people_list` invokes and returns canned rows matching the Rust wire shapes
// (PersonaTrait / RelationshipState / UserModel / Person — see
// src/lib/tauri/identity.ts + src/lib/tauri/life_os.ts for the interface
// declarations). The dev route body is a passthrough; all mocking lives in
// the test shim.
//
// @see tests/e2e/identity-persona-view.spec.ts
// @see .planning/phases/06-life-os-identity/06-07-PLAN.md Task 1

import { PersonaView } from '@/features/identity/PersonaView';

export function PersonaViewDev() {
  return <PersonaView />;
}
