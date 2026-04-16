import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Contact {
  id: string;
  name: string;
  relationship_type: string;
  strength: number;
  last_interaction?: string;
  interaction_count: number;
  traits: string[];
  interests: string[];
  communication_style: string;
  notes: string;
}

interface Interaction {
  id: string;
  contact_id: string;
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  topics: string[];
  action_items: string[];
  created_at: string;
}

interface Insight {
  id: string;
  type: string;
  contact_id?: string;
  contact_name?: string;
  content: string;
  suggested_action: string;
}

interface ApproachAdvice {
  advice: string;
  tips: string[];
  cautions: string[];
}

const RELATIONSHIP_COLORS: Record<string, string> = {
  friend: "bg-blue-900/40 text-blue-300 border-blue-700",
  family: "bg-purple-900/40 text-purple-300 border-purple-700",
  colleague: "bg-green-900/40 text-green-300 border-green-700",
  mentor: "bg-amber-900/40 text-amber-300 border-amber-700",
  client: "bg-cyan-900/40 text-cyan-300 border-cyan-700",
  acquaintance: "bg-[rgba(255,255,255,0.07)]/60 text-[rgba(255,255,255,0.7)] border-[rgba(255,255,255,0.15)]",
};

const INSIGHT_COLORS: Record<string, string> = {
  reconnect: "bg-blue-900/30 border-blue-700 text-blue-300",
  follow_up: "bg-amber-900/30 border-amber-700 text-amber-300",
  nurture: "bg-green-900/30 border-green-700 text-green-300",
  warning: "bg-red-900/30 border-red-700 text-red-300",
};

const SENTIMENT_EMOJI: Record<string, string> = {
  positive: "😊",
  neutral: "😐",
  negative: "😕",
};

function relativeTime(dateStr?: string): string {
  if (!dateStr) return "never";
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function StrengthCircle({ value }: { value: number }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const color = value >= 70 ? "#22c55e" : value >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r={r} fill="none" stroke="#1f2937" strokeWidth="4" />
      <circle
        cx="28" cy="28" r={r} fill="none"
        stroke={color} strokeWidth="4"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - pct)}
        strokeLinecap="round"
        transform="rotate(-90 28 28)"
      />
      <text x="28" y="33" textAnchor="middle" fontSize="11" fill={color} fontFamily="monospace" fontWeight="bold">
        {value}%
      </text>
    </svg>
  );
}

