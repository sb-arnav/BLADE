import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatWindow } from "./components/ChatWindow";
import { Onboarding } from "./components/Onboarding";

interface Config {
  provider: string;
  api_key: string;
  model: string;
  onboarded: boolean;
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = async () => {
    try {
      const cfg = await invoke<Config>("get_config");
      setConfig(cfg);
    } catch {
      setConfig({ provider: "", api_key: "", model: "", onboarded: false });
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
    return <Onboarding onComplete={loadConfig} />;
  }

  return <ChatWindow />;
}
