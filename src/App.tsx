import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatWindow } from "./components/ChatWindow";
import { Discovery } from "./components/Discovery";
import { Onboarding } from "./components/Onboarding";
import { Settings } from "./components/Settings";
import { TitleBar } from "./components/TitleBar";
import { useChat } from "./hooks/useChat";
import { BladeConfig } from "./types";

type Route = "chat" | "settings" | "discovery";

export default function App() {
  const [config, setConfig] = useState<BladeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<Route>("chat");
  const chat = useChat();

  const loadConfig = async () => {
    try {
      const cfg = await invoke<BladeConfig>("get_config");
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
            conversations={chat.conversations}
            currentConversationId={chat.currentConversationId}
            onSend={chat.sendMessage}
            onClear={chat.clearMessages}
            onNewConversation={chat.newConversation}
            onSwitchConversation={chat.switchConversation}
            onOpenSettings={() => setRoute("settings")}
          />
        )}
      </div>
    </div>
  );
}
