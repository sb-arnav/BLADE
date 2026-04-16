# BLADE Body Mapping — Biology to Machine, Atomic Level

Every biological structure maps to a software structure. This isn't metaphor — it's architecture. When a biological system is weak, the corresponding software system has a bug.

---

## Hierarchy: Atoms → Organism

| Biological | Machine | BLADE Example |
|-----------|---------|---------------|
| **Atom** | Single data point | One clipboard read. One API response byte. One window title string. |
| **Molecule** | Structured data | `TentacleReport`, `TypedMemory`, `PersonProfile`, `PerceptionState` |
| **Organelle** | Function within a module | `poll_tentacle()`, `classify_task()`, `format_tool_result()` |
| **Cell** | Module (.rs file) | `hive.rs`, `brain.rs`, `dna.rs` — self-contained unit with inputs/outputs |
| **Tissue** | Module cluster | Perception tissue (perception_fusion + screen + activity_monitor). Memory tissue (typed_memory + knowledge_graph + embeddings). |
| **Organ** | Subsystem | The Hive. The Brain. The Memory System. The Decision System. |
| **Organ System** | Architectural layer | Nervous System. Immune System. Circulatory System. |
| **Organism** | BLADE | The whole thing, alive on your machine. |

---

## The Brain — Every Region

| Brain Region | Function | BLADE Module | Status |
|-------------|----------|-------------|--------|
| **Prefrontal Cortex** | Planning, decision-making, executive function | `brain_planner.rs` + `decision_gate.rs` + `swarm_planner.rs` | Built. Brain planner produces plans, decision gate classifies risk, swarm planner builds DAGs. |
| **Hippocampus** | Memory formation, consolidation, retrieval | `typed_memory.rs` + `knowledge_graph.rs` + `embeddings.rs` + `memory.rs` | WEAK. 7 memory modules with no unified consolidation pipeline. Memories are stored but never pruned, merged, or strengthened based on access patterns. |
| **Amygdala** | Threat detection, fear response, emotional tagging | `security_monitor.rs` + `emotional_intelligence.rs` + `permissions.rs` | Built. Security monitor detects threats, emotional intelligence tags mood, permissions block dangerous actions. |
| **Thalamus** | Sensory relay station — routes ALL sensory input to correct brain region | `router.rs` + `perception_fusion.rs` | WEAK. router.rs only classifies task type (Code/Vision/Simple/Complex/Creative). It does NOT route perception data to the right consumer. Perception data goes everywhere or nowhere — no selective relay. |
| **Cerebellum** | Learned routines, muscle memory, automatic actions | `learning_engine.rs` + `behavior_patterns` DB table | WEAK. Records patterns but doesn't ACT on them. BLADE observes "user always runs cargo check after editing .rs files" but never auto-runs it. The cerebellum sees but doesn't move. |
| **Basal Ganglia** | Habit formation, action selection, reward learning | `decision_gate.rs` threshold learning + `organ.rs` autonomy gradient | Built. Per-source thresholds adjust from feedback. Autonomy levels per organ per action. |
| **Wernicke's Area** | Language comprehension (understanding input) | The LLM itself (understanding user messages) | Delegated to provider. BLADE doesn't process language — the model does. |
| **Broca's Area** | Language production (generating speech) | The LLM + `tts.rs` + `personality_mirror.rs` | Built. LLM generates text, personality_mirror shapes voice, TTS speaks. |
| **Motor Cortex** | Executing voluntary actions | `native_tools.rs` + `computer_use.rs` + `browser_agent.rs` | Built. 37 native tools, CDP browser control, keyboard/mouse automation. |
| **Somatosensory Cortex** | Processing touch/pressure/temperature | `perception_fusion.rs` (system vitals: RAM, disk, CPU) | Built. Vitals collected every 30s. |
| **Visual Cortex** | Processing visual input | `screen.rs` + `perception_fusion.rs` OCR + `screen_timeline.rs` | Built. Screenshots, OCR, fingerprinting, timeline storage. |
| **Auditory Cortex** | Processing sound | `whisper_local.rs` + `audio_timeline.rs` + `vad.rs` | Built. Whisper transcription, audio timeline, voice activity detection. |
| **Insular Cortex** | Interoception — awareness of internal state | `health_guardian.rs` + `streak_stats.rs` | Built. Screen time tracking, break reminders, streak gamification. |
| **Cingulate Cortex** | Error detection, conflict monitoring | `self_critique.rs` + `proactive_engine.rs` stuck detection | Built. Self-critique scores every response, proactive engine detects repeated errors. |
| **Brainstem** | Automatic vital functions (heartbeat, breathing) | `lib.rs` setup block — all 35 background thread spawns | Built. The brainstem runs at startup and keeps everything alive. |

