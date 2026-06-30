import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import {
  type AgentSnapshot,
  availableProviders,
  DEFAULT_RUNTIME,
  type GroupMessage,
  MODEL_CATALOG,
  PROVIDER_CATALOG,
  RUNTIME_CATALOG,
} from "@white-square/core";
import { AgentManager } from "./agents.ts";
import type { SecretStore } from "./secrets.ts";
import type {
  AgentInstance,
  ChatMessage,
  Session,
  Storage,
} from "./storage.ts";
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

  app.get("/api/models", (_req, res) => {
    const available = availableProviders();
    res.json({
      providers: PROVIDER_CATALOG.map((p) => ({
        ...p,
        available: available.has(p.id),
      })),
      models: MODEL_CATALOG,
      runtimes: RUNTIME_CATALOG,
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
  app.get("/api/snapshots", async (_req, res) =>
    res.json(await storage.listSnapshots()),
  );
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
    if (scope !== "global" && scope !== "session")
      return res.status(400).json({ error: "invalid scope" });
    if (scope === "session" && !req.body?.sessionId)
      return res.status(400).json({ error: "sessionId required" });
    res.json(
      await storage.saveMemoryFile(req.params.id, {
        scope,
        sessionId: req.body?.sessionId,
        content: String(req.body?.content ?? ""),
      }),
    );
  });

  // ---- sessions ----
  app.get("/api/sessions", async (_req, res) =>
    res.json(await storage.listSessions()),
  );
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
      return res
        .status(409)
        .json({ error: `${snapshot.name} is already in this session.` });
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
    session.agents = session.agents.filter(
      (a) => a.instanceId !== req.params.instanceId,
    );
    await storage.saveSession(session);
    res.json(session);
  });

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const sessionTurnQueues = new Map<string, Promise<void>>();

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const sessionId = url.searchParams.get("sessionId") ?? "";
    ws.on("message", (raw) => {
      void enqueueSessionTurn(sessionId, () =>
        handleUserMessage(ws, sessionId, String(raw)),
      )
        .catch((err) => {
          send(ws, {
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          send(ws, { type: "turn_done" });
        });
    });
  });

  function enqueueSessionTurn(
    sessionId: string,
    task: () => Promise<void>,
  ): Promise<void> {
    const prev = (sessionTurnQueues.get(sessionId) ?? Promise.resolve()).catch(
      () => undefined,
    );
    const next = prev.then(task);
    const stored = next
      .catch(() => undefined)
      .finally(() => {
        if (sessionTurnQueues.get(sessionId) === stored)
          sessionTurnQueues.delete(sessionId);
      });
    sessionTurnQueues.set(sessionId, stored);
    return next;
  }

  async function handleUserMessage(
    ws: WebSocket,
    sessionId: string,
    raw: string,
  ) {
    const data = JSON.parse(raw) as { text?: string };
    const text = (data.text ?? "").trim();
    if (!text) return;

    const session = await storage.getSession(sessionId);
    if (!session)
      return send(ws, { type: "error", message: "session not found" });

    const userMsg: ChatMessage = {
      id: randomUUID(),
      role: "user",
      text,
      ts: Date.now(),
    };
    const isFirstUserMsg = !session.messages.some((m) => m.role === "user");
    session.messages.push(userMsg);
    if (isFirstUserMsg && isDefaultTitle(session.title))
      session.title = deriveSessionTitle(text);
    await storage.saveSession(session);
    send(ws, { type: "user_saved", message: userMsg, title: session.title });

    const { targets, directed } = resolveTargets(session, text);
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

    const baseTranscript = toTranscript(session.messages);
    const cast = session.agents.map((a) => a.name);
    const replies = (
      await Promise.all(
        targets.map((instance) =>
          runAgentTurn(ws, sessionId, instance, baseTranscript, directed, cast),
        ),
      )
    ).filter((m): m is ChatMessage => m !== null);

    const fresh = await storage.getSession(sessionId);
    if (fresh && replies.length) {
      fresh.messages.push(...replies);
      await storage.saveSession(fresh);
    }
  }

  /**
   * Stream one agent's turn. Returns null when the agent stays silent (skip) or
   * produces nothing — a silent turn leaves zero footprint: no bubble, no
   * persisted message, no transcript entry. The `start` frame is deferred until
   * the first real text so a skipping agent never flashes an empty bubble.
   */
  async function runAgentTurn(
    ws: WebSocket,
    sessionId: string,
    instance: AgentInstance,
    transcript: GroupMessage[],
    directed: boolean,
    cast: string[],
  ): Promise<ChatMessage | null> {
    const msgId = randomUUID();
    let started = false;
    let silent = false;
    let full = "";
    const pendingTools: { name: string; summary: string }[] = [];
    const ensureStarted = () => {
      if (started) return;
      started = true;
      send(ws, {
        type: "start",
        msgId,
        agentId: instance.instanceId,
        name: instance.name,
        avatar: instance.avatar,
      });
      for (const t of pendingTools)
        send(ws, { type: "tool", msgId, name: t.name, summary: t.summary });
      pendingTools.length = 0;
    };
    try {
      for await (const ev of manager.respond(
        sessionId,
        instance,
        transcript,
        directed,
        cast,
      )) {
        if (ev.type === "text") {
          ensureStarted();
          full += ev.delta;
          send(ws, { type: "delta", msgId, delta: ev.delta });
        } else if (ev.type === "tool") {
          if (started)
            send(ws, { type: "tool", msgId, name: ev.name, summary: ev.summary });
          else pendingTools.push({ name: ev.name, summary: ev.summary });
        } else if (ev.type === "skip") {
          silent = true;
        } else if (ev.type === "error") {
          ensureStarted();
          full += `${full ? "\n" : ""}[Error] ${ev.message}`;
          send(ws, { type: "error", msgId, message: ev.message });
        }
      }
    } catch (err) {
      ensureStarted();
      const m = err instanceof Error ? err.message : String(err);
      full += `${full ? "\n" : ""}[Error] ${m}`;
      send(ws, { type: "error", msgId, message: m });
    }
    // Silent turn (skip) or empty output → drop it entirely.
    if (silent || !started) return null;
    const agentMsg: ChatMessage = {
      id: msgId,
      role: "agent",
      text: full,
      agentId: instance.instanceId,
      name: instance.name,
      ts: Date.now(),
    };
    send(ws, { type: "end", msgId, message: agentMsg });
    return agentMsg;
  }

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  return httpServer;
}