export function SocialGraphView({ onBack }: { onBack: () => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [approachGoal, setApproachGoal] = useState("");
  const [approachAdvice, setApproachAdvice] = useState<ApproachAdvice | null>(null);
  const [approachLoading, setApproachLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // Add contact form
  const [newName, setNewName] = useState("");
  const [newRelType, setNewRelType] = useState("friend");
  const [newNotes, setNewNotes] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  // Log interaction form
  const [logSummary, setLogSummary] = useState("");
  const [logSentiment, setLogSentiment] = useState<"positive" | "neutral" | "negative">("neutral");
  const [logTopics, setLogTopics] = useState("");
  const [logActions, setLogActions] = useState("");
  const [logLoading, setLogLoading] = useState(false);

  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");

  useEffect(() => {
    loadContacts();
    loadInsights();
  }, []);

  useEffect(() => {
    const q = search.toLowerCase();
    setFilteredContacts(contacts.filter((c) => c.name.toLowerCase().includes(q)));
  }, [search, contacts]);

  useEffect(() => {
    if (selectedContact) {
      loadInteractions(selectedContact.id);
      setNotesValue(selectedContact.notes || "");
    }
  }, [selectedContact]);

  async function loadContacts() {
    try {
      const data = await invoke<Contact[]>("social_list_contacts");
      setContacts(data);
      setFilteredContacts(data);
    } catch {
      // ignore
    }
  }

  async function loadInteractions(contactId: string) {
    try {
      const data = await invoke<Interaction[]>("social_get_interactions", { contactId });
      setInteractions(data);
    } catch {
      // ignore
    }
  }

  async function loadInsights() {
    setInsightsLoading(true);
    try {
      const data = await invoke<Insight[]>("social_get_insights");
      setInsights(data);
    } catch {
      // ignore
    } finally {
      setInsightsLoading(false);
    }
  }

  async function handleAddContact() {
    if (!newName.trim()) return;
    setAddLoading(true);
    try {
      await invoke("social_add_contact", {
        name: newName,
        relationshipType: newRelType,
        notes: newNotes,
      });
      setShowAddModal(false);
      setNewName("");
      setNewRelType("friend");
      setNewNotes("");
      loadContacts();
    } catch {
      // ignore
    } finally {
      setAddLoading(false);
    }
  }

  async function handleGetApproach() {
    if (!selectedContact || !approachGoal.trim()) return;
    setApproachLoading(true);
    setApproachAdvice(null);
    try {
      const res = await invoke<ApproachAdvice>("social_how_to_approach", {
        contactId: selectedContact.id,
        goal: approachGoal,
      });
      setApproachAdvice(res);
    } catch {
      // ignore
    } finally {
      setApproachLoading(false);
    }
  }

  async function handleLogInteraction() {
    if (!selectedContact || !logSummary.trim()) return;
    setLogLoading(true);
    try {
      await invoke("social_log_interaction", {
        contactId: selectedContact.id,
        summary: logSummary,
        sentiment: logSentiment,
        topics: logTopics.split(",").map((t) => t.trim()).filter(Boolean),
        actionItems: logActions.split(",").map((t) => t.trim()).filter(Boolean),
      });
      setShowLogModal(false);
      setLogSummary("");
      setLogSentiment("neutral");
      setLogTopics("");
      setLogActions("");
      loadInteractions(selectedContact.id);
      loadContacts();
    } catch {
      // ignore
    } finally {
      setLogLoading(false);
    }
  }

  async function handleSaveNotes() {
    if (!selectedContact) return;
    try {
      await invoke("social_update_notes", { contactId: selectedContact.id, notes: notesValue });
      setSelectedContact({ ...selectedContact, notes: notesValue });
      setEditingNotes(false);
    } catch {
      // ignore
    }
  }

  const relTypeStyle = (rel: string) =>
    RELATIONSHIP_COLORS[rel] || "bg-[rgba(255,255,255,0.07)]/60 text-[rgba(255,255,255,0.7)] border-[rgba(255,255,255,0.15)]";

  return (
    <div className="flex flex-col h-full bg-black text-[rgba(255,255,255,0.85)] font-mono">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[rgba(255,255,255,0.1)] bg-black">
        <button onClick={onBack} className="text-[rgba(255,255,255,0.4)] hover:text-green-400 transition-colors">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-green-400 text-sm font-bold tracking-widest uppercase">Social Graph</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowAddModal(true)}
          className="text-xs font-bold px-3 py-1 bg-green-900/40 border border-green-700 text-green-300 rounded hover:bg-green-800/50 transition-colors"
        >
          + Add Contact
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Contact list sidebar */}
        <div className="w-64 border-r border-[rgba(255,255,255,0.1)] flex flex-col overflow-hidden bg-[#09090b]/30">
          <div className="p-2 border-b border-[rgba(255,255,255,0.1)]">
            <input
              className="w-full bg-black border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-xs text-[rgba(255,255,255,0.85)] placeholder-gray-600 focus:outline-none focus:border-green-700"
              placeholder="Search contacts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredContacts.length === 0 && (
              <p className="text-xs text-[rgba(255,255,255,0.3)] text-center p-4">No contacts yet</p>
            )}
            {filteredContacts.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedContact(c)}
                className={`w-full text-left px-3 py-2.5 border-b border-[rgba(255,255,255,0.07)] hover:bg-[rgba(255,255,255,0.04)]/50 transition-colors ${selectedContact?.id === c.id ? "bg-[rgba(255,255,255,0.04)]/60 border-l-2 border-l-green-600" : ""}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-white font-semibold truncate">{c.name}</span>
                  <span className="text-xs text-[rgba(255,255,255,0.3)]">{relativeTime(c.last_interaction)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${relTypeStyle(c.relationship_type)}`}>
                    {c.relationship_type}
                  </span>
                </div>
                <div className="mt-1 h-1 bg-[rgba(255,255,255,0.04)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-600 transition-all"
                    style={{ width: `${c.strength}%` }}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Detail + Insights */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedContact ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Contact header */}
              <div className="flex items-start gap-4 border border-[rgba(255,255,255,0.1)] rounded bg-[#09090b]/40 p-4">
                <StrengthCircle value={selectedContact.strength} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-bold text-white">{selectedContact.name}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded border ${relTypeStyle(selectedContact.relationship_type)}`}>
                      {selectedContact.relationship_type}
                    </span>
                  </div>
                  <p className="text-xs text-[rgba(255,255,255,0.4)] mt-1">{selectedContact.interaction_count} interactions logged</p>
                  {selectedContact.communication_style && (
                    <span className="mt-1 inline-block text-xs px-2 py-0.5 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.15)] text-[rgba(255,255,255,0.7)] rounded">
                      {selectedContact.communication_style}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowLogModal(true)}
                    className="text-xs px-3 py-1 bg-blue-900/40 border border-blue-700 text-blue-300 rounded hover:bg-blue-800/50 transition-colors"
                  >
                    Log Interaction
                  </button>
                </div>
              </div>

              {/* Traits + Interests */}
              {(selectedContact.traits.length > 0 || selectedContact.interests.length > 0) && (
                <div className="border border-[rgba(255,255,255,0.1)] rounded bg-[#09090b]/30 p-3 space-y-2">
                  {selectedContact.traits.length > 0 && (
                    <div>
                      <p className="text-xs text-[rgba(255,255,255,0.4)] uppercase tracking-wider mb-1">Traits</p>
                      <div className="flex flex-wrap gap-1">
                        {selectedContact.traits.map((t) => (
                          <span key={t} className="text-xs px-2 py-0.5 bg-purple-900/30 border border-purple-800 text-purple-300 rounded">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedContact.interests.length > 0 && (
                    <div>
                      <p className="text-xs text-[rgba(255,255,255,0.4)] uppercase tracking-wider mb-1">Interests</p>
                      <div className="flex flex-wrap gap-1">
                        {selectedContact.interests.map((i) => (
                          <span key={i} className="text-xs px-2 py-0.5 bg-cyan-900/30 border border-cyan-800 text-cyan-300 rounded">
                            {i}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div className="border border-[rgba(255,255,255,0.1)] rounded bg-[#09090b]/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-[rgba(255,255,255,0.4)] uppercase tracking-wider">Notes</p>
                  {!editingNotes ? (
                    <button onClick={() => setEditingNotes(true)} className="text-xs text-[rgba(255,255,255,0.4)] hover:text-green-400 transition-colors">
                      Edit
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={handleSaveNotes} className="text-xs text-green-400 hover:text-green-300">Save</button>
                      <button onClick={() => { setEditingNotes(false); setNotesValue(selectedContact.notes || ""); }} className="text-xs text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)]">Cancel</button>
                    </div>
                  )}
                </div>
                {editingNotes ? (
                  <textarea
                    className="w-full bg-black border border-[rgba(255,255,255,0.1)] rounded px-2 py-2 text-xs text-[rgba(255,255,255,0.85)] focus:outline-none focus:border-green-700 resize-none"
                    rows={4}
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    onBlur={handleSaveNotes}
                  />
                ) : (
                  <p className="text-xs text-[rgba(255,255,255,0.5)] whitespace-pre-wrap">{selectedContact.notes || "No notes yet."}</p>
                )}
              </div>

              {/* How to Approach */}
              <div className="border border-[rgba(255,255,255,0.1)] rounded bg-[#09090b]/30 p-3 space-y-2">
                <p className="text-xs text-[rgba(255,255,255,0.4)] uppercase tracking-wider">How to Approach</p>
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-xs text-[rgba(255,255,255,0.85)] placeholder-gray-600 focus:outline-none focus:border-green-700"
                    placeholder="What's your goal with this person?"
                    value={approachGoal}
                    onChange={(e) => setApproachGoal(e.target.value)}
                  />
                  <button
                    onClick={handleGetApproach}
                    disabled={approachLoading || !approachGoal.trim()}
                    className="px-3 py-1 text-xs bg-amber-900/40 border border-amber-700 text-amber-300 rounded hover:bg-amber-800/50 disabled:opacity-40 transition-colors"
                  >
                    {approachLoading ? "..." : "Advise"}
                  </button>
                </div>
                {approachAdvice && (
                  <div className="bg-black border border-amber-800/40 rounded p-3 space-y-2">
                    <p className="text-xs text-[rgba(255,255,255,0.85)]">{approachAdvice.advice}</p>
                    {approachAdvice.tips.length > 0 && (
                      <div>
                        <p className="text-xs text-green-500 font-bold mb-1">Tips</p>
                        <ul className="space-y-0.5">
                          {approachAdvice.tips.map((t, i) => (
                            <li key={i} className="text-xs text-[rgba(255,255,255,0.7)] flex gap-1"><span className="text-green-600">+</span>{t}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {approachAdvice.cautions.length > 0 && (
                      <div>
                        <p className="text-xs text-red-500 font-bold mb-1">Cautions</p>
                        <ul className="space-y-0.5">
                          {approachAdvice.cautions.map((c, i) => (
                            <li key={i} className="text-xs text-[rgba(255,255,255,0.7)] flex gap-1"><span className="text-red-600">!</span>{c}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Interaction history */}
              <div className="border border-[rgba(255,255,255,0.1)] rounded bg-[#09090b]/30 p-3">
                <p className="text-xs text-[rgba(255,255,255,0.4)] uppercase tracking-wider mb-3">Interaction History</p>
                {interactions.length === 0 && (
                  <p className="text-xs text-[rgba(255,255,255,0.3)] italic">No interactions logged yet.</p>
                )}
                <div className="space-y-3">
                  {interactions.map((ia) => (
                    <div key={ia.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className="text-base">{SENTIMENT_EMOJI[ia.sentiment] || "😐"}</span>
                        <div className="flex-1 w-px bg-[rgba(255,255,255,0.07)] mt-1" />
                      </div>
                      <div className="flex-1 pb-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-[rgba(255,255,255,0.5)]">{relativeTime(ia.created_at)}</span>
                        </div>
                        <p className="text-xs text-[rgba(255,255,255,0.85)]">{ia.summary}</p>
                        {ia.topics.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {ia.topics.map((t) => (
                              <span key={t} className="text-xs px-1.5 py-0.5 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] rounded">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        {ia.action_items.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {ia.action_items.map((a, i) => (
                              <p key={i} className="text-xs text-amber-400 flex gap-1"><span>-</span>{a}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[rgba(255,255,255,0.3)] text-sm">Select a contact to view details</p>
            </div>
          )}

          {/* Insights panel */}
          <div className="border-t border-[rgba(255,255,255,0.1)] bg-[#09090b]/20 p-3">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs text-[rgba(255,255,255,0.4)] uppercase tracking-wider">Relationship Insights</p>
              <button
                onClick={loadInsights}
                disabled={insightsLoading}
                className="text-xs text-[rgba(255,255,255,0.3)] hover:text-green-400 transition-colors"
              >
                {insightsLoading ? "..." : "Refresh"}
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {insights.length === 0 && !insightsLoading && (
                <p className="text-xs text-[rgba(255,255,255,0.3)] italic">No insights yet</p>
              )}
              {insights.map((ins) => (
                <div
                  key={ins.id}
                  className={`min-w-48 border rounded p-2 flex-shrink-0 ${INSIGHT_COLORS[ins.type] || "bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.15)] text-[rgba(255,255,255,0.7)]"}`}
                >
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-xs font-bold uppercase">{ins.type}</span>
                    {ins.contact_name && <span className="text-xs opacity-60">• {ins.contact_name}</span>}
                  </div>
                  <p className="text-xs opacity-90">{ins.content}</p>
                  <p className="text-xs opacity-60 mt-1 italic">{ins.suggested_action}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Add Contact Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#09090b] border border-[rgba(255,255,255,0.1)] rounded-lg p-6 w-96 space-y-4">
            <h3 className="text-sm font-bold text-green-400 uppercase tracking-widest">Add Contact</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.4)]">Name</label>
                <input
                  className="w-full mt-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-green-700"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.4)]">Relationship Type</label>
                <select
                  className="w-full mt-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-green-700"
                  value={newRelType}
                  onChange={(e) => setNewRelType(e.target.value)}
                >
                  {["friend", "family", "colleague", "mentor", "client", "acquaintance"].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.4)]">Notes</label>
                <textarea
                  className="w-full mt-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-3 py-2 text-xs text-[rgba(255,255,255,0.7)] focus:outline-none focus:border-green-700 resize-none"
                  rows={3}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-xs text-[rgba(255,255,255,0.5)] border border-[rgba(255,255,255,0.1)] rounded hover:text-[rgba(255,255,255,0.85)] transition-colors">
                Cancel
              </button>
              <button
                onClick={handleAddContact}
                disabled={addLoading || !newName.trim()}
                className="px-4 py-2 text-xs font-bold bg-green-900/40 border border-green-700 text-green-300 rounded hover:bg-green-800/50 disabled:opacity-40 transition-colors"
              >
                {addLoading ? "Adding..." : "Add Contact"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log Interaction Modal */}
      {showLogModal && selectedContact && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#09090b] border border-[rgba(255,255,255,0.1)] rounded-lg p-6 w-96 space-y-4">
            <h3 className="text-sm font-bold text-blue-400 uppercase tracking-widest">
              Log Interaction — {selectedContact.name}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.4)]">Summary</label>
                <textarea
                  className="w-full mt-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-3 py-2 text-xs text-[rgba(255,255,255,0.85)] focus:outline-none focus:border-blue-700 resize-none"
                  rows={3}
                  value={logSummary}
                  onChange={(e) => setLogSummary(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.4)]">Sentiment</label>
                <div className="flex gap-2 mt-1">
                  {(["positive", "neutral", "negative"] as const).map((s) => (
                    <label key={s} className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="sentiment"
                        value={s}
                        checked={logSentiment === s}
                        onChange={() => setLogSentiment(s)}
                        className="accent-green-500"
                      />
                      <span className="text-xs text-[rgba(255,255,255,0.7)]">{SENTIMENT_EMOJI[s]} {s}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.4)]">Topics (comma-separated)</label>
                <input
                  className="w-full mt-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-3 py-1.5 text-xs text-[rgba(255,255,255,0.85)] focus:outline-none focus:border-blue-700"
                  value={logTopics}
                  onChange={(e) => setLogTopics(e.target.value)}
                  placeholder="work, plans, project..."
                />
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.4)]">Action Items (comma-separated)</label>
                <input
                  className="w-full mt-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-3 py-1.5 text-xs text-[rgba(255,255,255,0.85)] focus:outline-none focus:border-blue-700"
                  value={logActions}
                  onChange={(e) => setLogActions(e.target.value)}
                  placeholder="follow up Friday, send link..."
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowLogModal(false)} className="px-4 py-2 text-xs text-[rgba(255,255,255,0.5)] border border-[rgba(255,255,255,0.1)] rounded hover:text-[rgba(255,255,255,0.85)] transition-colors">
                Cancel
              </button>
              <button
                onClick={handleLogInteraction}
                disabled={logLoading || !logSummary.trim()}
                className="px-4 py-2 text-xs font-bold bg-blue-900/40 border border-blue-700 text-blue-300 rounded hover:bg-blue-800/50 disabled:opacity-40 transition-colors"
              >
                {logLoading ? "Logging..." : "Log It"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
