import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentSnapshot,
  MemoryIndexEntry,
  MemoryItem,
  MemoryScope,
  MemoryStore,
} from "./types.ts";

/**
 * File-backed MemoryStore. Source of truth on the host.
 *
 * Layout (per agent, under dataDir/memory/<agentId>/):
 *   longterm.jsonl              cross-session, agent-written
 *   sessions/<sessionId>.jsonl  per (agent, session)
 *
 * Seed memory comes from the snapshot (read-only) and is never written here,
 * so resetting an agent = delete its memory dir; the snapshot is untouched.
 */
export class FileMemoryStore implements MemoryStore {
  private readonly seed: MemoryItem[];
  private readonly longtermPath: string;
  private readonly sessionPath: string;

  constructor(dataDir: string, snapshot: AgentSnapshot, agentId: string, sessionId: string) {
    this.seed = snapshot.seedMemory.map((m) => ({
      id: m.id,
      scope: "seed" as const,
      content: m.content,
      tags: m.tags ?? [],
      createdAt: 0,
    }));
    const base = join(dataDir, "memory", agentId);
    this.longtermPath = join(base, "longterm.jsonl");
    this.sessionPath = join(base, "sessions", `${sessionId}.jsonl`);
  }

  async remember(input: {
    content: string;
    scope: "session" | "longterm";
    tags?: string[];
  }): Promise<MemoryItem> {
    const item: MemoryItem = {
      id: randomUUID(),
      scope: input.scope,
      content: input.content,
      tags: input.tags ?? [],
      createdAt: Date.now(),
    };
    const path = input.scope === "longterm" ? this.longtermPath : this.sessionPath;
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(item)}\n`, "utf8");
    return item;
  }

  async recall(input: { query?: string; scope?: MemoryScope }): Promise<MemoryItem[]> {
    const all = await this.loadAll(input.scope);
    if (!input.query) return all;
    const q = input.query.toLowerCase();
    // MVP retrieval: substring over content + tags. Good enough; swap for
    // embeddings later without changing the interface.
    return all.filter(
      (m) => m.content.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  async index(): Promise<MemoryIndexEntry[]> {
    // Index excludes raw session chatter; injects seed + longterm so the agent
    // knows what it knows and can recall() details on demand.
    const items = await this.loadAll();
    return items
      .filter((m) => m.scope !== "session")
      .map((m) => ({
        id: m.id,
        scope: m.scope,
        summary: m.content.length > 80 ? `${m.content.slice(0, 80)}…` : m.content,
        tags: m.tags,
      }));
  }

  private async loadAll(scope?: MemoryScope): Promise<MemoryItem[]> {
    const out: MemoryItem[] = [];
    if (!scope || scope === "seed") out.push(...this.seed);
    if (!scope || scope === "longterm") out.push(...(await this.readJsonl(this.longtermPath)));
    if (!scope || scope === "session") out.push(...(await this.readJsonl(this.sessionPath)));
    return out;
  }

  private async readJsonl(path: string): Promise<MemoryItem[]> {
    try {
      const raw = await readFile(path, "utf8");
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as MemoryItem);
    } catch (err: any) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
  }
}
