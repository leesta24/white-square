import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { type AgentSnapshot, availableProviders, type GroupMessage, MODEL_CATALOG, PROVIDER_CATALOG } from "@white-square/core";
import { AgentManager } from "./agents.ts";
import type { SecretStore } from "./secrets.ts";
import type { AgentInstance, ChatMessage, Session, Storage } from "./storage.ts";
import { seedSnapshots } from "./seed.ts";

export interface ServerDeps {
  storage: Storage;
  manager: AgentManager;
  secrets: SecretStore;
}

export async function startServer(deps: ServerDeps, port: number) {
  const { storage, manager, secrets } = deps;
  await storage.init();
  await seedSnapshots(storage);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // Engine mode is dynamic: pi when any provider key is configured, else echo.
  app.get("/api/runtime", (_req, res) =>
    res.json({ mode: availableProviders().size > 0 ? "pi" : "echo" }),
  );

  app.get("/api/models", (_req, res) => {
    const available = availableProviders();
    res.json({
      providers: PROVIDER_CATALOG.map((p) => ({ ...p, available: available.has(p.id) })),
      models: MODEL_CATALOG,
    });
  });

  // ---- secrets (provider API keys, configured from the UI) ----
  app.get("/api/secrets", (_req, res) => res.json(secrets.status()));
  app.put("/api/secrets/:provider", async (req, res) => {
    const key = (req.body?.key as string)?.trim();
    if (!key) return res.status(400).json({ error: "key required" });
    await secrets.set(req.params.provider, key);
    res.json(secrets.status()); // engine is picked per-turn, no cache to reset
  });
  app.delete("/api/secrets/:provider", async (req, res) => {
    await secrets.remove(req.params.provider);
    res.json(secrets.status());
  });

  // ---- snapshots ----
  app.get("/api/snapshots", async (_req, res) => res.json(await storage.listSnapshots()));
  app.get("/api/snapshots/:id", async (req, res) => {
    const s = await storage.getSnapshot(req.params.id);
    return s ? res.json(s) : res.status(404).json({ error: "not found" });
  });
  app.post("/api/snapshots", async (req, res) => {
    const s = normalizeSnapshot(req.body);
    res.json(await storage.saveSnapshot(s));
  });
  app.put("/api/snapshots/:id", async (req, res) => {
    const s = normalizeSnapshot({ ...req.body, id: req.params.id });
    res.json(await storage.saveSnapshot(s));
  });
  app.delete("/api/snapshots/:id", async (req, res) => {
    await storage.deleteSnapshot(req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/snapshots/:id/memory-files", async (req, res) => {
    const s = await storage.getSnapshot(req.params.id);
    if (!s) return res.status(404).json({ error: "snapshot not found" });
    res.json(await storage.listMemoryFiles(req.params.id));
  });
  app.put("/api/snapshots/:id/memory-files/:scope", async (req, res) => {
    const s = await storage.getSnapshot(req.params.id);
    if (!s) return res.status(404).json({ error: "snapshot not found" });
    const scope = req.params.scope;
    if (scope !== "global" && scope !== "session") return res.status(400).json({ error: "invalid scope" });
    if (scope === "session" && !req.body?.sessionId) return res.status(400).json({ error: "sessionId required" });
    res.json(await storage.saveMemoryFile(req.params.id, {
      scope,
      sessionId: req.body?.sessionId,
      content: String(req.body?.content ?? ""),
    }));
  });

  // ---- sessions ----
  app.get("/api/sessions", async (_req, res) => res.json(await storage.listSessions()));
  app.get("/api/sessions/:id", async (req, res) => {
    const s = await storage.getSession(req.params.id);
    return s ? res.json(s) : res.status(404).json({ error: "not found" });
  });
  app.post("/api/sessions", async (req, res) => {
    const session: Session = {
      id: randomUUID(),
      title: (req.body?.title as string) || "New Session",
      agents: [],
      messages: [],
      createdAt: Date.now(),
    };
    res.json(await storage.saveSession(session));
  });
  app.delete("/api/sessions/:id", async (req, res) => {
    await storage.deleteSession(req.params.id);
    res.json({ ok: true });
  });
  app.post("/api/sessions/:id/agents", async (req, res) => {
    const session = await storage.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session not found" });
    const snapshot = await storage.getSnapshot(req.body?.snapshotId);
    if (!snapshot) return res.status(400).json({ error: "snapshot not found" });
    if (session.agents.some((a) => a.snapshotId === snapshot.id)) {
      return res.status(409).json({ error: `${snapshot.name} is already in this session.` });
    }
    const instance: AgentInstance = {
      instanceId: randomUUID(),
      snapshotId: snapshot.id,
      name: snapshot.name,
      sprite: snapshot.sprite,
      avatar: snapshot.avatar,
    };
    session.agents.push(instance);
    await storage.saveSession(session);
    res.json(session);
  });
  app.delete("/api/sessions/:id/agents/:instanceId", async (req, res) => {
    const session = await storage.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session not found" });
    session.agents = session.agents.filter((a) => a.instanceId !== req.params.instanceId);
    await storage.saveSession(session);
    res.json(session);
  });

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const sessionId = url.searchParams.get("sessionId") ?? "";
    ws.on("message", (raw) => handleUserMessage(ws, sessionId, String(raw)).catch((err) => {
      send(ws, { type: "error", message: err instanceof Error ? err.message : String(err) });
    }));
  });

  async function handleUserMessage(ws: WebSocket, sessionId: string, raw: string) {
    const data = JSON.parse(raw) as { text?: string };
    const text = (data.text ?? "").trim();
    if (!text) return;

    const session = await storage.getSession(sessionId);
    if (!session) return send(ws, { type: "error", message: "session not found" });

    const userMsg: ChatMessage = { id: randomUUID(), role: "user", text, ts: Date.now() };
    session.messages.push(userMsg);
    await storage.saveSession(session);
    send(ws, { type: "user_saved", message: userMsg });

    const targets = resolveTargets(session, text);
    if (targets.length === 0) {
      const sys: ChatMessage = {
        id: randomUUID(),
        role: "system",
        text: "No characters are in this session yet. Add one from the right panel.",
        ts: Date.now(),
      };
      session.messages.push(sys);
      await storage.saveSession(session);
      return send(ws, { type: "system", message: sys });
    }

    for (const instance of targets) {
      const msgId = randomUUID();
      send(ws, { type: "start", msgId, agentId: instance.instanceId, name: instance.name, avatar: instance.avatar });
      let full = "";
      try {
        // Rebuild the transcript from the latest session state so this agent
        // sees the human's message AND any earlier agents' replies this round.
        const fresh = (await storage.getSession(sessionId)) ?? session;
        const transcript = toTranscript(fresh.messages);
        for await (const ev of manager.respond(sessionId, instance, transcript)) {
          if (ev.type === "text") {
            full += ev.delta;
            send(ws, { type: "delta", msgId, delta: ev.delta });
          } else if (ev.type === "tool") {
            send(ws, { type: "tool", msgId, name: ev.name, summary: ev.summary });
          } else if (ev.type === "error") {
            full += `${full ? "\n" : ""}[Error] ${ev.message}`;
            send(ws, { type: "error", msgId, message: ev.message });
          }
        }
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        full += `${full ? "\n" : ""}[Error] ${m}`;
        send(ws, { type: "error", msgId, message: m });
      }
      const agentMsg: ChatMessage = {
        id: msgId,
        role: "agent",
        text: full,
        agentId: instance.instanceId,
        name: instance.name,
        ts: Date.now(),
      };
      const fresh = await storage.getSession(sessionId);
      if (fresh) {
        fresh.messages.push(agentMsg);
        await storage.saveSession(fresh);
      }
      send(ws, { type: "end", msgId, message: agentMsg });
    }
  }

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  return httpServer;
}