/** A session keeps its default title until the human's first message names it. */
function isDefaultTitle(title: string): boolean {
  return !title?.trim() || title.trim() === "New Session";
}

/** Derive a short session title from the first user message. */
function deriveSessionTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 24 ? `${oneLine.slice(0, 24)}…` : oneLine;
}

/**
 * @mention → those agents reply (directed: they must answer). No (matching)
 * @mention → broadcast to all agents (not directed: each may skip).
 */
function resolveTargets(
  session: Session,
  text: string,
): { targets: AgentInstance[]; directed: boolean } {
  const tokens = [...text.matchAll(/@(\S+)/g)].map((m) => m[1].toLowerCase());
  if (tokens.length > 0) {
    const matched = session.agents.filter((a) =>
      tokens.some(
        (t) => a.name.toLowerCase() === t || a.name.toLowerCase().startsWith(t),
      ),
    );
    if (matched.length > 0) return { targets: matched, directed: true };
  }
  return { targets: session.agents, directed: false }; // broadcast to everyone
}

/** Map the stored chat log to the engine-facing group transcript (drops UI-only system notices). */
function toTranscript(messages: ChatMessage[]): GroupMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "agent")
    .map((m) =>
      m.role === "agent"
        ? {
            id: m.id,
            speaker: m.name ?? "agent",
            selfId: m.agentId,
            text: m.text,
          }
        : { id: m.id, speaker: "User", text: m.text },
    );
}

function normalizeSnapshot(body: any): AgentSnapshot {
  const identityMd =
    body?.identity?.markdown ??
    body?.identityMd ??
    body?.identity?.systemPrompt ??
    "You are a helpful character in White Square.";
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
    catchphrases: Array.isArray(body.catchphrases)
      ? body.catchphrases.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [],
    skills: Array.isArray(body.skills) ? body.skills : [],
    model: body.model,
    runtime: body.runtime || DEFAULT_RUNTIME,
    meta: body.meta,
  };
}

function send(ws: WebSocket, obj: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
