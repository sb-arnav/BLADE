// src/lib/tauri/identity.ts
//
// Typed wrappers for the Identity cluster — one per registered Rust #[tauri::command]
// across character.rs, soul_commands.rs, persona_engine.rs, negotiation_engine.rs,
// reasoning_engine.rs, context_engine.rs, sidecar.rs, personality_mirror.rs,
// and kali.rs (D-140 inventory — 9 modules, ~60 commands total).
//
// D-139: per-cluster wrapper module lives HERE (identity cluster only).
// D-140: zero Rust expansion in Phase 6 — every command below is already registered
//        in src-tauri/src/lib.rs generate_handler!.
// D-159: camelCase JS API, snake_case at invoke boundary. No raw invoke.
// D-38:  @see Rust cite in JSDoc; invokeTyped only; ESLint no-raw-tauri.
// D-160: return types mirror Rust #[derive(Serialize)] shape verbatim — snake_case
//        fields preserved to match the wire payload.
// D-158: kali_* surfaces ship in Identity cluster via SidecarView per D-158.
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-139..D-165
// @see .planning/phases/06-life-os-identity/06-PATTERNS.md §1
// @see src-tauri/src/lib.rs:759-1282 generate_handler!

import { invokeTyped } from './_base';

// ═══════════════════════════════════════════════════════════════════════════
// Types — mirror Rust Serialize shape verbatim.
// All interfaces carry `[k: string]: unknown` for forward-compat (D-160).
// ═══════════════════════════════════════════════════════════════════════════

// ─── character.rs ────────────────────────────────────────────────────────────

/** @see src-tauri/src/character.rs:8 CharacterBible */
export interface CharacterBible {
  identity: string;
  preferences: string;
  projects: string;
  skills: string;
  contacts: string;
  notes: string;
  last_updated: string;
  [k: string]: unknown;
}

// ─── soul_commands.rs ────────────────────────────────────────────────────────

