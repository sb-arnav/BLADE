import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Inline icon helpers (no lucide-react dependency) ─────────────────────────
type IconProps = { size?: number; className?: string };
const Ic = ({ d, size = 14, className = "" }: { d: string; size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}><path d={d} /></svg>
);
const ArrowLeft     = (p: IconProps) => <Ic size={p.size} className={p.className} d="M19 12H5M5 12l7 7M5 12l7-7" />;
const RefreshCw     = (p: IconProps) => <Ic size={p.size} className={p.className} d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />;
const ChevronDown   = (p: IconProps) => <Ic size={p.size} className={p.className} d="M6 9l6 6 6-6" />;
const ChevronUp     = (p: IconProps) => <Ic size={p.size} className={p.className} d="M18 15l-6-6-6 6" />;
const Sparkles      = (p: IconProps) => <Ic size={p.size} className={p.className} d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />;
const User          = (p: IconProps) => <Ic size={p.size} className={p.className} d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />;
const MessageSquare = (p: IconProps) => <Ic size={p.size} className={p.className} d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />;

// ── Types ─────────────────────────────────────────────────────────────────────

type TraitName = "humor" | "directness" | "energy" | "curiosity" | "frustration_tolerance";

interface PersonaTrait {
  trait_name: TraitName;
  score: number;         // 0–100
  confidence: number;    // 0–100
  evidence: string[];
}

interface RelationshipData {
  intimacy_score: number;        // 0–100
  trust_score: number;           // 0–100
  intimacy_level: string;        // e.g. "Trusted"
  shared_context: string[];
  growth_moments: string[];
}

