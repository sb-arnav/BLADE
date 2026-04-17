/**
 * PERSONA PAGE — View and customize BLADE's personality + user profile.
 * Ported from Omi's PersonaPage.
 *
 * Shows: persona traits, relationship state, communication style,
 * learned preferences, DNA summary, and editable persona file.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PageShell } from "./PageShell";

interface PersonaPageProps {
  onBack: () => void;
}

interface PersonaTrait {
  trait_name: string;
  score: number;
  confidence: number;
  source: string;
}

interface InheritedDna {
  identity: string;
  voice: string;
  trust_level: number;
  current_context: string;
  preferences: string[];
  active_project: string;
}

export function PersonaPage({ onBack }: PersonaPageProps) {
  const [persona, setPersona] = useState("");
  const [traits, setTraits] = useState<PersonaTrait[]>([]);
  const [dna, setDna] = useState<InheritedDna | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<string>("get_persona").then(setPersona).catch(() => null);
    invoke<PersonaTrait[]>("persona_get_traits").then(setTraits).catch(() => null);
    invoke<InheritedDna>("reproductive_get_dna").then(setDna).catch(() => null);
  }, []);

  const startEdit = () => { setEditText(persona); setEditing(true); };
  const cancelEdit = () => { setEditing(false); };
  const saveEdit = async () => {
    setSaving(true);
    try {
      await invoke("set_persona", { content: editText });
      setPersona(editText);
      setEditing(false);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const topTraits = traits
    .filter((t) => t.confidence > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return (
    <PageShell title="Persona" subtitle="BLADE's understanding of you" onBack={onBack}>
      <div className="space-y-5">
        {/* Identity card */}
        <div className="blade-glass p-4 rounded-xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-semibold">Who you are</h2>
            {!editing && (
              <button onClick={startEdit} className="text-[10px] text-[#818cf8] hover:text-[#a78bfa]">edit</button>
            )}
          </div>
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full h-[120px] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.12)] rounded-lg p-3 text-[12px] text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#818cf8] resize-none font-mono"
                placeholder="Tell BLADE who you are..."
              />
              <div className="flex gap-2 justify-end">
                <button onClick={cancelEdit} className="px-3 py-1 text-[10px] text-[rgba(255,255,255,0.5)] hover:text-white">Cancel</button>
                <button onClick={saveEdit} disabled={saving} className="px-3 py-1 text-[10px] bg-[rgba(129,140,248,0.2)] text-[#818cf8] rounded-md hover:bg-[rgba(129,140,248,0.3)]">
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-[rgba(255,255,255,0.6)] whitespace-pre-wrap leading-[1.6]">
              {persona || "No persona set yet. Click edit to tell BLADE who you are."}
            </div>
          )}
        </div>

        {/* Personality traits */}
        {topTraits.length > 0 && (
          <div>
            <h2 className="text-[12px] font-semibold text-[rgba(255,255,255,0.4)] mb-2">Observed Traits</h2>
            <div className="grid grid-cols-2 gap-[6px]">
              {topTraits.map((trait) => (
                <div key={trait.trait_name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium capitalize">{trait.trait_name.replace(/_/g, " ")}</div>
                  </div>
                  <div className="w-[50px] h-[3px] bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-[#818cf8]" style={{ width: `${trait.score * 100}%` }} />
                  </div>
                  <span className="text-[9px] text-[rgba(255,255,255,0.25)] w-[25px] text-right">{(trait.score * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DNA / Voice */}
        {dna && (
          <div className="space-y-3">
            {dna.voice && (
              <div>
                <h2 className="text-[12px] font-semibold text-[rgba(255,255,255,0.4)] mb-1">Communication Style</h2>
                <div className="text-[11px] text-[rgba(255,255,255,0.5)] leading-[1.5] px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)]">
                  {dna.voice}
                </div>
              </div>
            )}

            {dna.preferences.length > 0 && (
              <div>
                <h2 className="text-[12px] font-semibold text-[rgba(255,255,255,0.4)] mb-1">Learned Preferences</h2>
                <div className="space-y-[4px]">
                  {dna.preferences.map((pref, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] text-[rgba(255,255,255,0.5)]">
                      <span className="text-[#818cf8] mt-[1px]">•</span>
                      <span>{pref}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 text-[10px] text-[rgba(255,255,255,0.25)] pt-2 border-t border-[rgba(255,255,255,0.06)]">
              <span>Trust: {(dna.trust_level * 100).toFixed(0)}%</span>
              {dna.active_project && <span>Project: {dna.active_project}</span>}
              {dna.current_context && <span>{dna.current_context.substring(0, 60)}</span>}
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
