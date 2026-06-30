import { useEffect, useState } from "react";
import { api, type SecretStatus } from "./api.ts";

export function SettingsTab() {
  const [secrets, setSecrets] = useState<SecretStatus[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const reload = () => api.secrets().then(setSecrets);
  useEffect(() => { reload(); }, []);

  const save = async (provider: string) => {
    const key = (drafts[provider] ?? "").trim();
    if (!key) return;
    const next = await api.setSecret(provider, key);
    setSecrets(next);
    setDrafts({ ...drafts, [provider]: "" });
  };
  const clear = async (provider: string) => {
    if (!confirm("Remove this provider key?")) return;
    const next = await api.removeSecret(provider);
    setSecrets(next);
  };

  return (
    <div className="col center" style={{ padding: 24, display: "block", maxWidth: 720, margin: "0 auto" }}>
      <h2 className="pixel" style={{ fontSize: 12 }}>🔑 Provider API Keys</h2>
      <p className="muted">
        Keys are stored locally in <code>./.data/secrets.json</code>, ignored by git, and reused after restart.
        Configured providers become available in the model picker.<br />
        Tip: <b>Vercel AI Gateway</b> can route all listed models with one key.
      </p>

      {secrets.map((s) => (
        <div key={s.provider} className="nes-container is-rounded" style={{ marginBottom: 14, background: "#2b2f4a" }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <b>{s.label}</b>
            {s.configured ? (
              <span className="nes-text is-success" style={{ fontSize: 11 }}>
                Configured ({s.source === "env" ? "environment" : `••••${s.last4}`})
              </span>
            ) : (
              <span className="muted">Not configured</span>
            )}
            <span className="spacer" />
            <a href={s.dashboardUrl} target="_blank" rel="noreferrer" className="nes-text is-primary" style={{ fontSize: 11 }}>Get key ↗</a>
          </div>
          <div className="row">
            <input
              className="nes-input"
              type="password"
              placeholder={s.source === "env" ? "Environment key set; paste to override..." : "Paste API key..."}
              value={drafts[s.provider] ?? ""}
              onChange={(e) => setDrafts({ ...drafts, [s.provider]: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && save(s.provider)}
            />
            <button className="nes-btn is-success" style={{ fontSize: 11 }} onClick={() => save(s.provider)}>Save</button>
            {s.source === "ui" && (
              <button className="nes-btn is-error" style={{ fontSize: 11 }} onClick={() => clear(s.provider)}>Remove</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
