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
import { TitleBar } from "./components/TitleBar";
import { useChat } from "./hooks/useChat";
import { useTTS } from "./hooks/useTTS";
import { useKeyboard } from "./hooks/useKeyboard";
import { useNotificationSound } from "./hooks/useNotificationSound";
import { copyConversation } from "./utils/exportConversation";
import { BladeConfig } from "./types";

type Route = "chat" | "settings" | "discovery" | "diagnostics";

export default function App() {
  const [config, setConfig] = useState<BladeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<Route>("chat");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const chat = useChat();
  const tts = useTTS(chat.messages, chat.loading);
  const sound = useNotificationSound(chat.loading);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    onEscape: paletteOpen ? () => setPaletteOpen(false) : undefined,
    onHideWindow: hideWindow,
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
    <div className="h-screen flex flex-col bg-blade-bg text-blade-text">
      <TitleBar />
      <CommandPalette commands={commands} open={paletteOpen} onClose={closePalette} />
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
            onSend={chat.sendMessage}
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
