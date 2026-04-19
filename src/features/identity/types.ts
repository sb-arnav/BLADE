// src/features/identity/types.ts
// Cluster-local barrel — re-exports Tauri wrapper types + UI-only types.
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-161
// @see src/lib/tauri/identity.ts

export type {
  // character
  CharacterBible,
  // soul_commands
  SoulState,
  SoulSnapshot,
  BrainPreference,
  UserProfile,
  IdentityKnowledgeNode,
  // persona_engine
  PersonaTrait,
  RelationshipState,
  UserModel,
  ExpertiseEntry,
  // negotiation_engine
  NegotiationArgument,
  DebateRound,
  DebateSession,
  NegotiationScenario,
  // reasoning_engine
  ReasoningStep,
  ReasoningTrace,
  HypothesisTest,
  // context_engine
  ContextChunk,
  AssembledContextResponse,
  // sidecar
  SidecarDevice,
  SidecarPing,
  SidecarRunAllEntry,
  // personality_mirror
  PersonalityProfile,
  // kali
  KaliScanResult,
  KaliFinding,
} from '@/lib/tauri/identity';

// ═══════════════════════════════════════════════════════════════════════════
// Cluster-only UI types (Plans 06-05..06 extend).
// ═══════════════════════════════════════════════════════════════════════════

/** Active tab key for PersonaView / NegotiationView tabbed surfaces (D-154, D-156). */
export type IdentityTabKey = string;

/** Renderable bible section pair (label + prose body). */
export interface IdentitySection {
  key: string;
  label: string;
  content: string;
}
