import React, { useEffect, useState, useRef } from "react";
import { useKeyVault, VaultService } from "../hooks/useKeyVault";

interface Props {
  open: boolean;
  onClose: () => void;
}

type View = "list" | "add" | "export" | "import";

const SERVICES: { id: VaultService; name: string; color: string; icon: React.ReactNode }[] = [
  {
    id: "openai",
    name: "OpenAI",
    color: "#10a37f",
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M22.28 9.37a5.88 5.88 0 00-.51-4.86 5.97 5.97 0 00-6.44-2.87A5.88 5.88 0 0011 0a5.97 5.97 0 00-5.69 4.13A5.88 5.88 0 001.36 7.2a5.97 5.97 0 00.74 7.01 5.88 5.88 0 00.51 4.86 5.97 5.97 0 006.44 2.87A5.88 5.88 0 0013 24a5.97 5.97 0 005.69-4.13 5.88 5.88 0 003.95-3.07 5.97 5.97 0 00-.36-7.43zM13 22.39a4.47 4.47 0 01-2.88-1.05l.14-.08 4.78-2.76a.78.78 0 00.39-.68v-6.73l2.02 1.17a.07.07 0 01.04.05v5.57a4.49 4.49 0 01-4.49 4.51zM3.6 18.27a4.47 4.47 0 01-.54-3.02l.14.09 4.78 2.76a.78.78 0 00.78 0l5.83-3.37v2.33a.07.07 0 01-.03.06l-4.83 2.79a4.49 4.49 0 01-6.13-1.64zM2.34 7.9A4.47 4.47 0 014.7 5.92v5.69a.78.78 0 00.39.68l5.83 3.37-2.02 1.17a.07.07 0 01-.07 0L4 14.04A4.49 4.49 0 012.34 7.9zM19.26 11.9l-5.83-3.37 2.02-1.17a.07.07 0 01.07 0l4.83 2.79a4.49 4.49 0 01-.69 8.1v-5.68a.78.78 0 00-.4-.68zM21.3 8.74l-.14-.09-4.78-2.76a.78.78 0 00-.78 0l-5.83 3.37V6.93a.07.07 0 01.03-.06l4.83-2.79a4.49 4.49 0 016.67 4.66zM8.35 13.42l-2.02-1.17a.07.07 0 01-.04-.05V6.63a4.49 4.49 0 017.37-3.45l-.14.08-4.78 2.76a.78.78 0 00-.39.68v6.73zm1.1-2.36L12 9.49l2.56 1.47v2.96L12 15.4l-2.56-1.47v-2.96z" />
      </svg>
    ),
  },
  {
    id: "anthropic",
    name: "Anthropic",
    color: "#d97706",
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M13.83 2H16.7l5.3 20h-2.87l-1.33-5.24h-6.6L9.87 22H7l5.3-20h1.53zm2.5 12.14L13.99 5.3 11.67 14.14h4.66z" />
      </svg>
    ),
  },
  {
    id: "groq",
    name: "Groq",
    color: "#f55036",
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15H8V7h3v10zm5 0h-3V7h3v10z" />
      </svg>
    ),
  },
  {
    id: "gemini",
    name: "Google Gemini",
    color: "#4285f4",
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    id: "github",
    name: "GitHub",
    color: "#8b5cf6",
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.43 9.8 8.21 11.39.6.11.79-.26.79-.58v-2.23c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.21.08 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016.02 0c2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.19.7.8.58A12.01 12.01 0 0024 12c0-6.63-5.37-12-12-12z" />
      </svg>
    ),
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    color: "#fbbf24",
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-2.5 8a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm5 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm-6.7 3.2a.75.75 0 011.06.06A4.48 4.48 0 0012 15c1.2 0 2.3-.47 3.14-1.24a.75.75 0 011.12 1A5.98 5.98 0 0112 16.5a5.98 5.98 0 01-4.26-1.74.75.75 0 01.06-1.06z" />
      </svg>
    ),
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    color: "#00c8ff",
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <rect x="9" y="3" width="2.5" height="18" rx="1.25" />
        <rect x="13" y="3" width="2.5" height="18" rx="1.25" />
      </svg>
    ),
  },
  {
    id: "deepgram",
    name: "Deepgram",
    color: "#13ef93",
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14a4 4 0 110-8 4 4 0 010 8z" />
      </svg>
    ),
  },
  {
    id: "custom",
    name: "Custom",
    color: "#94a3b8",
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.74 5.74L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.59a1 1 0 01.29-.7l6.97-6.97A6 6 0 0121 9z" />
      </svg>
    ),
  },
];

