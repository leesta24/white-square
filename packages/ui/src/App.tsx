import { useCallback, useEffect, useState } from "react";
import { AgentsTab } from "./AgentsTab.tsx";
import { ChatTab } from "./ChatTab.tsx";
import { SettingsTab } from "./SettingsTab.tsx";
import { api } from "./api.ts";

type Tab = "chat" | "agents" | "settings";

export function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const [mode, setMode] = useState<string>("…");

  const refreshMode = useCallback(() => {
    api.runtime().then((r) => setMode(r.mode)).catch(() => setMode("offline"));
  }, []);
  useEffect(() => { refreshMode(); }, [refreshMode]);

  return (
    <div className="app">
      <div className="topbar">
        <h1>🕹️ White Square</h1>
        <div className="tabs">
          <button className={`tab-btn ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}>Chat</button>
          <button className={`tab-btn ${tab === "agents" ? "active" : ""}`} onClick={() => setTab("agents")}>Agents</button>
          <button className={`tab-btn ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>Settings</button>
        </div>
        <span className={`mode ${mode}`}>Engine: {mode}</span>
      </div>
      <div className="body">
        {tab === "chat" && <ChatTab />}
        {tab === "agents" && <AgentsTab />}
        {tab === "settings" && <SettingsTab onChange={refreshMode} />}
      </div>
    </div>
  );
}