/** @see src-tauri/src/db.rs SoulSnapshot — returned by soul_get_snapshots. */
export interface SoulSnapshot {
  id?: string;
  created_at: number;
  diff_summary: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/db.rs BrainPreferenceRow — flat preference row. */
export interface BrainPreference {
  id: string;
  key?: string;
  value?: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/soul_commands.rs:21 SoulState */
export interface SoulState {
  character_bible: CharacterBible;
  blade_soul: string;
  preferences: BrainPreference[];
  snapshots: SoulSnapshot[];
  latest_diff?: string | null;
  last_snapshot_at?: number | null;
  [k: string]: unknown;
}

/** @see src-tauri/src/soul_commands.rs:203 KnowledgeNode */
export interface IdentityKnowledgeNode {
  id: string;
  label: string;
  node_type: string;
  description: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/soul_commands.rs:192 UserProfile */
export interface UserProfile {
  user_name: string;
  onboarding_complete: boolean;
  traits: PersonaTrait[];
  relationship: RelationshipState;
  persona_md: string;
  activity_context: string;
  knowledge_nodes: IdentityKnowledgeNode[];
  [k: string]: unknown;
}

// ─── persona_engine.rs ───────────────────────────────────────────────────────

/** @see src-tauri/src/persona_engine.rs:22 PersonaTrait */
export interface PersonaTrait {
  trait_name: string;
  score: number;
  confidence: number;
  evidence: string[];
  updated_at: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/persona_engine.rs:40 RelationshipState */
export interface RelationshipState {
  intimacy_score: number;
  trust_score: number;
  shared_context: string[];
  inside_jokes: string[];
  growth_moments: string[];
  [k: string]: unknown;
}

/** @see src-tauri/src/persona_engine.rs:639 UserModel */
export interface UserModel {
  name: string;
  role: string;
  primary_languages: string[];
  /** `(start_hour, end_hour)` tuple — 24h format. */
  work_hours: [number, number];
  energy_pattern: string;
  communication_style: string;
  pet_peeves: string[];
  active_projects: string[];
  goals: string[];
  /** `(name, relationship)` tuples. */
  relationships: Array<[string, string]>;
  /** `(topic, confidence)` tuples. */
  expertise: Array<[string, number]>;
  mood_today: string;
  [k: string]: unknown;
}

/** Expertise map entries returned as `Vec<(String, f32)>` tuples. */
export type ExpertiseEntry = [string, number];

// ─── negotiation_engine.rs ───────────────────────────────────────────────────

/** @see src-tauri/src/negotiation_engine.rs:17 Argument */
export interface NegotiationArgument {
  position: string;
  supporting_points: string[];
  evidence: string[];
  weaknesses: string[];
  confidence: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/negotiation_engine.rs:26 DebateRound */
export interface DebateRound {
  round_num: number;
  user_argument: NegotiationArgument;
  opponent_argument: NegotiationArgument;
  blade_coaching: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/negotiation_engine.rs:34 DebateSession */
export interface DebateSession {
  id: string;
  topic: string;
  user_position: string;
  opponent_position: string;
  rounds: DebateRound[];
  verdict?: string | null;
  created_at: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/negotiation_engine.rs:45 NegotiationScenario */
export interface NegotiationScenario {
  id: string;
  context: string;
  user_goal: string;
  their_likely_goal: string;
  tactics: string[];
  scripts: string[];
  batna: string;
  created_at: number;
  [k: string]: unknown;
}

// ─── reasoning_engine.rs ─────────────────────────────────────────────────────

/** @see src-tauri/src/reasoning_engine.rs ReasoningStep — step inside a ReasoningTrace. */
export interface ReasoningStep {
  step_num?: number;
  content?: string;
  confidence?: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/reasoning_engine.rs:28 ReasoningTrace */
export interface ReasoningTrace {
  id: string;
  question: string;
  steps: ReasoningStep[];
  final_answer: string;
  total_confidence: number;
  reasoning_quality: number;
  created_at: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/reasoning_engine.rs:39 HypothesisTest */
export interface HypothesisTest {
  hypothesis: string;
  evidence_for: string[];
  evidence_against: string[];
  verdict: string;
  confidence: number;
  [k: string]: unknown;
}

// ─── context_engine.rs ───────────────────────────────────────────────────────

/** @see src-tauri/src/context_engine.rs:26 ContextChunk */
export interface ContextChunk {
  source: string;
  content: string;
  relevance_score: number;
  token_estimate: number;
  timestamp: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/context_engine.rs:621 AssembledContextResponse */
export interface AssembledContextResponse {
  chunks: ContextChunk[];
  total_tokens: number;
  sources_used: string[];
  was_truncated: boolean;
  formatted: string;
  [k: string]: unknown;
}

// ─── sidecar.rs ──────────────────────────────────────────────────────────────

/** @see src-tauri/src/sidecar.rs:24 SidecarDevice */
export interface SidecarDevice {
  id: string;
  name: string;
  address: string;
  secret: string;
  status: string; // "online" | "offline" | "unknown"
  last_seen?: number | null;
  capabilities: string[];
  os: string;
  hostname: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/sidecar.rs:68 SidecarPing */
export interface SidecarPing {
  hostname: string;
  os: string;
  capabilities: string[];
  version: string;
  [k: string]: unknown;
}

/** `sidecar_run_all` returns `Vec<serde_json::Value>` — each entry:
 *  `{ device: string, result: string, error: string }`. */
export interface SidecarRunAllEntry {
  device: string;
  result: string;
  error: string;
  [k: string]: unknown;
}

// ─── personality_mirror.rs ───────────────────────────────────────────────────

/** @see src-tauri/src/personality_mirror.rs:19 PersonalityProfile */
export interface PersonalityProfile {
  summary: string;
  avg_message_length: string;
  emoji_frequency: number;
  formality_level: number;
  technical_depth: number;
  humor_style: string;
  signature_phrases: string[];
  [k: string]: unknown;
}

// ─── kali.rs ─────────────────────────────────────────────────────────────────

/** @see src-tauri/src/kali.rs:358 Finding */
export interface KaliFinding {
  severity: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/kali.rs:349 ScanResult */
export interface KaliScanResult {
  target: string;
  tool: string;
  output: string;
  findings: KaliFinding[];
  timestamp: number;
  [k: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// character.rs — 7 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/character.rs:87 consolidate_character
 * Rust signature: `consolidate_character() -> Result<String, String>`.
 */
export function consolidateCharacter(): Promise<string> {
  return invokeTyped<string>('consolidate_character', {});
}

/**
 * @see src-tauri/src/character.rs:169 consolidate_reactions_to_preferences
 * Rust returns the number of preferences consolidated.
 */
export function consolidateReactionsToPreferences(): Promise<number> {
  return invokeTyped<number>('consolidate_reactions_to_preferences', {});
}

/**
 * @see src-tauri/src/character.rs:248 reaction_instant_rule
 * Rust signature: `reaction_instant_rule(message_content: String) -> Result<String, String>` —
 * note: takes the message content that triggered the rule, NOT a rule string directly.
 */
export function reactionInstantRule(messageContent: string): Promise<string> {
  return invokeTyped<string, { message_content: string }>('reaction_instant_rule', {
    message_content: messageContent,
  });
}

/**
 * @see src-tauri/src/character.rs:450 blade_get_soul
 * Rust signature: `blade_get_soul() -> String` — returns the current soul body.
 */
export function bladeGetSoul(): Promise<string> {
  return invokeTyped<string>('blade_get_soul', {});
}

/**
 * @see src-tauri/src/character.rs:294 get_character_bible
 * Rust signature: `get_character_bible() -> CharacterBible`.
 */
export function getCharacterBible(): Promise<CharacterBible> {
  return invokeTyped<CharacterBible>('get_character_bible', {});
}

/**
 * @see src-tauri/src/character.rs:299 update_character_section
 * Rust signature: `update_character_section(section: String, content: String) -> Result<(), String>`.
 * Valid sections: "identity" | "preferences" | "projects" | "skills" | "contacts" | "notes".
 */
export function updateCharacterSection(args: {
  section: string;
  content: string;
}): Promise<void> {
  return invokeTyped<void, { section: string; content: string }>(
    'update_character_section',
    { section: args.section, content: args.content },
  );
}

/**
 * @see src-tauri/src/character.rs:464 apply_reaction_to_traits
 * Rust signature: `apply_reaction_to_traits(message_content: String, polarity: i32,
 *   tools_used: Vec<String>) -> Result<String, String>` — polarity is +1/-1.
 */
export function applyReactionToTraits(args: {
  messageContent: string;
  polarity: number;
  toolsUsed: string[];
}): Promise<string> {
  return invokeTyped<
    string,
    { message_content: string; polarity: number; tools_used: string[] }
  >('apply_reaction_to_traits', {
    message_content: args.messageContent,
    polarity: args.polarity,
    tools_used: args.toolsUsed,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// soul_commands.rs — 6 commands
// ═══════════════════════════════════════════════════════════════════════════

/** @see src-tauri/src/soul_commands.rs:31 soul_get_state */
export function soulGetState(): Promise<SoulState> {
  return invokeTyped<SoulState>('soul_get_state', {});
}

/** @see src-tauri/src/soul_commands.rs:55 soul_take_snapshot */
export function soulTakeSnapshot(): Promise<string> {
  return invokeTyped<string>('soul_take_snapshot', {});
}

/** @see src-tauri/src/soul_commands.rs:170 soul_delete_preference */
export function soulDeletePreference(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('soul_delete_preference', { id });
}

/**
 * @see src-tauri/src/soul_commands.rs:178 soul_update_bible_section
 * Delegates to character::update_character_section under the hood.
 */
export function soulUpdateBibleSection(args: {
  section: string;
  content: string;
}): Promise<void> {
  return invokeTyped<void, { section: string; content: string }>(
    'soul_update_bible_section',
    { section: args.section, content: args.content },
  );
}

/**
 * @see src-tauri/src/soul_commands.rs:184 soul_refresh_bible
 * Delegates to character::consolidate_character.
 */
export function soulRefreshBible(): Promise<string> {
  return invokeTyped<string>('soul_refresh_bible', {});
}

/** @see src-tauri/src/soul_commands.rs:210 get_user_profile */
export function getUserProfile(): Promise<UserProfile> {
  return invokeTyped<UserProfile>('get_user_profile', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// persona_engine.rs — 12 commands (D-140 lists 13; actual registered count is 12)
// ═══════════════════════════════════════════════════════════════════════════

/** @see src-tauri/src/persona_engine.rs:1211 persona_get_traits */
export function personaGetTraits(): Promise<PersonaTrait[]> {
  return invokeTyped<PersonaTrait[]>('persona_get_traits', {});
}

/** @see src-tauri/src/persona_engine.rs:1217 persona_get_relationship */
export function personaGetRelationship(): Promise<RelationshipState> {
  return invokeTyped<RelationshipState>('persona_get_relationship', {});
}

/**
 * @see src-tauri/src/persona_engine.rs:1223 persona_update_trait
 * Rust signature: `persona_update_trait(trait_name: String, score: f32, evidence: String) -> Result<(), String>`.
 */
export function personaUpdateTrait(args: {
  traitName: string;
  score: number;
  evidence: string;
}): Promise<void> {
  return invokeTyped<void, { trait_name: string; score: number; evidence: string }>(
    'persona_update_trait',
    { trait_name: args.traitName, score: args.score, evidence: args.evidence },
  );
}

/** @see src-tauri/src/persona_engine.rs:478 persona_get_context */
export function personaGetContext(): Promise<string> {
  return invokeTyped<string>('persona_get_context', {});
}

/**
 * @see src-tauri/src/persona_engine.rs:1231 persona_analyze_now
 * Rust signature: `persona_analyze_now() -> Result<Vec<PersonaTrait>, String>`.
 */
export function personaAnalyzeNow(): Promise<PersonaTrait[]> {
  return invokeTyped<PersonaTrait[]>('persona_analyze_now', {});
}

/**
 * @see src-tauri/src/persona_engine.rs:1260 persona_record_outcome
 * Rust signature: `persona_record_outcome(was_helpful: bool, topic: String)` — returns unit.
 */
export function personaRecordOutcome(args: {
  wasHelpful: boolean;
  topic: string;
}): Promise<void> {
  return invokeTyped<void, { was_helpful: boolean; topic: string }>(
    'persona_record_outcome',
    { was_helpful: args.wasHelpful, topic: args.topic },
  );
}

/**
 * @see src-tauri/src/persona_engine.rs:609 persona_analyze_now_weekly
 * Rust signature: `persona_analyze_now_weekly(app: tauri::AppHandle) -> Result<String, String>`.
 * Note: AppHandle is Tauri-managed; frontend passes no args.
 */
export function personaAnalyzeNowWeekly(): Promise<string> {
  return invokeTyped<string>('persona_analyze_now_weekly', {});
}

/** @see src-tauri/src/persona_engine.rs:1267 get_user_model */
export function getUserModel(): Promise<UserModel> {
  return invokeTyped<UserModel>('get_user_model', {});
}

/**
 * @see src-tauri/src/persona_engine.rs:1276 predict_next_need_cmd
 * Returns Option<String>.
 */
export function predictNextNeedCmd(): Promise<string | null> {
  return invokeTyped<string | null>('predict_next_need_cmd', {});
}

/**
 * @see src-tauri/src/persona_engine.rs:1285 get_expertise_map
 * Rust returns `Vec<(String, f32)>` — tuples ordered by confidence desc.
 */
export function getExpertiseMap(): Promise<ExpertiseEntry[]> {
  return invokeTyped<ExpertiseEntry[]>('get_expertise_map', {});
}

/**
 * @see src-tauri/src/persona_engine.rs:1296 update_expertise
 * Rust signature: `update_expertise(topics: Vec<String>, user_knew_it: bool, evidence: String)` — returns unit.
 */
export function updateExpertise(args: {
  topics: string[];
  userKnewIt: boolean;
  evidence: string;
}): Promise<void> {
  return invokeTyped<void, { topics: string[]; user_knew_it: boolean; evidence: string }>(
    'update_expertise',
    { topics: args.topics, user_knew_it: args.userKnewIt, evidence: args.evidence },
  );
}

/**
 * @see src-tauri/src/persona_engine.rs:1303 persona_estimate_mood
 * Rust signature: `persona_estimate_mood(recent_messages: Vec<String>,
 *   time_of_day: u8, streak_minutes: u32) -> String`.
 */
export function personaEstimateMood(args: {
  recentMessages: string[];
  timeOfDay: number;
  streakMinutes: number;
}): Promise<string> {
  return invokeTyped<
    string,
    { recent_messages: string[]; time_of_day: number; streak_minutes: number }
  >('persona_estimate_mood', {
    recent_messages: args.recentMessages,
    time_of_day: args.timeOfDay,
    streak_minutes: args.streakMinutes,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// negotiation_engine.rs — 11 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/negotiation_engine.rs:872 negotiation_build_argument
 * Rust signature: `negotiation_build_argument(topic, position, context) -> Result<Argument, String>`.
 */
export function negotiationBuildArgument(args: {
  topic: string;
  position: string;
  context: string;
}): Promise<NegotiationArgument> {
  return invokeTyped<
    NegotiationArgument,
    { topic: string; position: string; context: string }
  >('negotiation_build_argument', {
    topic: args.topic,
    position: args.position,
    context: args.context,
  });
}

/**
 * @see src-tauri/src/negotiation_engine.rs:882 negotiation_steelman
 * Rust signature: `negotiation_steelman(topic, opponent_position) -> Result<Argument, String>`.
 */
export function negotiationSteelman(args: {
  topic: string;
  opponentPosition: string;
}): Promise<NegotiationArgument> {
  return invokeTyped<NegotiationArgument, { topic: string; opponent_position: string }>(
    'negotiation_steelman',
    { topic: args.topic, opponent_position: args.opponentPosition },
  );
}

/**
 * @see src-tauri/src/negotiation_engine.rs:891 negotiation_find_common_ground
 * Rust signature: `negotiation_find_common_ground(pos_a, pos_b, topic) -> Result<String, String>`.
 */
export function negotiationFindCommonGround(args: {
  posA: string;
  posB: string;
  topic: string;
}): Promise<string> {
  return invokeTyped<string, { pos_a: string; pos_b: string; topic: string }>(
    'negotiation_find_common_ground',
    { pos_a: args.posA, pos_b: args.posB, topic: args.topic },
  );
}

/**
 * @see src-tauri/src/negotiation_engine.rs:904 negotiation_start_debate
 * Rust signature: `negotiation_start_debate(topic, user_position) -> Result<DebateSession, String>`.
 */
export function negotiationStartDebate(args: {
  topic: string;
  userPosition: string;
}): Promise<DebateSession> {
  return invokeTyped<DebateSession, { topic: string; user_position: string }>(
    'negotiation_start_debate',
    { topic: args.topic, user_position: args.userPosition },
  );
}

/**
 * @see src-tauri/src/negotiation_engine.rs:912 negotiation_round
 * Rust signature: `negotiation_round(session_id, user_message, app) -> Result<DebateRound, String>`.
 * Note: AppHandle is Tauri-managed; frontend passes session + message only.
 */
export function negotiationRound(args: {
  sessionId: string;
  userMessage: string;
}): Promise<DebateRound> {
  return invokeTyped<DebateRound, { session_id: string; user_message: string }>(
    'negotiation_round',
    { session_id: args.sessionId, user_message: args.userMessage },
  );
}

/**
 * @see src-tauri/src/negotiation_engine.rs:921 negotiation_conclude
 * Rust signature: `negotiation_conclude(session_id: String) -> Result<String, String>`.
 */
export function negotiationConclude(sessionId: string): Promise<string> {
  return invokeTyped<string, { session_id: string }>('negotiation_conclude', {
    session_id: sessionId,
  });
}

/**
 * @see src-tauri/src/negotiation_engine.rs:926 negotiation_analyze
 * Rust signature: `negotiation_analyze(context, user_goal, their_info) -> Result<NegotiationScenario, String>`.
 */
export function negotiationAnalyze(args: {
  context: string;
  userGoal: string;
  theirInfo: string;
}): Promise<NegotiationScenario> {
  return invokeTyped<
    NegotiationScenario,
    { context: string; user_goal: string; their_info: string }
  >('negotiation_analyze', {
    context: args.context,
    user_goal: args.userGoal,
    their_info: args.theirInfo,
  });
}

/**
 * @see src-tauri/src/negotiation_engine.rs:935 negotiation_roleplay
 * Rust signature: `negotiation_roleplay(scenario_id, their_message) -> Result<String, String>`.
 */
export function negotiationRoleplay(args: {
  scenarioId: string;
  theirMessage: string;
}): Promise<string> {
  return invokeTyped<string, { scenario_id: string; their_message: string }>(
    'negotiation_roleplay',
    { scenario_id: args.scenarioId, their_message: args.theirMessage },
  );
}

/**
 * @see src-tauri/src/negotiation_engine.rs:943 negotiation_critique_move
 * Rust signature: `negotiation_critique_move(scenario_id, user_move) -> Result<String, String>`.
 */
export function negotiationCritiqueMove(args: {
  scenarioId: string;
  userMove: string;
}): Promise<string> {
  return invokeTyped<string, { scenario_id: string; user_move: string }>(
    'negotiation_critique_move',
    { scenario_id: args.scenarioId, user_move: args.userMove },
  );
}

/**
 * @see src-tauri/src/negotiation_engine.rs:951 negotiation_get_debates
 * Rust signature: `negotiation_get_debates(limit: usize) -> Vec<DebateSession>` — limit is REQUIRED.
 */
export function negotiationGetDebates(limit: number): Promise<DebateSession[]> {
  return invokeTyped<DebateSession[], { limit: number }>('negotiation_get_debates', { limit });
}

/**
 * @see src-tauri/src/negotiation_engine.rs:957 negotiation_get_scenarios
 * Rust signature: `negotiation_get_scenarios(limit: usize) -> Vec<NegotiationScenario>` — limit REQUIRED.
 */
export function negotiationGetScenarios(limit: number): Promise<NegotiationScenario[]> {
  return invokeTyped<NegotiationScenario[], { limit: number }>('negotiation_get_scenarios', {
    limit,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// reasoning_engine.rs — 5 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/reasoning_engine.rs:763 reasoning_think
 * Rust signature: `reasoning_think(app, question: String, context: Option<String>,
 *   max_steps: Option<usize>) -> Result<ReasoningTrace, String>`.
 * Note: AppHandle is Tauri-managed.
 */
export function reasoningThink(args: {
  question: string;
  context?: string;
  maxSteps?: number;
}): Promise<ReasoningTrace> {
  return invokeTyped<
    ReasoningTrace,
    { question: string; context?: string; max_steps?: number }
  >('reasoning_think', {
    question: args.question,
    context: args.context,
    max_steps: args.maxSteps,
  });
}

/**
 * @see src-tauri/src/reasoning_engine.rs:776 reasoning_decompose
 * Rust signature: `reasoning_decompose(question: String) -> Result<Vec<String>, String>`.
 */
export function reasoningDecompose(question: string): Promise<string[]> {
  return invokeTyped<string[], { question: string }>('reasoning_decompose', { question });
}

/**
 * @see src-tauri/src/reasoning_engine.rs:782 reasoning_test_hypothesis
 * Rust signature: `reasoning_test_hypothesis(hypothesis, evidence) -> Result<HypothesisTest, String>`.
 */
export function reasoningTestHypothesis(args: {
  hypothesis: string;
  evidence: string;
}): Promise<HypothesisTest> {
  return invokeTyped<HypothesisTest, { hypothesis: string; evidence: string }>(
    'reasoning_test_hypothesis',
    { hypothesis: args.hypothesis, evidence: args.evidence },
  );
}

/**
 * @see src-tauri/src/reasoning_engine.rs:791 reasoning_socratic
 * Rust signature: `reasoning_socratic(question: String, depth: Option<usize>)
 *   -> Result<Vec<(String, String)>, String>` — each tuple is [question, answer].
 */
export function reasoningSocratic(args: {
  question: string;
  depth?: number;
}): Promise<Array<[string, string]>> {
  return invokeTyped<Array<[string, string]>, { question: string; depth?: number }>(
    'reasoning_socratic',
    { question: args.question, depth: args.depth },
  );
}

/**
 * @see src-tauri/src/reasoning_engine.rs:801 reasoning_get_traces
 * Rust signature: `reasoning_get_traces(limit: Option<usize>) -> Vec<ReasoningTrace>`.
 */
export function reasoningGetTraces(limit?: number): Promise<ReasoningTrace[]> {
  return invokeTyped<ReasoningTrace[], { limit?: number }>('reasoning_get_traces', { limit });
}

// ═══════════════════════════════════════════════════════════════════════════
// context_engine.rs — 3 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/context_engine.rs:630 context_assemble
 * Rust signature: `context_assemble(query: String, max_tokens: Option<usize>,
 *   sources: Option<Vec<String>>) -> Result<AssembledContextResponse, String>`.
 */
export function contextAssemble(args: {
  query: string;
  maxTokens?: number;
  sources?: string[];
}): Promise<AssembledContextResponse> {
  return invokeTyped<
    AssembledContextResponse,
    { query: string; max_tokens?: number; sources?: string[] }
  >('context_assemble', {
    query: args.query,
    max_tokens: args.maxTokens,
    sources: args.sources,
  });
}

/**
 * @see src-tauri/src/context_engine.rs:657 context_score_chunk
 * Rust signature: `context_score_chunk(query: String, chunk: String) -> Result<f32, String>`.
 */
export function contextScoreChunk(args: { query: string; chunk: string }): Promise<number> {
  return invokeTyped<number, { query: string; chunk: string }>('context_score_chunk', {
    query: args.query,
    chunk: args.chunk,
  });
}

/** @see src-tauri/src/context_engine.rs:663 context_clear_cache */
export function contextClearCache(): Promise<void> {
  return invokeTyped<void>('context_clear_cache', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// sidecar.rs — 7 commands
// ═══════════════════════════════════════════════════════════════════════════

/** @see src-tauri/src/sidecar.rs:643 sidecar_list_devices */
export function sidecarListDevices(): Promise<SidecarDevice[]> {
  return invokeTyped<SidecarDevice[]>('sidecar_list_devices', {});
}

/**
 * @see src-tauri/src/sidecar.rs:648 sidecar_register_device
 * Rust signature: `sidecar_register_device(name, address, secret) -> Result<String, String>`.
 */
export function sidecarRegisterDevice(args: {
  name: string;
  address: string;
  secret: string;
}): Promise<string> {
  return invokeTyped<string, { name: string; address: string; secret: string }>(
    'sidecar_register_device',
    { name: args.name, address: args.address, secret: args.secret },
  );
}

/** @see src-tauri/src/sidecar.rs:657 sidecar_remove_device */
export function sidecarRemoveDevice(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('sidecar_remove_device', { id });
}

/**
 * @see src-tauri/src/sidecar.rs:662 sidecar_ping_device
 * Rust signature: `sidecar_ping_device(id: String) -> Result<SidecarPing, String>`.
 */
export function sidecarPingDevice(id: string): Promise<SidecarPing> {
  return invokeTyped<SidecarPing, { id: string }>('sidecar_ping_device', { id });
}

/**
 * @see src-tauri/src/sidecar.rs:667 sidecar_run_command
 * Rust signature: `sidecar_run_command(device_id: String, command: String) -> Result<String, String>`.
 */
export function sidecarRunCommand(args: {
  deviceId: string;
  command: string;
}): Promise<string> {
  return invokeTyped<string, { device_id: string; command: string }>(
    'sidecar_run_command',
    { device_id: args.deviceId, command: args.command },
  );
}

/**
 * @see src-tauri/src/sidecar.rs:677 sidecar_run_all
 * Rust signature: `sidecar_run_all(command: String) -> Vec<serde_json::Value>` —
 * each value is `{device, result, error}` per SidecarRunAllEntry.
 */
export function sidecarRunAll(command: string): Promise<SidecarRunAllEntry[]> {
  return invokeTyped<SidecarRunAllEntry[], { command: string }>('sidecar_run_all', { command });
}

/**
 * @see src-tauri/src/sidecar.rs:690 sidecar_start_server
 * Rust signature: `sidecar_start_server(port: u16, secret: String) -> Result<String, String>`.
 * WARNING: lifecycle command — consumer MUST gate behind Dialog confirm per D-158.
 */
export function sidecarStartServer(args: { port: number; secret: string }): Promise<string> {
  return invokeTyped<string, { port: number; secret: string }>('sidecar_start_server', {
    port: args.port,
    secret: args.secret,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// personality_mirror.rs — 3 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/personality_mirror.rs:307 personality_analyze
 * Rust signature: `personality_analyze(app: tauri::AppHandle) -> Result<PersonalityProfile, String>`.
 * Note: AppHandle is Tauri-managed; frontend passes no args.
 */
export function personalityAnalyze(): Promise<PersonalityProfile> {
  return invokeTyped<PersonalityProfile>('personality_analyze', {});
}

/**
 * @see src-tauri/src/personality_mirror.rs:372 personality_import_chats
 * Rust signature: `personality_import_chats(path: String, source: String) -> Result<u32, String>` —
 * returns the number of user messages processed.
 */
export function personalityImportChats(args: {
  path: string;
  source: string;
}): Promise<number> {
  return invokeTyped<number, { path: string; source: string }>('personality_import_chats', {
    path: args.path,
    source: args.source,
  });
}

/**
 * @see src-tauri/src/personality_mirror.rs:755 personality_get_profile
 * Returns Option<PersonalityProfile>.
 */
export function personalityGetProfile(): Promise<PersonalityProfile | null> {
  return invokeTyped<PersonalityProfile | null>('personality_get_profile', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// kali.rs — 6 commands (exposed via SidecarView per D-158)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/kali.rs:1093 kali_recon
 * Rust signature: `kali_recon(target: String) -> Result<ScanResult, String>`.
 */
export function kaliRecon(target: string): Promise<KaliScanResult> {
  return invokeTyped<KaliScanResult, { target: string }>('kali_recon', { target });
}

/**
 * @see src-tauri/src/kali.rs:1098 kali_crack_hash
 * Rust signature: `kali_crack_hash(hash: String, hash_type: Option<String>) -> Result<String, String>`.
 */
export function kaliCrackHash(args: { hash: string; hashType?: string }): Promise<string> {
  return invokeTyped<string, { hash: string; hash_type?: string }>('kali_crack_hash', {
    hash: args.hash,
    hash_type: args.hashType,
  });
}

/**
 * @see src-tauri/src/kali.rs:1103 kali_analyze_ctf
 * Rust signature: `kali_analyze_ctf(name, category, description, files: Vec<String>) -> Result<String, String>`.
 */
export function kaliAnalyzeCtf(args: {
  name: string;
  category: string;
  description: string;
  files: string[];
}): Promise<string> {
  return invokeTyped<
    string,
    { name: string; category: string; description: string; files: string[] }
  >('kali_analyze_ctf', {
    name: args.name,
    category: args.category,
    description: args.description,
    files: args.files,
  });
}

/**
 * @see src-tauri/src/kali.rs:1124 kali_explain_exploit
 * Rust signature: `kali_explain_exploit(code: String) -> Result<String, String>`.
 */
export function kaliExplainExploit(code: string): Promise<string> {
  return invokeTyped<string, { code: string }>('kali_explain_exploit', { code });
}

/**
 * @see src-tauri/src/kali.rs:1129 kali_generate_payload
 * Rust signature: `kali_generate_payload(payload_type, target_info) -> Result<String, String>`.
 */
export function kaliGeneratePayload(args: {
  payloadType: string;
  targetInfo: string;
}): Promise<string> {
  return invokeTyped<string, { payload_type: string; target_info: string }>(
    'kali_generate_payload',
    { payload_type: args.payloadType, target_info: args.targetInfo },
  );
}

/**
 * @see src-tauri/src/kali.rs:1137 kali_check_tools
 * Returns serde_json::Value with per-tool availability map + _wordlists nested map.
 */
export function kaliCheckTools(): Promise<Record<string, unknown>> {
  return invokeTyped<Record<string, unknown>>('kali_check_tools', {});
}
