import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Doc {
  id: string;
  title: string;
  doc_type: string;
  word_count: number;
  summary: string;
  key_points: string[];
  topics: string[];
  created_at: string;
}

interface StudyNote {
  question: string;
  answer: string;
}

interface QuestionAnswer {
  answer: string;
  relevant_quotes: string[];
  confidence: number;
  docs_used: string[];
}

const DOC_TYPE_COLORS: Record<string, string> = {
  pdf: "bg-red-900/40 text-red-300 border-red-700",
  docx: "bg-blue-900/40 text-blue-300 border-blue-700",
  md: "bg-green-900/40 text-green-300 border-green-700",
  txt: "bg-gray-700/60 text-gray-300 border-gray-600",
  html: "bg-orange-900/40 text-orange-300 border-orange-700",
  epub: "bg-purple-900/40 text-purple-300 border-purple-700",
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

function Accordion({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-700 rounded overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2 flex items-center gap-2 bg-gray-900/60 hover:bg-gray-800/60 transition-colors"
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
          className={`text-gray-500 transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-xs text-gray-200 font-medium">{question}</span>
      </button>
      {open && (
        <div className="px-4 py-3 bg-black border-t border-gray-800">
          <p className="text-xs text-gray-300 leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  );
}

export function DocumentView({ onBack }: { onBack: () => void }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [filteredDocs, setFilteredDocs] = useState<Doc[]>([]);
  const [search, setSearch] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [studyNotes, setStudyNotes] = useState<StudyNote[]>([]);
  const [studyNotesLoading, setStudyNotesLoading] = useState(false);

  // Ingest
  const [filePath, setFilePath] = useState("");
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestError, setIngestError] = useState("");

  // Q&A tab
  const [activeTab, setActiveTab] = useState<"detail" | "qa" | "synthesis">("detail");
  const [question, setQuestion] = useState("");
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [askAllDocs, setAskAllDocs] = useState(true);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaResult, setQaResult] = useState<QuestionAnswer | null>(null);

  // Synthesis
  const [synthQuestion, setSynthQuestion] = useState("");
  const [synthLoading, setSynthLoading] = useState(false);
  const [synthResult, setSynthResult] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    loadDocs();
  }, []);

  useEffect(() => {
    const q = search.toLowerCase();
    setFilteredDocs(docs.filter((d) => d.title.toLowerCase().includes(q) || d.topics.some((t) => t.toLowerCase().includes(q))));
  }, [search, docs]);

  async function loadDocs() {
    try {
      const data = await invoke<Doc[]>("doc_list");
      setDocs(data);
      setFilteredDocs(data);
    } catch {
      // ignore
    }
  }

  async function handleIngest() {
    if (!filePath.trim()) return;
    setIngestLoading(true);
    setIngestError("");
    try {
      const doc = await invoke<Doc>("doc_ingest", { filePath: filePath.trim() });
      setFilePath("");
      loadDocs();
      setSelectedDoc(doc);
      setActiveTab("detail");
    } catch (err: any) {
      setIngestError(typeof err === "string" ? err : "Failed to ingest document.");
    } finally {
      setIngestLoading(false);
    }
  }

  async function handleGenerateStudyNotes() {
    if (!selectedDoc) return;
    setStudyNotesLoading(true);
    try {
      const notes = await invoke<StudyNote[]>("doc_generate_study_notes", { docId: selectedDoc.id });
      setStudyNotes(notes);
    } catch {
      // ignore
    } finally {
      setStudyNotesLoading(false);
    }
  }

  async function handleDelete(docId: string) {
    try {
      await invoke("doc_delete", { docId });
      if (selectedDoc?.id === docId) setSelectedDoc(null);
      setDeleteConfirm(null);
      loadDocs();
    } catch {
      // ignore
    }
  }

  async function handleAsk() {
    if (!question.trim()) return;
    setQaLoading(true);
    setQaResult(null);
    try {
      const docIds = askAllDocs ? docs.map((d) => d.id) : selectedDocIds;
      const res = await invoke<QuestionAnswer>("doc_answer_question", { question, docIds });
      setQaResult(res);
    } catch {
      // ignore
    } finally {
      setQaLoading(false);
    }
  }

  async function handleSynthesis() {
    if (!synthQuestion.trim()) return;
    setSynthLoading(true);
    setSynthResult("");
    try {
      const res = await invoke<string>("doc_cross_synthesis", { question: synthQuestion });
      setSynthResult(res);
    } catch {
      // ignore
    } finally {
      setSynthLoading(false);
    }
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
  }

  const docTypeStyle = (type: string) => {
    const key = type.toLowerCase().replace(".", "");
    return DOC_TYPE_COLORS[key] || "bg-gray-700/60 text-gray-300 border-gray-600";
  };

  return (
    <div className="flex flex-col h-full bg-black text-gray-200 font-mono">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700 bg-black">
        <button onClick={onBack} className="text-gray-500 hover:text-green-400 transition-colors">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-green-400 text-sm font-bold tracking-widest uppercase">Document Library</span>
        <div className="flex-1" />
        <span className="text-xs text-gray-600">{docs.length} docs</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r border-gray-700 flex flex-col overflow-hidden bg-gray-900/30">
          {/* Ingest */}
          <div className="p-2 border-b border-gray-700 space-y-2">
            <div className="flex gap-1">
              <input
                className="flex-1 bg-black border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-green-700"
                placeholder="File path or drag hint..."
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleIngest()}
              />
              <button
                onClick={handleIngest}
                disabled={ingestLoading || !filePath.trim()}
                className="px-2 py-1.5 text-xs bg-green-900/40 border border-green-700 text-green-300 rounded hover:bg-green-800/50 disabled:opacity-40 transition-colors"
              >
                {ingestLoading ? "..." : "+ Add"}
              </button>
            </div>
            {ingestError && <p className="text-xs text-red-400">{ingestError}</p>}
            {ingestLoading && <p className="text-xs text-green-400 animate-pulse">Ingesting document...</p>}
          </div>

          {/* Search */}
          <div className="p-2 border-b border-gray-700">
            <input
              className="w-full bg-black border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-green-700"
              placeholder="Search docs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Doc list */}
          <div className="flex-1 overflow-y-auto">
            {filteredDocs.length === 0 && (
              <p className="text-xs text-gray-600 text-center p-4">No documents yet</p>
            )}
            {filteredDocs.map((d) => (
              <button
                key={d.id}
                onClick={() => { setSelectedDoc(d); setActiveTab("detail"); setStudyNotes([]); }}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${selectedDoc?.id === d.id ? "bg-gray-800/60 border-l-2 border-l-green-600" : ""}`}
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <p className="text-xs text-gray-100 font-semibold leading-tight truncate flex-1">{d.title}</p>
                  <span className={`text-xs px-1 py-0.5 rounded border flex-shrink-0 ${docTypeStyle(d.doc_type)}`}>
                    {d.doc_type}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span>{d.word_count.toLocaleString()} words</span>
                  <span>{formatDate(d.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Main area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-700 bg-black px-4">
            {(["detail", "qa", "synthesis"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-4 py-2 text-xs uppercase tracking-wider border-b-2 transition-colors ${activeTab === t ? "border-green-400 text-green-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
              >
                {t === "detail" ? "Document" : t === "qa" ? "Ask a Question" : "Cross-Doc Synthesis"}
              </button>
            ))}
          </div>

          {/* Detail tab */}
          {activeTab === "detail" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {!selectedDoc ? (
                <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
                  Select a document from the sidebar
                </div>
              ) : (
                <>
                  {/* Doc header */}
                  <div className="border border-gray-700 rounded bg-gray-900/40 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <h2 className="text-sm font-bold text-white leading-tight">{selectedDoc.title}</h2>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded border ${docTypeStyle(selectedDoc.doc_type)}`}>
                            {selectedDoc.doc_type}
                          </span>
                          <span className="text-xs text-gray-500">{selectedDoc.word_count.toLocaleString()} words</span>
                          <span className="text-xs text-gray-600">{formatDate(selectedDoc.created_at)}</span>
                        </div>
                      </div>
                      {deleteConfirm === selectedDoc.id ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleDelete(selectedDoc.id)}
                            className="px-2 py-1 text-xs text-red-400 border border-red-700 rounded hover:bg-red-900/20"
                          >
                            Confirm Delete
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-2 py-1 text-xs text-gray-500 border border-gray-700 rounded"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(selectedDoc.id)}
                          className="text-xs text-gray-600 hover:text-red-400 transition-colors border border-gray-700 px-2 py-1 rounded"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Topics */}
                  {selectedDoc.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedDoc.topics.map((t) => (
                        <span key={t} className="text-xs px-2 py-0.5 bg-gray-800 border border-gray-700 text-gray-300 rounded-full">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Summary */}
                  {selectedDoc.summary && (
                    <div className="border border-gray-700 rounded bg-gray-900/30">
                      <button
                        onClick={() => setSummaryOpen((o) => !o)}
                        className="w-full text-left px-4 py-2 flex items-center gap-2 hover:bg-gray-800/40 transition-colors"
                      >
                        <svg
                          width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
                          className={`text-gray-500 transition-transform ${summaryOpen ? "rotate-90" : ""}`}
                        >
                          <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="text-xs text-gray-400 uppercase tracking-wider">Summary</span>
                      </button>
                      {summaryOpen && (
                        <div className="px-4 pb-4 border-t border-gray-800">
                          <p className="text-xs text-gray-300 leading-relaxed mt-3 whitespace-pre-wrap">{selectedDoc.summary}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Key Points */}
                  {selectedDoc.key_points.length > 0 && (
                    <div className="border border-gray-700 rounded bg-gray-900/30 p-4">
                      <p className="text-xs text-green-400 font-bold uppercase tracking-wider mb-2">Key Points</p>
                      <ul className="space-y-1.5">
                        {selectedDoc.key_points.map((pt, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                            <span className="text-green-600 mt-0.5 flex-shrink-0">•</span>
                            {pt}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Study Notes */}
                  <div className="border border-gray-700 rounded bg-gray-900/30 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-amber-400 font-bold uppercase tracking-wider">Study Notes</p>
                      <button
                        onClick={handleGenerateStudyNotes}
                        disabled={studyNotesLoading}
                        className="px-3 py-1 text-xs bg-amber-900/30 border border-amber-800 text-amber-400 rounded hover:bg-amber-900/50 disabled:opacity-40 transition-colors"
                      >
                        {studyNotesLoading ? "Generating..." : "Generate"}
                      </button>
                    </div>
                    {studyNotes.length > 0 ? (
                      <div className="space-y-2">
                        {studyNotes.map((note, i) => (
                          <Accordion key={i} question={note.question} answer={note.answer} />
                        ))}
                      </div>
                    ) : !studyNotesLoading ? (
                      <p className="text-xs text-gray-600 italic">Generate Q&A study notes from this document.</p>
                    ) : (
                      <p className="text-xs text-amber-400 animate-pulse">Generating study notes...</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Q&A tab */}
          {activeTab === "qa" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="space-y-3 border border-gray-700 rounded bg-gray-900/30 p-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider">Question</label>
                  <textarea
                    className="w-full mt-1 bg-black border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-green-700 resize-none"
                    rows={3}
                    placeholder="Ask anything about your documents..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={askAllDocs}
                      onChange={(e) => setAskAllDocs(e.target.checked)}
                      className="accent-green-500"
                    />
                    <span className="text-xs text-gray-300">Ask All Docs ({docs.length})</span>
                  </label>

                  {!askAllDocs && (
                    <div className="max-h-32 overflow-y-auto border border-gray-700 rounded p-2 space-y-1">
                      {docs.map((d) => (
                        <label key={d.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedDocIds.includes(d.id)}
                            onChange={(e) => {
                              setSelectedDocIds((prev) =>
                                e.target.checked ? [...prev, d.id] : prev.filter((id) => id !== d.id)
                              );
                            }}
                            className="accent-green-500"
                          />
                          <span className="text-xs text-gray-300 truncate">{d.title}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleAsk}
                  disabled={qaLoading || !question.trim() || (!askAllDocs && selectedDocIds.length === 0)}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-green-900/40 border border-green-700 text-green-300 rounded hover:bg-green-800/50 disabled:opacity-40 transition-colors"
                >
                  {qaLoading ? "Searching..." : "Ask"}
                </button>
              </div>

              {qaResult && (
                <div className="space-y-3">
                  {/* Answer */}
                  <div className="border border-green-800 rounded bg-green-900/10 p-4">
                    <p className="text-xs text-green-400 font-bold uppercase tracking-wider mb-2">Answer</p>
                    <p className="text-sm text-gray-100 leading-relaxed whitespace-pre-wrap">{qaResult.answer}</p>
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-1">Confidence</p>
                      <ConfidenceBar value={qaResult.confidence} />
                    </div>
                  </div>

                  {/* Sources */}
                  {qaResult.docs_used.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {qaResult.docs_used.map((d, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 bg-gray-800 border border-gray-700 text-gray-400 rounded">
                          {d}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Quotes */}
                  {qaResult.relevant_quotes.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-500 uppercase tracking-wider">Relevant Quotes</p>
                      {qaResult.relevant_quotes.map((q, i) => (
                        <blockquote key={i} className="border-l-4 border-gray-600 pl-3 py-1 bg-gray-900/30">
                          <p className="text-xs text-gray-300 italic leading-relaxed">{q}</p>
                        </blockquote>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!qaResult && !qaLoading && (
                <div className="text-center py-16 text-gray-600 text-sm">
                  Ask a question to search across your document library.
                </div>
              )}
            </div>
          )}

          {/* Cross-Doc Synthesis tab */}
          {activeTab === "synthesis" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="border border-gray-700 rounded bg-gray-900/30 p-4 space-y-3">
                <p className="text-xs text-gray-400">
                  Synthesize insights across all documents for a complex question.
                </p>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider">Question</label>
                  <textarea
                    className="w-full mt-1 bg-black border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-green-700 resize-none"
                    rows={3}
                    placeholder="What patterns or themes connect these documents?"
                    value={synthQuestion}
                    onChange={(e) => setSynthQuestion(e.target.value)}
                  />
                </div>
                <button
                  onClick={handleSynthesis}
                  disabled={synthLoading || !synthQuestion.trim()}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-purple-900/40 border border-purple-700 text-purple-300 rounded hover:bg-purple-800/50 disabled:opacity-40 transition-colors"
                >
                  {synthLoading ? "Synthesizing..." : "Synthesize"}
                </button>
              </div>

              {synthLoading && (
                <div className="text-xs text-purple-400 animate-pulse flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 inline-block" />
                  Synthesizing across {docs.length} documents...
                </div>
              )}

              {synthResult && (
                <div className="border border-purple-800 rounded bg-purple-900/10 p-4">
                  <p className="text-xs text-purple-400 font-bold uppercase tracking-wider mb-2">Synthesis</p>
                  <p className="text-sm text-gray-100 leading-relaxed whitespace-pre-wrap">{synthResult}</p>
                </div>
              )}

              {!synthResult && !synthLoading && (
                <div className="text-center py-16 text-gray-600 text-sm">
                  Cross-doc synthesis finds connections and patterns across your entire library.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