function getServiceMeta(id: VaultService) {
  return SERVICES.find((s) => s.id === id) || SERVICES[SERVICES.length - 1];
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

// Lock icon SVG used in multiple places
function LockIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

function ShieldIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function StatusDot({ status }: { status: boolean | null }) {
  if (status === null) {
    return (
      <span className="flex items-center gap-1 text-2xs text-blade-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-blade-muted/40" />
        untested
      </span>
    );
  }
  if (status) {
    return (
      <span className="flex items-center gap-1 text-2xs text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        valid
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-2xs text-red-400">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
      invalid
    </span>
  );
}

export default function KeyVault({ open, onClose }: Props) {
  const {
    entries,
    loading,
    addKey,
    removeKey,
    testKey,
    exportVault,
    importVault,
  } = useKeyVault();

  const [view, setView] = useState<View>("list");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Add form state
  const [formService, setFormService] = useState<VaultService>("openai");
  const [formLabel, setFormLabel] = useState("");
  const [formKey, setFormKey] = useState("");
  const [formTesting, setFormTesting] = useState(false);
  const [formTestResult, setFormTestResult] = useState<boolean | null>(null);
  const [formSaving, setFormSaving] = useState(false);

  // Export/import state
  const [passphrase, setPassphrase] = useState("");
  const [exportBlob, setExportBlob] = useState("");
  const [importBlob, setImportBlob] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);

  const keyInputRef = useRef<HTMLInputElement>(null);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setView("list");
      resetForm();
      setPassphrase("");
      setExportBlob("");
      setImportBlob("");
      setImportResult(null);
    }
  }, [open]);

  // Escape key handling
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view !== "list") {
          setView("list");
          resetForm();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, view, onClose]);

  function resetForm() {
    setFormService("openai");
    setFormLabel("");
    setFormKey("");
    setFormTesting(false);
    setFormTestResult(null);
    setFormSaving(false);
  }

  async function handleTestInForm() {
    if (!formKey.trim()) return;
    setFormTesting(true);
    setFormTestResult(null);
    try {
      const r = await testServiceKey(formService, formKey.trim());
      setFormTestResult(r);
    } catch {
      setFormTestResult(false);
    } finally {
      setFormTesting(false);
    }
  }

  async function handleSave() {
    if (!formKey.trim()) return;
    setFormSaving(true);
    try {
      await addKey(formService, formLabel, formKey.trim());
      resetForm();
      setView("list");
    } finally {
      setFormSaving(false);
    }
  }

  async function handleTestEntry(id: string) {
    setTestingId(id);
    try {
      await testKey(id);
    } finally {
      setTestingId(null);
    }
  }

  async function handleRemoveEntry(id: string) {
    setRemovingId(id);
    await removeKey(id);
    setRemovingId(null);
  }

  async function handleExport() {
    if (!passphrase.trim()) return;
    const blob = await exportVault(passphrase.trim());
    setExportBlob(blob);
  }

  async function handleImport() {
    if (!importBlob.trim() || !passphrase.trim()) return;
    try {
      const count = await importVault(importBlob.trim(), passphrase.trim());
      setImportResult(`Successfully imported ${count} key${count !== 1 ? "s" : ""}.`);
      setImportBlob("");
    } catch {
      setImportResult("Failed to import. Check your passphrase and data.");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] bg-blade-surface border border-blade-border rounded-2xl shadow-2xl overflow-hidden animate-fade-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-2">
            {view !== "list" && (
              <button
                onClick={() => {
                  setView("list");
                  resetForm();
                }}
                className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <div className="flex items-center gap-1.5 text-blade-accent">
              <LockIcon className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-semibold text-blade-text">
              {view === "list" && "API Key Vault"}
              {view === "add" && "Add API Key"}
              {view === "export" && "Export Keys"}
              {view === "import" && "Import Keys"}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            {view === "list" && (
              <>
                <button
                  onClick={() => setView("import")}
                  className="text-2xs px-2 py-1 rounded-md text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors font-medium"
                >
                  Import
                </button>
                <button
                  onClick={() => setView("export")}
                  className="text-2xs px-2 py-1 rounded-md text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors font-medium"
                >
                  Export
                </button>
                <button
                  onClick={() => {
                    resetForm();
                    setView("add");
                  }}
                  className="text-2xs px-2.5 py-1 rounded-md bg-blade-accent-muted text-blade-accent hover:bg-blade-accent/20 transition-colors font-medium"
                >
                  + Add Key
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Security banner */}
        <div className="mx-5 mb-2 px-3 py-2 rounded-lg bg-blade-accent/5 border border-blade-accent/15 flex items-center gap-2 shrink-0">
          <ShieldIcon className="w-3.5 h-3.5 text-blade-accent shrink-0" />
          <p className="text-2xs text-blade-muted leading-snug">
            Keys are stored securely in your local database, never in browser storage or plain files.
          </p>
        </div>

        {/* === LIST VIEW === */}
        {view === "list" && (
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-blade-muted">
                <span className="text-xs">Loading vault...</span>
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-blade-muted">
                <LockIcon className="w-8 h-8 mb-3 opacity-30" />
                <p className="text-xs mb-1">No API keys stored</p>
                <p className="text-2xs text-blade-muted/60">
                  Add your first key to get started with Blade providers.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {entries.map((entry) => {
                  const meta = getServiceMeta(entry.service);
                  const isTesting = testingId === entry.id;
                  const isRemoving = removingId === entry.id;
                  return (
                    <div
                      key={entry.id}
                      className="group flex items-center gap-3 p-3 rounded-xl border border-blade-border hover:border-blade-accent/20 bg-blade-bg/50 hover:bg-blade-bg transition-all"
                    >
                      {/* Service icon */}
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: meta.color + "18", color: meta.color }}
                      >
                        {meta.icon}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-blade-text truncate">
                            {entry.label}
                          </span>
                          <span className="text-2xs text-blade-muted/60 shrink-0">
                            {meta.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <code className="text-2xs text-blade-muted font-mono">
                            {entry.keyPreview}
                          </code>
                          <StatusDot status={entry.isValid} />
                          {entry.lastUsed && (
                            <span className="text-2xs text-blade-muted/50">
                              used {timeAgo(entry.lastUsed)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => handleTestEntry(entry.id)}
                          disabled={isTesting}
                          className="px-2 py-1 rounded-md text-2xs text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors disabled:opacity-40"
                          title="Test key"
                        >
                          {isTesting ? (
                            <span className="animate-pulse">Testing...</span>
                          ) : (
                            "Test"
                          )}
                        </button>
                        <button
                          onClick={() => handleRemoveEntry(entry.id)}
                          disabled={isRemoving}
                          className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40"
                          title="Remove key"
                        >
                          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* === ADD KEY VIEW === */}
        {view === "add" && (
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            <div className="space-y-4">
              {/* Service selector */}
              <div>
                <label className="block text-2xs text-blade-muted mb-1.5 font-medium uppercase tracking-wider">
                  Service
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {SERVICES.map((svc) => (
                    <button
                      key={svc.id}
                      onClick={() => setFormService(svc.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all ${
                        formService === svc.id
                          ? "border-blade-accent/40 bg-blade-accent/5"
                          : "border-blade-border hover:border-blade-accent/20 bg-blade-bg/50 hover:bg-blade-bg"
                      }`}
                    >
                      <span style={{ color: svc.color }}>{svc.icon}</span>
                      <span className="text-2xs text-blade-text font-medium truncate">
                        {svc.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Label */}
              <div>
                <label className="block text-2xs text-blade-muted mb-1 font-medium uppercase tracking-wider">
                  Label
                </label>
                <input
                  type="text"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  placeholder={`e.g. Personal, Work, ${getServiceMeta(formService).name} key`}
                  className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors"
                />
              </div>

              {/* Key input */}
              <div>
                <label className="block text-2xs text-blade-muted mb-1 font-medium uppercase tracking-wider">
                  API Key
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-blade-muted/50">
                    <LockIcon className="w-3 h-3" />
                  </div>
                  <input
                    ref={keyInputRef}
                    type="password"
                    value={formKey}
                    onChange={(e) => {
                      setFormKey(e.target.value);
                      setFormTestResult(null);
                    }}
                    placeholder="sk-... or paste your key"
                    className="w-full bg-blade-bg border border-blade-border rounded-lg pl-8 pr-3 py-2 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors font-mono"
                    autoFocus
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                  />
                </div>
              </div>

              {/* Test result */}
              {formTestResult !== null && (
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-2xs ${
                    formTestResult
                      ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                      : "bg-red-500/10 border border-red-500/20 text-red-400"
                  }`}
                >
                  {formTestResult ? (
                    <>
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      Key is valid and working.
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                      Key validation failed. Check the key and try again.
                    </>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={handleTestInForm}
                  disabled={!formKey.trim() || formTesting}
                  className="text-xs px-3 py-1.5 rounded-lg border border-blade-border text-blade-muted hover:text-blade-secondary hover:border-blade-accent/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {formTesting ? (
                    <span className="animate-pulse">Testing...</span>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Test Key
                    </>
                  )}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      resetForm();
                      setView("list");
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!formKey.trim() || formSaving}
                    className="text-xs px-4 py-1.5 rounded-lg bg-blade-accent text-white font-medium hover:bg-blade-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    <LockIcon className="w-3 h-3" />
                    {formSaving ? "Saving..." : "Save Key"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* === EXPORT VIEW === */}
        {view === "export" && (
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            <div className="space-y-4">
              <p className="text-2xs text-blade-muted leading-relaxed">
                Export all stored keys as an encrypted blob. You can import this on another machine.
                The passphrase is used to encrypt and decrypt the data.
              </p>

              <div>
                <label className="block text-2xs text-blade-muted mb-1 font-medium uppercase tracking-wider">
                  Passphrase
                </label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter a strong passphrase..."
                  className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors"
                  autoFocus
                />
              </div>

              <button
                onClick={handleExport}
                disabled={!passphrase.trim() || entries.length === 0}
                className="text-xs px-4 py-1.5 rounded-lg bg-blade-accent text-white font-medium hover:bg-blade-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Encrypt & Export ({entries.length} key{entries.length !== 1 ? "s" : ""})
              </button>

              {exportBlob && (
                <div>
                  <label className="block text-2xs text-blade-muted mb-1">Encrypted Data</label>
                  <textarea
                    value={exportBlob}
                    readOnly
                    rows={5}
                    className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-2xs text-blade-text font-mono outline-none resize-none select-all"
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(exportBlob);
                    }}
                    className="mt-1.5 text-2xs px-2.5 py-1 rounded-md text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
                  >
                    Copy to clipboard
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* === IMPORT VIEW === */}
        {view === "import" && (
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            <div className="space-y-4">
              <p className="text-2xs text-blade-muted leading-relaxed">
                Paste an encrypted key export blob and enter the passphrase used during export.
                Imported keys will be added alongside existing ones.
              </p>

              <div>
                <label className="block text-2xs text-blade-muted mb-1 font-medium uppercase tracking-wider">
                  Passphrase
                </label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter the export passphrase..."
                  className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-2xs text-blade-muted mb-1 font-medium uppercase tracking-wider">
                  Encrypted Data
                </label>
                <textarea
                  value={importBlob}
                  onChange={(e) => setImportBlob(e.target.value)}
                  rows={5}
                  placeholder="Paste encrypted blob here..."
                  className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-2xs text-blade-text font-mono outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors resize-none"
                />
              </div>

              {importResult && (
                <div
                  className={`px-3 py-2 rounded-lg text-2xs ${
                    importResult.startsWith("Successfully")
                      ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                      : "bg-red-500/10 border border-red-500/20 text-red-400"
                  }`}
                >
                  {importResult}
                </div>
              )}

              <button
                onClick={handleImport}
                disabled={!importBlob.trim() || !passphrase.trim()}
                className="text-xs px-4 py-1.5 rounded-lg bg-blade-accent text-white font-medium hover:bg-blade-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <ShieldIcon className="w-3 h-3" />
                Decrypt & Import
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Inline key tester for the add-key form (mirrors logic in useKeyVault) */
async function testServiceKey(service: VaultService, key: string): Promise<boolean> {
  try {
    switch (service) {
      case "openai": {
        const r = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
        });
        return r.ok;
      }
      case "anthropic": {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        return r.status !== 401 && r.status !== 403;
      }
      case "groq": {
        const r = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
        });
        return r.ok;
      }
      case "gemini": {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
        );
        return r.ok;
      }
      case "github": {
        const r = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${key}` },
        });
        return r.ok;
      }
      case "huggingface": {
        const r = await fetch("https://huggingface.co/api/whoami-v2", {
          headers: { Authorization: `Bearer ${key}` },
        });
        return r.ok;
      }
      case "elevenlabs": {
        const r = await fetch("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": key },
        });
        return r.ok;
      }
      case "deepgram": {
        const r = await fetch("https://api.deepgram.com/v1/projects", {
          headers: { Authorization: `Token ${key}` },
        });
        return r.ok;
      }
      default:
        return true;
    }
  } catch {
    return false;
  }
}
