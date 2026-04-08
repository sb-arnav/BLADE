import { useCallback, useRef, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { ChatWindow } from "./components/ChatWindow";
import { CommandPalette } from "./components/CommandPalette";
import { Diagnostics } from "./components/Diagnostics";
import { Discovery } from "./components/Discovery";
import { Onboarding } from "./components/Onboarding";
import { Settings } from "./components/Settings";
import ShortcutHelp from "./components/ShortcutHelp";
import { TitleBar } from "./components/TitleBar";
import { useChat } from "./hooks/useChat";
import { useTTS } from "./hooks/useTTS";
import { useKeyboard } from "./hooks/useKeyboard";
import { useNotificationSound } from "./hooks/useNotificationSound";
import { useStats } from "./hooks/useStats";
import { useFileDrop } from "./hooks/useFileDrop";
import { copyConversation } from "./utils/exportConversation";
import { BladeConfig } from "./types";

type Route = "chat" | "settings" | "discovery" | "diagnostics";

export default function App() {
  const [config, setConfig] = useState<BladeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<Route>("chat");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const chat = useChat();
  const tts = useTTS(chat.messages, chat.loading);
  const sound = useNotificationSound(chat.loading);
  const { stats, recordMessage } = useStats();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleImageDrop = useCallback((dataUrl: string) => {
    // dataUrl is "data:image/png;base64,..." — extract the base64 part
    const base64 = dataUrl.split(",")[1];
    if (base64) sendWithStats("Analyze this image", base64);
  }, []);

  const handleTextDrop = useCallback((text: string) => {
    const preview = text.length > 2000 ? text.slice(0, 2000) + "\n...[truncated]" : text;
    sendWithStats(`Analyze this file:\n\n\`\`\`\n${preview}\n\`\`\``);
  }, []);

  const { isDragging } = useFileDrop(handleImageDrop, handleTextDrop);

  const loadConfig = async () => {
    try {
      const debug = await invoke("debug_config");
      console.log("[Blade] Config debug:", debug);
      const cfg = await invoke<BladeConfig>("get_config");
      console.log("[Blade] Config loaded:", { onboarded: cfg.onboarded, provider: cfg.provider, hasKey: !!cfg.api_key });
      setConfig(cfg);
    } catch {
      setConfig({
        provider: "",
        api_key: "",
        model: "",
        onboarded: false,
        mcp_servers: [],
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadConfig();
  }, []);

  // Auto-focus input when window becomes visible (Alt+Space)
  useEffect(() => {
    const unlisten = listen("tauri://focus", () => {
      setTimeout(() => inputRef.current?.focus(), 50);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const hideWindow = useCallback(() => {
    getCurrentWindow().hide();
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const sendWithStats = useCallback((content: string, imageBase64?: string) => {
    recordMessage();
    chat.sendMessage(content, imageBase64);
  }, [chat.sendMessage, recordMessage]);

  const handleScreenshot = async () => {
    try {
      const png = await invoke<string>("capture_screen");
      chat.sendMessage("What's on my screen?", png);
    } catch {
      // Screenshot failed
    }
  };

  // Keyboard shortcuts
  useKeyboard({
    onNewConversation: () => chat.newConversation(),
    onSettings: () => setRoute((r) => r === "settings" ? "chat" : "settings"),
    onToggleSidebar: undefined,
    onFocusInput: () => inputRef.current?.focus(),
    onPalette: () => setPaletteOpen((p) => !p),
    onEscape: paletteOpen ? () => setPaletteOpen(false) : shortcutHelpOpen ? () => setShortcutHelpOpen(false) : undefined,
    onHideWindow: hideWindow,
    onShortcutHelp: () => setShortcutHelpOpen((p) => !p),
  });

  const commands = [
    { id: "new", label: "New conversation  Ctrl+N", action: () => chat.newConversation() },
    { id: "clear", label: "Clear messages", action: () => chat.clearMessages() },
    { id: "screenshot", label: "Capture screen", action: handleScreenshot },
    { id: "tts", label: tts.enabled ? "Disable voice output" : "Enable voice output", action: tts.toggleEnabled },
    { id: "sound", label: sound.enabled ? "Disable notification sound" : "Enable notification sound", action: sound.toggleEnabled },
    { id: "export", label: "Export conversation to clipboard", action: () => copyConversation(chat.messages, chat.currentConversation?.title) },
    { id: "settings", label: "Open settings  Ctrl+,", action: () => setRoute("settings") },
    { id: "diagnostics", label: "View API traces", action: () => setRoute("diagnostics") },
    { id: "discovery", label: "Run discovery scan", action: () => setRoute("discovery") },
    { id: "shortcuts", label: "Keyboard shortcuts  Ctrl+/", action: () => setShortcutHelpOpen(true) },
    { id: "chat", label: "Back to chat", action: () => setRoute("chat") },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-blade-bg">
        <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
      </div>
    );
  }

  if (!config?.onboarded) {
    return (
      <div className="h-screen flex flex-col bg-blade-bg text-blade-text">
        <TitleBar />
        <Onboarding onComplete={async () => {
          await loadConfig();
          setRoute("discovery");
        }} />
      </div>
    );
  }

  if (route === "diagnostics") {
    return (
      <div className="h-screen flex flex-col bg-blade-bg text-blade-text">
        <TitleBar />
        <Diagnostics onBack={() => setRoute("chat")} />
      </div>
    );
  }

  if (route === "discovery") {
    return (
      <div className="h-screen flex flex-col bg-blade-bg text-blade-text">
        <TitleBar />
        <Discovery
          onComplete={() => setRoute("chat")}
          onSkip={() => setRoute("chat")}
        />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-blade-bg text-blade-text relative">
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-blade-bg/90 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-blade-accent/40 rounded-xl m-2 pointer-events-none animate-fade-in">
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-blade-accent-muted flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-blade-accent" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 5v14M5 12l7-7 7 7" />
              </svg>
            </div>
            <p className="text-sm text-blade-secondary">Drop file to analyze</p>
            <p className="text-2xs text-blade-muted mt-1">Images or text files</p>
          </div>
        </div>
      )}
      <TitleBar />
      <CommandPalette commands={commands} open={paletteOpen} onClose={closePalette} />
      <ShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
      <div className="flex-1 min-h-0">
        {route === "settings" ? (
          <Settings
            config={config}
            onBack={() => setRoute("chat")}
            onSaved={(nextConfig) => {
              setConfig(nextConfig);
              setRoute("chat");
            }}
            onConfigRefresh={loadConfig}
          />
        ) : (
          <ChatWindow
            messages={chat.messages}
            loading={chat.loading}
            error={chat.error}
            toolExecutions={chat.toolExecutions}
            clipboardText={chat.clipboardText}
            conversations={chat.conversations}
            currentConversationId={chat.currentConversationId}
            onSend={sendWithStats}
            onClear={chat.clearMessages}
            onNewConversation={chat.newConversation}
            onSwitchConversation={chat.switchConversation}
            onOpenSettings={() => setRoute("settings")}
            onDismissClipboard={chat.dismissClipboard}
            pendingApproval={chat.pendingApproval}
            onRespondApproval={chat.respondToApproval}
            onDeleteConversation={chat.deleteConversation}
            onRetry={chat.retryLastMessage}
            provider={config?.provider}
            streakDays={stats.streakDays}
            totalMessages={stats.totalMessages}
            model={config?.model}
            ttsEnabled={tts.enabled}
            ttsSpeaking={tts.speaking}
            onToggleTTS={tts.toggleEnabled}
            onStopTTS={tts.stop}
          />
        )}
      </div>
    </div>
  );
}