/**
 * @mention → those agents reply. No (matching) @mention → broadcast to all
 * agents in the session.
 */
function resolveTargets(session: Session, text: string): AgentInstance[] {
  const tokens = [...text.matchAll(/@(\S+)/g)].map((m) => m[1].toLowerCase());
  if (tokens.length > 0) {
    const matched = session.agents.filter((a) =>
      tokens.some((t) => a.name.toLowerCase() === t || a.name.toLowerCase().startsWith(t)),
    );
    if (matched.length > 0) return matched;
  }
  return session.agents; // no mention → broadcast to everyone
}

/** Map the stored chat log to the engine-facing group transcript (drops UI-only system notices). */
function toTranscript(messages: ChatMessage[]): GroupMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "agent")
    .map((m) =>
      m.role === "agent"
        ? { speaker: m.name ?? "agent", selfId: m.agentId, text: m.text }
        : { speaker: "User", text: m.text },
    );
}

function normalizeSnapshot(body: any): AgentSnapshot {
  const identityMd =
    body?.identity?.markdown ??
    body?.identityMd ??
    body?.identity?.systemPrompt ??
    "You are a helpful character in White Square.";
  const seedMemoryMd =
    body?.seedMemoryMd ??
    (Array.isArray(body.seedMemory) ? body.seedMemory.map((m: any) => m?.content ?? "").join("\n\n") : "");
  return {
    schemaVersion: "0.1",
    id: body.id || randomUUID(),
    name: body.name || "Unnamed Character",
    sprite: body.sprite || "white",
    avatar: body.avatar,
    identity: {
      markdown: identityMd,
      systemPrompt: identityMd,
      persona: body?.identity?.persona,
    },
    seedMemoryMd,
    seedMemory: [{ id: "seed-memory.md", content: seedMemoryMd, tags: ["seed"] }],
    skills: Array.isArray(body.skills) ? body.skills : [],
    model: body.model,
    meta: body.meta,
  };
}

function send(ws: WebSocket, obj: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
