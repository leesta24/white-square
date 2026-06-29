import { useEffect, useRef, useState } from "react";
import { api, type ChatMessage, type Session, type Snapshot } from "./api.ts";
import { CharSprite } from "./CharSprite.tsx";

export function ChatTab() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);

  const reloadSessions = () => api.listSessions().then((s) => setSessions(s.sort((a, b) => b.createdAt - a.createdAt)));
  useEffect(() => { reloadSessions(); api.listSnapshots().then(setSnapshots); }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const openSession = async (id: string) => {
    const s = await api.getSession(id);
    setActive(s);
    setMessages(s.messages);
    connect(id);
  };

  const connect = (sessionId: string) => {
    wsRef.current?.close();
    const ws = new WebSocket(`ws://${location.host}/ws?sessionId=${sessionId}`);
    ws.onmessage = (ev) => handleFrame(JSON.parse(ev.data));
    wsRef.current = ws;
  };

  useEffect(() => () => wsRef.current?.close(), []);

  const handleFrame = (f: any) => {
    setMessages((prev) => {
      switch (f.type) {
        case "user_saved":
        case "system":
          return [...prev, f.message];
        case "start":
          return [...prev, { id: f.msgId, role: "agent", text: "", agentId: f.agentId, name: f.name, ts: Date.now() }];
        case "delta":
          return prev.map((m) => (m.id === f.msgId ? { ...m, text: m.text + f.delta } : m));
        case "end":
          setBusy(false);
          return prev.map((m) => (m.id === f.msgId ? { ...m, text: f.message.text || m.text } : m));
        case "tool":
          return prev.map((m) => (m.id === f.msgId ? { ...m, text: m.text } : m));
        case "error": {
          setBusy(false);
          if (f.msgId) return prev.map((m) => (m.id === f.msgId ? { ...m, text: m.text + `\n[Error] ${f.message}` } : m));
          return [...prev, { id: crypto.randomUUID(), role: "system", text: `[Error] ${f.message}`, ts: Date.now() }];
        }
        default:
          return prev;
      }
    });
  };

  const send = () => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text }));
    setInput("");
    setBusy(true);
  };

  const newSession = async () => {
    const s = await api.createSession("New Session");
    await reloadSessions();
    openSession(s.id);
  };
  const delSession = async (id: string) => {
    if (!confirm("Delete this session?")) return;
    await api.deleteSession(id);
    if (active?.id === id) { setActive(null); setMessages([]); }
    reloadSessions();
  };

  const addAgent = async (snapshotId: string) => {
    if (!active || !snapshotId) return;
    try {
      const s = await api.addAgent(active.id, snapshotId);
      setActive(s);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };
  const removeAgent = async (instanceId: string) => {
    if (!active) return;
    const s = await api.removeAgent(active.id, instanceId);
    setActive(s);
  };

  // ---- @mention autocomplete ----
  const mentionMatches =
    active && mention
      ? active.agents.filter((a) => a.name.toLowerCase().includes(mention.query.toLowerCase()))
      : [];

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    const caret = e.target.selectionStart ?? val.length;
    const m = val.slice(0, caret).match(/@([^\s@]*)$/);
    if (m) { setMention({ query: m[1], start: caret - m[0].length }); setMentionIdx(0); }
    else setMention(null);
  };

  const pickMention = (name: string) => {
    if (!mention) return;
    const before = input.slice(0, mention.start);
    const after = input.slice(mention.start + 1 + mention.query.length);
    const next = `${before}@${name} ${after}`;
    setInput(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = `${before}@${name} `.length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mention && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx((i) => (i + 1) % mentionMatches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIdx((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mentionMatches[mentionIdx].name); return; }
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === "Enter") send();
  };

  return (
    <>
      <div className="col left">
        <div className="row">
          <span className="pixel" style={{ fontSize: 10 }}>Sessions</span>
          <span className="spacer" />
          <button className="nes-btn is-primary" style={{ fontSize: 10 }} onClick={newSession}>+ New</button>
        </div>
        <div style={{ marginTop: 10 }}>
          {sessions.map((s) => (
            <div key={s.id} className={`list-item ${active?.id === s.id ? "active" : ""}`} onClick={() => openSession(s.id)}>
              <div className="meta" style={{ flex: 1 }}>
                <div className="name">{s.title}</div>
                <div className="sub" style={{ display: "flex", gap: 2, alignItems: "center" }}>
                  {s.agents.length ? s.agents.map((a) => <CharSprite key={a.instanceId} sprite={a.sprite} size={16} />) : "No cast"}
                </div>
              </div>
              <button className="nes-btn is-error" style={{ fontSize: 9 }} onClick={(e) => { e.stopPropagation(); delSession(s.id); }}>×</button>
            </div>
          ))}
          {sessions.length === 0 && <div className="muted">No sessions yet.</div>}
        </div>
      </div>

      <div className="col center">
        {!active ? (
          <div className="muted" style={{ margin: "auto" }}>Pick a session or create one.</div>
        ) : (
          <>
            <div className="chat-scroll" ref={scrollRef}>
              {messages.map((m) => (
                <div key={m.id} className={`bubble ${m.role}`}>
                  {m.role === "agent" && <div className="who">{m.name}</div>}
                  <div>{m.text}{busy && m.role === "agent" && m.text === "" ? <span className="blink" /> : null}</div>
                </div>
              ))}
              {messages.length === 0 && <div className="muted">Say something. Use @name to call one character.</div>}
            </div>
            <div className="composer">
              <div className="mention-wrap">
                {mention && mentionMatches.length > 0 && (
                  <div className="mention-pop">
                    <div className="mention-hint">↑↓ Move · Enter/Tab Pick · Esc Close</div>
                    {mentionMatches.map((a, i) => (
                      <div
                        key={a.instanceId}
                        className={`mention-item ${i === mentionIdx ? "active" : ""}`}
                        onMouseDown={(e) => { e.preventDefault(); pickMention(a.name); }}
                      >
                        <CharSprite sprite={a.sprite} size={20} /> {a.name}
                      </div>
                    ))}
                  </div>
                )}
                <input
                  ref={inputRef}
                  className="nes-input"
                  value={input}
                  placeholder={active.agents.length > 1 ? "Message the square, or @ someone..." : "Type a message..."}
                  onChange={onInputChange}
                  onKeyDown={onInputKeyDown}
                />
              </div>
              <button className="nes-btn is-success" onClick={send} disabled={busy}>Send</button>
            </div>
          </>
        )}
      </div>

      <div className="col right">
        <span className="pixel" style={{ fontSize: 10 }}>Cast</span>
        {!active ? (
          <div className="muted" style={{ marginTop: 10 }}>Pick a session first.</div>
        ) : (
          <>
            <div style={{ marginTop: 10 }}>
              {active.agents.map((a) => (
                <div key={a.instanceId} className="list-item">
                  <CharSprite sprite={a.sprite} size={28} />
                  <div className="meta" style={{ flex: 1 }}><div className="name">{a.name}</div></div>
                  <button className="nes-btn is-error" style={{ fontSize: 9 }} onClick={() => removeAgent(a.instanceId)}>×</button>
                </div>
              ))}
              {active.agents.length === 0 && <div className="muted">No one is on stage.</div>}
            </div>
            <label className="field">Add Character</label>
            <div className="nes-select">
              <select defaultValue="" onChange={(e) => { addAgent(e.target.value); e.target.value = ""; }}>
                <option value="" disabled>Select profile...</option>
                {snapshots
                  .filter((s) => !active.agents.some((a) => a.snapshotId === s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
              </select>
            </div>
          </>
        )}
      </div>
    </>
  );
}
