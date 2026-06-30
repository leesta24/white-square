import { useEffect, useState } from "react";
import { api, type ModelInfo, type ProviderInfo, type Snapshot } from "./api.ts";
import { CharSprite } from "./CharSprite.tsx";
import { CHARACTERS, DEFAULT_SPRITE } from "./characters.ts";
import { PlazaView } from "./PlazaView.tsx";

const EMPTY: Partial<Snapshot> = {
  name: "",
  sprite: DEFAULT_SPRITE,
  identity: { markdown: "" },
  seedMemoryMd: "",
  skills: [],
};

export function AgentsTab() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [draft, setDraft] = useState<Partial<Snapshot>>(EMPTY);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [editing, setEditing] = useState(false); // false → show the plaza

  const reload = () => api.listSnapshots().then(setSnapshots);
  useEffect(() => {
    reload();
    api.models().then((m) => { setProviders(m.providers); setModels(m.models); });
  }, []);

  const providerLabel = (id: string) => providers.find((p) => p.id === id)?.label ?? id;
  const providerAvailable = (id: string) => providers.find((p) => p.id === id)?.available ?? false;

  const edit = (s: Snapshot) => { setDraft(JSON.parse(JSON.stringify(s))); setEditing(true); };
  const newOne = () => { setDraft({ ...EMPTY, seedMemoryMd: "", skills: [] }); setEditing(true); };

  const save = async () => {
    if (!draft.name?.trim()) return alert("Name this character first.");
    const saved = await api.saveSnapshot(draft);
    await reload();
    setDraft(saved);
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this profile?")) return;
    await api.deleteSnapshot(id);
    await reload();
    setEditing(false);
  };

  if (!editing) {
    return <PlazaView snapshots={snapshots} onSelect={edit} onNew={newOne} />;
  }

  return (
    <>
      <div className="col left">
        <div className="row">
          <span className="pixel" style={{ fontSize: 10 }}>SNAPSHOTS</span>
          <span className="spacer" />
          <button className="nes-btn is-primary" style={{ fontSize: 10 }} onClick={newOne}>+ New</button>
        </div>
        <div style={{ marginTop: 10 }}>
          {snapshots.map((s) => (
            <div key={s.id} className={`list-item ${draft.id === s.id ? "active" : ""}`} onClick={() => edit(s)}>
              <CharSprite sprite={s.sprite} size={28} />
              <div className="meta">
                <div className="name">{s.name}</div>
                <div className="sub">{(s.identity.markdown ?? s.identity.systemPrompt ?? "").slice(0, 24)}</div>
              </div>
            </div>
          ))}
          {snapshots.length === 0 && <div className="muted">No profiles yet.</div>}
        </div>
      </div>

      <div className="col center" style={{ padding: 20, display: "block" }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="nes-btn" style={{ fontSize: 10 }} onClick={() => setEditing(false)}>← Back to Square</button>
          <h2 className="pixel" style={{ fontSize: 12, margin: "0 0 0 12px" }}>{draft.id ? "Edit Profile" : "New Profile"}</h2>
        </div>

        <label className="field">Name</label>
        <input className="nes-input" value={draft.name ?? ""}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />

        <label className="field">Character Sprite</label>
        <div className="char-picker">
          {CHARACTERS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.label}
              className={`char-cell ${(draft.sprite ?? DEFAULT_SPRITE) === c.id ? "active" : ""}`}
              onClick={() => setDraft({ ...draft, sprite: c.id })}
            >
              <CharSprite sprite={c.id} size={40} />
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        <label className="field">identity.md</label>
        <textarea
          className="nes-textarea"
          rows={10}
          value={draft.identity?.markdown ?? draft.identity?.systemPrompt ?? ""}
          onChange={(e) => setDraft({ ...draft, identity: { ...draft.identity!, markdown: e.target.value, systemPrompt: e.target.value } })}
        />

        <label className="field">Model (blank = default Claude Sonnet)</label>
        <div className="nes-select">
          <select
            value={draft.model ? `${draft.model.provider}::${draft.model.id}` : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return setDraft({ ...draft, model: undefined });
              const [provider, id] = v.split("::");
              setDraft({ ...draft, model: { provider, id } });
            }}
          >
            <option value="">Default (Claude Sonnet 4.6)</option>
            {[...new Set(models.map((m) => m.provider))].map((prov) => (
              <optgroup key={prov} label={`${providerLabel(prov)}${providerAvailable(prov) ? "" : " (key missing)"}`}>
                {models.filter((m) => m.provider === prov).map((m) => (
                  <option key={`${prov}::${m.id}`} value={`${prov}::${m.id}`}>
                    {m.label}{providerAvailable(prov) ? "" : " ⚠️"}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {draft.model && !providerAvailable(draft.model.provider) && (
          <div className="muted" style={{ marginTop: 4 }}>
            This provider has no key yet. Configure it in Settings or choose an available provider.
          </div>
        )}

        <label className="field">seed-memory.md</label>
        <textarea
          className="nes-textarea"
          rows={8}
          value={draft.seedMemoryMd ?? (draft.seedMemory ?? []).map((m) => m.content).join("\n\n")}
          onChange={(e) => setDraft({ ...draft, seedMemoryMd: e.target.value })}
        />

        <div className="row" style={{ marginTop: 20 }}>
          <button className="nes-btn is-success" onClick={save}>Save</button>
          {draft.id && <button className="nes-btn is-error" onClick={() => remove(draft.id!)}>Delete</button>}
        </div>
      </div>
    </>
  );
}