interface CommunicationPattern {
  pattern_type: string;
  description: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TRAIT_META: Record<TraitName, { label: string; color: string; ring: string; bg: string }> = {
  humor:                 { label: "Humor",               color: "text-purple-400",  ring: "ring-purple-600",  bg: "bg-purple-500" },
  directness:            { label: "Directness",          color: "text-blue-400",    ring: "ring-blue-600",    bg: "bg-blue-500" },
  energy:                { label: "Energy",              color: "text-yellow-400",  ring: "ring-yellow-600",  bg: "bg-yellow-500" },
  curiosity:             { label: "Curiosity",           color: "text-teal-400",    ring: "ring-teal-600",    bg: "bg-teal-500" },
  frustration_tolerance: { label: "Frustration Tol.",   color: "text-red-400",     ring: "ring-red-600",     bg: "bg-red-500" },
};

const INTIMACY_LEVELS: { min: number; label: string; desc: string }[] = [
  { min: 0,  label: "Acquaintance",     desc: "Just getting started" },
  { min: 20, label: "Familiar",         desc: "Building a working relationship" },
  { min: 40, label: "Trusted",          desc: "Consistent, reliable connection" },
  { min: 65, label: "Intimate",         desc: "Deep mutual understanding" },
  { min: 85, label: "Partners-in-crime",desc: "Fully tuned in to each other" },
];

function intimacyLevelFor(score: number) {
  return [...INTIMACY_LEVELS].reverse().find((l) => score >= l.min) ?? INTIMACY_LEVELS[0];
}

// ── SVG Gauge ─────────────────────────────────────────────────────────────────

function CircleGauge({ value, color }: { value: number; color: string }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const filled = (value / 100) * circ;

  return (
    <svg width={130} height={130} className="rotate-[-90deg]">
      <circle cx={65} cy={65} r={r} fill="none" stroke="#1f2937" strokeWidth={10} />
      <circle
        cx={65}
        cy={65}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
    </svg>
  );
}

// ── Trait bar ─────────────────────────────────────────────────────────────────

function TraitBar({
  trait,
  onOverride,
}: {
  trait: PersonaTrait;
  onOverride: (name: TraitName, score: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [localScore, setLocalScore] = useState(trait.score);
  const [overriding, setOverriding] = useState(false);
  const meta = TRAIT_META[trait.trait_name];

  const commitOverride = useCallback(async () => {
    setOverriding(true);
    try {
      await invoke("persona_update_trait", { traitName: trait.trait_name, score: localScore });
      onOverride(trait.trait_name, localScore);
    } catch { /* ignore */ } finally { setOverriding(false); }
  }, [localScore, trait.trait_name, onOverride]);

  return (
    <div className="border border-gray-800 rounded-lg p-3 bg-gray-950 flex flex-col gap-2">
      {/* Header row */}
      <div className="flex items-center gap-3">
        <span className={`font-bold text-xs w-40 ${meta.color}`}>{meta.label}</span>

        {/* Score bar */}
        <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${meta.bg}`}
            style={{ width: `${trait.score}%` }}
          />
        </div>

        <span className={`text-xs font-bold w-8 text-right ${meta.color}`}>{trait.score}</span>

        {/* Confidence */}
        <div className="flex items-center gap-1 w-24">
          <div className="h-1.5 flex-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-1.5 bg-gray-500 rounded-full transition-all duration-500"
              style={{ width: `${trait.confidence}%` }}
            />
          </div>
          <span className="text-2xs text-gray-600 w-8 text-right">{trait.confidence}%</span>
        </div>

        <button
          onClick={() => setExpanded((p) => !p)}
          className="text-gray-600 hover:text-gray-400 transition-colors"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* Expanded: evidence + override slider */}
      {expanded && (
        <div className="flex flex-col gap-2 mt-1 pl-1 border-l border-gray-800">
          {/* Evidence */}
          {trait.evidence.length > 0 && (
            <div>
              <div className="text-2xs text-gray-600 uppercase tracking-widest mb-1">Evidence</div>
              <ul className="flex flex-col gap-0.5">
                {trait.evidence.slice(0, 4).map((e, i) => (
                  <li key={i} className="text-2xs text-gray-400 font-sans leading-relaxed">• {e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Manual override slider */}
          <div>
            <div className="text-2xs text-gray-600 uppercase tracking-widest mb-1">Manual override</div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                value={localScore}
                onChange={(e) => setLocalScore(Number(e.target.value))}
                className="flex-1 accent-green-500"
              />
              <span className={`text-xs font-bold w-8 ${meta.color}`}>{localScore}</span>
              <button
                onClick={commitOverride}
                disabled={overriding || localScore === trait.score}
                className="px-2 py-1 text-2xs border border-green-800 text-green-400 rounded hover:bg-green-900/20 transition-colors disabled:opacity-40"
              >
                {overriding ? "…" : "Set"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PersonaView({ onBack }: { onBack: () => void }) {
  const [traits, setTraits] = useState<PersonaTrait[]>([]);
  const [relationship, setRelationship] = useState<RelationshipData | null>(null);
  const [patterns, setPatterns] = useState<CommunicationPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [t, r, p] = await Promise.all([
        invoke<PersonaTrait[]>("persona_get_traits").catch(() => [] as PersonaTrait[]),
        invoke<RelationshipData>("persona_get_relationship").catch(() => null),
        invoke<CommunicationPattern[]>("persona_get_relationship").catch(() => [] as CommunicationPattern[]),
      ]);
      setTraits(t ?? []);
      setRelationship(r ?? null);
      // patterns may come from a separate call; fall back to empty
      setPatterns(p as unknown as CommunicationPattern[] ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // Separately load communication patterns
  const loadPatterns = useCallback(async () => {
    try {
      // Attempt dedicated command; backend may not exist yet — catch gracefully
      const p = await invoke<CommunicationPattern[]>("persona_get_communication_patterns");
      setPatterns(p ?? []);
    } catch { /* optional */ }
  }, []);

  useEffect(() => {
    loadAll();
    loadPatterns();
  }, [loadAll, loadPatterns]);

  const analyzeNow = useCallback(async () => {
    setAnalyzing(true);
    setNotification(null);
    try {
      await invoke("persona_analyze_now");
      setNotification("Analysis complete — refreshing…");
      await loadAll();
      await loadPatterns();
    } catch (e) {
      setNotification(`Analysis failed: ${String(e)}`);
    } finally {
      setAnalyzing(false);
      setTimeout(() => setNotification(null), 3000);
    }
  }, [loadAll, loadPatterns]);

  const handleTraitOverride = useCallback((name: TraitName, score: number) => {
    setTraits((prev) => prev.map((t) => t.trait_name === name ? { ...t, score } : t));
  }, []);

  // ── Computed ──────────────────────────────────────────────────────────────

  const intimacy = relationship ? intimacyLevelFor(relationship.intimacy_score) : null;
  const gaugeColor = "#22c55e"; // green-500

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-black text-gray-300 font-mono text-xs overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-800 shrink-0">
        <button onClick={onBack} className="text-gray-500 hover:text-green-400 transition-colors">
          <ArrowLeft size={15} />
        </button>
        <User size={14} className="text-green-400" />
        <span className="text-green-400 font-bold tracking-widest uppercase text-xs">Persona Model</span>
        <div className="flex-1" />
        {notification && (
          <span className="text-2xs text-green-400 border border-green-800 bg-green-900/20 px-2 py-0.5 rounded animate-pulse">
            {notification}
          </span>
        )}
        <button
          onClick={analyzeNow}
          disabled={analyzing}
          className="flex items-center gap-1.5 px-3 py-1 border border-green-800 bg-green-900/20 text-green-300 rounded hover:bg-green-800/30 transition-colors text-2xs disabled:opacity-40"
        >
          {analyzing
            ? <><RefreshCw size={12} className="animate-spin" /> Analyzing…</>
            : <><Sparkles size={12} /> Analyze Now</>}
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">

          {/* ── Section 1: Relationship Score ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 bg-green-500 rounded-full" />
              <span className="text-green-400 font-bold uppercase tracking-widest text-2xs">Relationship</span>
            </div>

            {relationship ? (
              <div className="border border-gray-800 rounded-lg p-4 bg-gray-950">
                <div className="flex items-start gap-6">
                  {/* Circle gauge */}
                  <div className="relative shrink-0">
                    <CircleGauge value={relationship.intimacy_score} color={gaugeColor} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-green-400">{relationship.intimacy_score}</span>
                      <span className="text-2xs text-gray-500">intimacy</span>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="flex-1 flex flex-col gap-3">
                    {/* Level badge */}
                    {intimacy && (
                      <div>
                        <div className="text-lg font-bold text-green-300">{intimacy.label}</div>
                        <div className="text-2xs text-gray-500 mt-0.5">{intimacy.desc}</div>
                      </div>
                    )}

                    {/* Trust bar */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-2xs text-gray-500 uppercase tracking-wider">Trust</span>
                        <span className="text-2xs text-blue-400 font-bold">{relationship.trust_score}</span>
                      </div>
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-2 bg-blue-500 rounded-full transition-all duration-700"
                          style={{ width: `${relationship.trust_score}%` }}
                        />
                      </div>
                    </div>

                    {/* Shared context chips */}
                    {relationship.shared_context.length > 0 && (
                      <div>
                        <div className="text-2xs text-gray-500 uppercase tracking-wider mb-1">Shared Context</div>
                        <div className="flex flex-wrap gap-1">
                          {relationship.shared_context.slice(0, 8).map((ctx, i) => (
                            <span key={i} className="text-2xs px-2 py-0.5 border border-gray-700 bg-gray-900 rounded-full text-gray-400">
                              {ctx}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Growth moments */}
                {relationship.growth_moments.length > 0 && (
                  <div className="mt-4 border-t border-gray-800 pt-3">
                    <div className="text-2xs text-gray-500 uppercase tracking-wider mb-2">Growth Moments</div>
                    <ul className="flex flex-col gap-1">
                      {relationship.growth_moments.slice(0, 5).map((m, i) => (
                        <li key={i} className="text-2xs text-gray-400 font-sans leading-relaxed">
                          <span className="text-green-700 mr-1">▸</span>{m}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-gray-600 text-2xs border border-gray-800 rounded p-4">
                No relationship data yet. Chat more to build your profile.
              </div>
            )}
          </section>

          {/* ── Section 2: Personality Traits ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 bg-purple-500 rounded-full" />
              <span className="text-purple-400 font-bold uppercase tracking-widest text-2xs">Personality Traits</span>
              <span className="text-2xs text-gray-600 ml-2">Confidence shown as secondary bar · click to expand</span>
            </div>

            {traits.length === 0 ? (
              <div className="text-gray-600 text-2xs border border-gray-800 rounded p-4">
                No traits analyzed yet. Click "Analyze Now" to build a personality model.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {/* Column headers */}
                <div className="flex items-center gap-3 px-3 text-2xs text-gray-600">
                  <span className="w-40">Trait</span>
                  <span className="flex-1">Score</span>
                  <span className="w-8 text-right">Val</span>
                  <span className="w-24 text-right">Confidence</span>
                  <span className="w-4" />
                </div>
                {traits.map((t) => (
                  <TraitBar key={t.trait_name} trait={t} onOverride={handleTraitOverride} />
                ))}
              </div>
            )}
          </section>

          {/* ── Section 3: Communication Patterns ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 bg-teal-500 rounded-full" />
              <MessageSquare size={12} className="text-teal-400" />
              <span className="text-teal-400 font-bold uppercase tracking-widest text-2xs">Communication Patterns</span>
            </div>

            {patterns.length === 0 ? (
              <div className="text-gray-600 text-2xs border border-gray-800 rounded p-4">
                No communication patterns identified yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {patterns.map((p, i) => (
                  <div key={i} className="border border-gray-800 rounded-lg p-3 bg-gray-950">
                    <div className="text-2xs text-teal-400 font-bold uppercase tracking-wider mb-1">{p.pattern_type}</div>
                    <div className="text-2xs text-gray-400 font-sans leading-relaxed">{p.description}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      )}
    </div>
  );
}
