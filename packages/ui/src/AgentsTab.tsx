import { useEffect, useState } from "react";
import {
  api,
  type MemoryFile,
  type ModelInfo,
  type ProviderInfo,
  type RuntimeInfo,
  type Snapshot,
} from "./api.ts";
import { CharSprite } from "./CharSprite.tsx";
import { CHARACTERS, DEFAULT_SPRITE } from "./characters.ts";
import { PixelSelect, type PixelSelectItem } from "./PixelSelect.tsx";
import { PlazaView } from "./PlazaView.tsx";

const EMPTY: Partial<Snapshot> = {
  name: "",
  sprite: DEFAULT_SPRITE,
  identity: { markdown: "" },
  catchphrases: [],
  skills: [],
};

export function AgentsTab() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [draft, setDraft] = useState<Partial<Snapshot>>(EMPTY);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [memoryFiles, setMemoryFiles] = useState<MemoryFile[]>([]);
  const [selectedSessionKey, setSelectedSessionKey] = useState("");
  const [editing, setEditing] = useState(false); // false → show the plaza

  const reload = () => api.listSnapshots().then(setSnapshots);
  useEffect(() => {
    reload();
    api.models().then((m) => {
      setProviders(m.providers);
      setModels(m.models);
      setRuntimes(m.runtimes);
    });
  }, []);

  const providerLabel = (id: string) =>
    providers.find((p) => p.id === id)?.label ?? id;
  const providerAvailable = (id: string) =>
    providers.find((p) => p.id === id)?.available ?? false;

  const edit = (s: Snapshot) => {
    setDraft(JSON.parse(JSON.stringify(s)));
    setEditing(true);
    api
      .listMemoryFiles(s.id)
      .then((files) => {
        setMemoryFiles(files);
        setSelectedSessionKey(
          files.find((f) => f.scope === "session")?.sessionId ?? "",
        );
      })
      .catch(() => {
        setMemoryFiles([]);
        setSelectedSessionKey("");
      });
  };
  const newOne = () => {
    setDraft({ ...EMPTY, skills: [] });
    setMemoryFiles([]);
    setSelectedSessionKey("");
    setEditing(true);
  };

  const save = async () => {
    if (!draft.name?.trim()) return alert("Name this character first.");
    const saved = await api.saveSnapshot(draft);
    await reload();
    setDraft(saved);
    const files = await api.listMemoryFiles(saved.id);
    setMemoryFiles(files);
    setSelectedSessionKey(
      files.find((f) => f.scope === "session")?.sessionId ?? "",
    );
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this profile?")) return;
    await api.deleteSnapshot(id);
    await reload();
    setEditing(false);
  };

  const setMemoryFile = (i: number, content: string) => {
    setMemoryFiles((files) =>
      files.map((f, k) => (k === i ? { ...f, content } : f)),
    );
  };
  const saveMemoryFile = async (i: number) => {
    const id = draft.id;
    if (!id) return;
    const saved = await api.saveMemoryFile(id, memoryFiles[i]);
    setMemoryFiles((files) =>
      files.map((f, k) => (k === i ? { ...f, ...saved } : f)),
    );
  };
  const globalIndex = memoryFiles.findIndex((f) => f.scope === "global");
  const sessionFiles = memoryFiles.filter((f) => f.scope === "session");
  const selectedSessionIndex = memoryFiles.findIndex(
    (f) => f.scope === "session" && f.sessionId === selectedSessionKey,
  );
  const catchphrases = draft.catchphrases ?? [];
  const setCatchphrase = (index: number, value: string) => {
    setDraft({
      ...draft,
      catchphrases: catchphrases.map((line, i) => (i === index ? value : line)),
    });
  };
  const addCatchphrase = () =>
    setDraft({ ...draft, catchphrases: [...catchphrases, ""] });
  const removeCatchphrase = (index: number) => {
    setDraft({
      ...draft,
      catchphrases: catchphrases.filter((_, i) => i !== index),
    });
  };

  if (!editing) {
    return <PlazaView snapshots={snapshots} onSelect={edit} onNew={newOne} />;
  }

  return (
    <>
      <div className="col left">
        <div className="row">
          <span className="pixel" style={{ fontSize: 10 }}>
            SNAPSHOTS
          </span>
          <span className="spacer" />
          <button
            className="nes-btn is-primary"
            style={{ fontSize: 10 }}
            onClick={newOne}
          >
            + New
          </button>
        </div>
        <div style={{ marginTop: 10 }}>
          {snapshots.map((s) => (
            <div
              key={s.id}
              className={`list-item ${draft.id === s.id ? "active" : ""}`}
              onClick={() => edit(s)}
            >
              <CharSprite sprite={s.sprite} size={28} />
              <div className="meta">
                <div className="name">{s.name}</div>
                <div className="sub">
                  {(s.identity.markdown ?? s.identity.systemPrompt ?? "").slice(
                    0,
                    24,
                  )}
                </div>
              </div>
            </div>
          ))}
          {snapshots.length === 0 && (
            <div className="muted">No profiles yet.</div>
          )}
        </div>
      </div>

      <div className="col center" style={{ padding: 20, display: "block" }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <button
            className="nes-btn"
            style={{ fontSize: 10 }}
            onClick={() => setEditing(false)}
          >
            ← Back to Square
          </button>
          <h2 className="pixel" style={{ fontSize: 12, margin: "0 0 0 12px" }}>
            {draft.id ? "Edit Profile" : "New Profile"}
          </h2>
        </div>

        <label className="field">Name</label>
        <input
          className="nes-input"
          value={draft.name ?? ""}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />

        <label className="field">Catchphrases</label>
        <div className="catchphrase-list">
          {catchphrases.map((line, i) => (
            <div className="catchphrase-row" key={i}>
              <input
                className="nes-input"
                value={line}
                placeholder="One line, one phrase..."
                onChange={(e) => setCatchphrase(i, e.target.value)}
              />
              <button
                className="nes-btn is-error"
                style={{ fontSize: 10 }}
                onClick={() => removeCatchphrase(i)}
              >
                ×
              </button>
            </div>
          ))}
          {catchphrases.length === 0 && (
            <div className="muted">
              No catchphrases yet. Plaza speech bubbles stay quiet.
            </div>
          )}
          <button
            className="nes-btn"
            style={{ fontSize: 10 }}
            onClick={addCatchphrase}
          >
            + Add phrase
          </button>
        </div>

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
          onChange={(e) =>
            setDraft({
              ...draft,
              identity: {
                ...draft.identity!,
                markdown: e.target.value,
                systemPrompt: e.target.value,
              },
            })
          }
        />

        <label className="field">Model (blank = default Claude Sonnet)</label>
        <PixelSelect
          value={
            draft.model ? `${draft.model.provider}::${draft.model.id}` : ""
          }
          placeholder="Default (Claude Sonnet 4.6)"
          onChange={(v) => {
            if (!v) return setDraft({ ...draft, model: undefined });
            const [provider, id] = v.split("::");
            setDraft({ ...draft, model: { provider, id } });
          }}
          items={[
            { value: "", label: "Default (Claude Sonnet 4.6)" },
            ...[...new Set(models.map((m) => m.provider))].flatMap(
              (prov): PixelSelectItem[] => [
                {
                  type: "group",
                  label: `${providerLabel(prov)}${providerAvailable(prov) ? "" : " (key missing)"}`,
                },
                ...models
                  .filter((m) => m.provider === prov)
                  .map((m): PixelSelectItem => ({
                    value: `${prov}::${m.id}`,
                    label: m.label,
                    warn: !providerAvailable(prov),
                  })),
              ],
            ),
          ]}
        />
        {draft.model && !providerAvailable(draft.model.provider) && (
          <div className="muted" style={{ marginTop: 4 }}>
            This provider has no key yet. Configure it in Settings or choose an
            available provider.
          </div>
        )}

        <label className="field">Runtime</label>
        <PixelSelect
          value={draft.runtime ?? "pi"}
          onChange={(v) => setDraft({ ...draft, runtime: v })}
          items={runtimes.map((rt): PixelSelectItem => ({
            value: rt.id,
            label: rt.available ? rt.label : `${rt.label} (coming soon)`,
            disabled: !rt.available,
          }))}
        />

        {draft.id && (
          <>
            <label className="field">global.md</label>
            {globalIndex >= 0 ? (
              <div style={{ marginBottom: 12 }}>
                <div className="row" style={{ marginBottom: 4 }}>
                  <span className="muted" style={{ fontFamily: "monospace" }}>
                    {memoryFiles[globalIndex].path}
                  </span>
                  <span className="spacer" />
                  <button
                    className="nes-btn"
                    style={{ fontSize: 10 }}
                    onClick={() => saveMemoryFile(globalIndex)}
                  >
                    Save global.md
                  </button>
                </div>
                <textarea
                  className="nes-textarea"
                  rows={6}
                  value={memoryFiles[globalIndex].content}
                  placeholder="Global memory is empty."
                  onChange={(e) => setMemoryFile(globalIndex, e.target.value)}
                />
              </div>
            ) : (
              <div className="muted">No global memory file yet.</div>
            )}

            <label className="field">Session Memory</label>
            {sessionFiles.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <div className="row" style={{ gap: 10, marginBottom: 8 }}>
                  <PixelSelect
                    style={{ flex: 1 }}
                    value={selectedSessionKey}
                    onChange={setSelectedSessionKey}
                    items={sessionFiles.map((file) => ({
                      value: file.sessionId ?? "",
                      label: file.sessionTitle ?? file.sessionId ?? "",
                    }))}
                  />
                  {selectedSessionIndex >= 0 && (
                    <button
                      className="nes-btn"
                      style={{ fontSize: 10 }}
                      onClick={() => saveMemoryFile(selectedSessionIndex)}
                    >
                      Save session.md
                    </button>
                  )}
                </div>
                {selectedSessionIndex >= 0 && (
                  <>
                    <div
                      className="muted"
                      style={{ fontFamily: "monospace", marginBottom: 4 }}
                    >
                      {memoryFiles[selectedSessionIndex].path}
                    </div>
                    <textarea
                      className="nes-textarea"
                      rows={6}
                      value={memoryFiles[selectedSessionIndex].content}
                      placeholder="Session memory is empty."
                      onChange={(e) =>
                        setMemoryFile(selectedSessionIndex, e.target.value)
                      }
                    />
                  </>
                )}
              </div>
            ) : (
              <div className="muted">
                No session memory files yet. Add this character to a chat
                session first.
              </div>
            )}
          </>
        )}

        <div className="row" style={{ marginTop: 20 }}>
          <button className="nes-btn is-success" onClick={save}>
            Save
          </button>
          {draft.id && (
            <button
              className="nes-btn is-error"
              onClick={() => remove(draft.id!)}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </>
  );
}