### What The Brain Mapping Reveals (Bugs)

1. **Hippocampus is fragmented** — 7 memory modules (`typed_memory`, `knowledge_graph`, `memory`, `embeddings`, `episodic`, `people_graph`, `execution_memory`) store independently. No consolidation. A fact in typed_memory doesn't strengthen a relationship in knowledge_graph. Memories are never pruned for staleness. The hippocampus writes but doesn't consolidate during "sleep" (dream_mode exists but doesn't run memory consolidation).

2. **Thalamus doesn't route** — `router.rs` classifies task type for model selection, but there's no sensory relay. When perception sees "user is in VS Code editing auth.rs," this data should be routed to the GitHub organ (check if there's a PR for auth.rs) and the IDE organ (check for errors) but NOT to the Email organ. Currently it goes into the system prompt as undifferentiated text.

3. **Cerebellum doesn't execute** — `learning_engine.rs` detects patterns like "user runs cargo check after editing Rust" but never creates a reflex. A real cerebellum would auto-suggest or auto-run cargo check when a .rs file is saved. The pattern detection is disconnected from action.

---

## The Nervous System

| Component | Function | BLADE Module | Status |
|-----------|----------|-------------|--------|
| **Central Nervous System** (brain + spinal cord) | Core processing + reflexes | `commands.rs` (processing) + `lib.rs` (infrastructure) | Built. |
| **Spinal Cord** | Fast reflexes without brain involvement | Fast-path in `commands.rs` (conversational messages skip tool loop) | Built. Simple messages bypass planning. |
| **Peripheral Nervous System** | Connections to the outside world | Tentacles + MCP servers | Built. 10 tentacles, MCP client with health monitoring. |
| **Autonomic Nervous System** | Automatic background regulation | Background loops (hive tick, perception, ambient, godmode) | Built. 35 background threads. |
| **Sympathetic** (fight-or-flight) | Urgent response escalation | `proactive_engine.rs`, `smart_interrupt`, `decision_gate` Critical path | Built. |
| **Parasympathetic** (rest-and-digest) | Background processing during idle | `dream_mode.rs`, `evolution.rs`, `autonomous_research.rs` | Built but WEAK. dream_mode runs but doesn't consolidate memories. evolution discovers but doesn't always install. |
| **Neurotransmitters** | Chemical signals between neurons | Tauri events (`emit`/`listen`) | Built. ~50 event types. |
| **Synapses** | Connections between neurons | Function calls between modules + event bus | WEAK. No formal event bus — modules call each other directly or through events inconsistently. Some use events, some use direct function calls, some use both. No standard. |

### What The Nervous System Mapping Reveals (Bugs)

4. **No formal event bus** — Modules communicate three different ways: direct function calls (`crate::module::function()`), Tauri events (`app.emit()`), and database reads. There's no standard. The hive uses events. Brain uses function calls. Perception uses a static. This means new connections require knowing which pattern each module uses.

5. **Parasympathetic is underutilized** — `dream_mode.rs` runs during idle but doesn't do the most valuable idle-time work: memory consolidation, pattern strengthening, stale data pruning. It should be the "sleep" cycle that makes BLADE smarter overnight.

---

## The Circulatory System

| Component | Function | BLADE Module | Status |
|-----------|----------|-------------|--------|
| **Heart** | Pumps blood (data) through the body | Hive tick loop (30s) | Built. Real 30s pump cycle. |
| **Arteries** (away from heart) | Data flowing from backend to frontend | Tauri events (`emit`) | Built. |
| **Veins** (toward heart) | Data flowing from frontend to backend | Tauri commands (`invoke`) | Built. |
| **Capillaries** | Fine-grained data exchange between cells | Individual inter-module function calls | Built but unstructured. |
| **Blood** | The data itself | `TentacleReport`, `Decision`, `PerceptionState`, `HudData` | Built. |
| **Red blood cells** | Carry oxygen (essential context) | System prompt context blocks | Built. brain.rs assembles 17 priority blocks. |
| **White blood cells** | Fight infection (handle errors) | Error handlers, fallback chains, autoskills | Built. |
| **Platelets** | Clotting (damage repair) | `self_critique.rs` rebuild, `autoskills.rs` retry | Built. |
| **Blood pressure** | Rate of data flow | Rate limiting, token_efficient mode, 30s/60s/300s intervals | Built. Per-provider, per-tier. |

### What The Circulatory System Mapping Reveals

6. **Blood pressure is unmonitored** — There's no system-wide view of API call rate, token consumption, or cost accumulation in real-time. Individual modules track their own calls but nothing aggregates "BLADE is making 47 API calls/minute and burning $0.30/hour." Provider traces exist (`provider_traces.jsonl`) but aren't analyzed in real-time.

---

## The Immune System

| Component | Function | BLADE Module | Status |
|-----------|----------|-------------|--------|
| **Innate immunity** (immediate, non-specific) | First response to any threat | `autoskills.rs` (immediate tool failure response) | Built. |
| **Adaptive immunity** (specific, learned) | Targeted response with memory | `immune_system.rs` + `tool_forge.rs` | Built. |
| **White blood cells** | Individual defense agents | `check_mcp_catalog()`, `check_cli_tools()`, `can_browser_handle()` | Built. |
| **Antibodies** | Specific solutions to specific problems | Forged tools (tool_forge.rs output) | Built. |
| **Memory B cells** | Remember past infections for faster response | `evolution.rs` catalog + installed MCP server list | Built. |
| **Fever** | System-wide alert raising threshold | `decision_gate` threshold escalation on repeated failures | Built. |
| **Inflammation** | Local damage response | Tool error enrichment (`explain_tool_failure`) | Built. |
| **Skin barrier** | First line of defense | `permissions.rs` tool risk classification (Blocked/Ask/Allow) | Built. |

### Immune System is actually solid. No major gaps.

---

## The Digestive System

| Component | Function | BLADE Module | Status |
|-----------|----------|-------------|--------|
| **Mouth** | Intake raw input | User text/voice/image input via Skin | Built. |
| **Saliva** | Begin breaking down input | `router.rs::classify_task()` — first classification | Built. |
| **Esophagus** | Transport to stomach | Message passing from frontend to `send_message_stream` | Built. |
| **Stomach** | Break down into components | `brain_planner.rs` — decompose request into plan steps | Built. |
| **Small intestine** | Absorb nutrients (extract useful data) | Tool execution loop — extract results from tool calls | Built. |
| **Large intestine** | Extract remaining water (last-pass learning) | Post-response learning (16 background tasks: entities, embeddings, facts, etc.) | Built. |
| **Liver** | Detoxification | `self_critique.rs` — filter out bad responses, rebuild | Built. |
| **Pancreas** | Regulate sugar (resource allocation) | `resolve_provider_for_task` — route expensive vs cheap models | Built. |
| **Gut microbiome** | Beneficial bacteria (helpful background processes) | `evolution.rs`, `dream_mode.rs`, `autonomous_research.rs` | Built. |

### Digestive System is actually solid.

---

## The Endocrine System (Hormones — Long-Term Regulation)

| Component | Function | BLADE Module | Status |
|-----------|----------|-------------|--------|
| **Hypothalamus** | Master regulator, homeostasis | `config.rs` — all global settings | Built. |
| **Thyroid** | Metabolic rate | `token_efficient` mode (cheap vs expensive API usage) | Built. |
| **Adrenal glands** | Stress response, urgency | `proactive_engine.rs` urgency escalation, `Priority::Critical` path | Built. |
| **Insulin/Glucagon** | Blood sugar regulation | Rate limiting + fallback chains (balance API spend vs capability) | WEAK. No real-time cost tracking to throttle when spending too fast. |
| **Growth hormone** | Growth and development | `evolution.rs` — discover and install new capabilities | Built. |
| **Melatonin** | Sleep/wake cycle | `dream_mode.rs` idle detection, `health_guardian.rs` break timing | Built. |
| **Cortisol** | Long-term stress adaptation | `decision_gate.rs` per-source threshold drift over time | Built. Thresholds adjust gradually. |
| **Oxytocin** | Social bonding, trust | `people_graph.rs` relationship strength + `autonomy gradient` trust levels | Built. |

---

## The Musculoskeletal System

| Component | Function | BLADE Module | Status |
|-----------|----------|-------------|--------|
| **Bones** | Rigid structure | Database tables (SQLite schema) | Built. ~20 tables. |
| **Joints** | Allow controlled movement between bones | Module interfaces (public function signatures) | WEAK. No formal trait-based interfaces. Modules expose functions but the contract is implicit, not enforced. |
| **Muscles** | Execute movement | `native_tools.rs` (37 tools), `computer_use.rs`, `browser_agent.rs` | Built. |
| **Tendons** | Connect muscles to bones | Tool definitions (input schema → execution → output) | Built. JSON Schema validation in tool loop. |
| **Ligaments** | Connect bones to bones | Module dependencies (what calls what) | Documented in connection-map.md but not enforced. |
| **Cartilage** | Cushioning between joints | Error handling at module boundaries | WEAK. Some modules panic on bad input, some return Result, some silently fail. No consistency. |

### What Musculoskeletal Mapping Reveals

7. **Joints are informal** — The `organ.rs` trait is a step in the right direction, but most module interfaces are just "pub fn with whatever signature." No enforced contracts. When organ.rs calls perception_fusion, the interface is a function name, not a trait. If perception_fusion changes its return type, organ.rs breaks silently.

8. **Cartilage is inconsistent** — Error handling varies wildly: some modules use `Result<T, String>`, some use `Option<T>`, some return defaults on failure, some panic. The boundary between modules is the most fragile point.

---

## The Reproductive System (Creating New Life)

| Component | Function | BLADE Module | Status |
|-----------|----------|-------------|--------|
| **DNA** | Blueprint for new organisms | `dna.rs` — shared knowledge that shapes all behavior | Built. |
| **Mitosis** (cell division) | Create copies of existing cells | Agent spawning (`background_agent.rs`, swarm task creation) | Built. |
| **Meiosis** (genetic recombination) | Combine traits to create new organisms | `evolution.rs` + `tool_forge.rs` — combine existing capabilities into new tools | Built. |
| **Stem cells** | Undifferentiated cells that can become anything | `agent_factory.rs` — create new agents from descriptions | Built. |
| **Embryonic development** | Growth from single cell to organism | MCP server installation + tentacle spawning + organ registration | Built. |

---

## Summary: What the Mapping Reveals

### Critical Issues (Fix Now)

1. **Hippocampus fragmentation** — 7 memory modules don't consolidate. Need a unified memory consolidation pass that runs during idle.

2. **Cerebellum doesn't act** — Patterns are detected but never become reflexes. learning_engine detects "user always does X after Y" but nothing auto-triggers X.

3. **Thalamus doesn't route selectively** — Perception data goes into one big prompt instead of being routed to specific organs that need it.

### Medium Issues (Fix Soon)

4. **No event bus standard** — Three communication patterns (direct calls, events, DB reads) with no consistency.

5. **Parasympathetic underutilized** — Dream mode should consolidate memories, prune stale data, strengthen patterns.

6. **No real-time cost monitoring** — No system-wide view of API spend rate.

### Minor Issues (Noted)

7. **Joints informal** — Module interfaces aren't trait-enforced.

8. **Cartilage inconsistent** — Error handling varies by module.
