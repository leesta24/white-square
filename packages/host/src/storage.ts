import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSnapshot } from "@white-square/core";

export interface AgentInstance {
  instanceId: string;
  snapshotId: string;
  name: string;
  sprite?: string;
  avatar?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  agentId?: string; // instanceId for agent messages
  name?: string;
  ts: number;
}

export interface Session {
  id: string;
  title: string;
  agents: AgentInstance[];
  messages: ChatMessage[];
  createdAt: number;
}

/** Flat JSON-file storage under dataDir. */
export class Storage {
  private readonly dataDir: string;
  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private snapDir() {
    return join(this.dataDir, "snapshots");
  }
  private profileDir(id: string) {
    return join(this.dataDir, "profiles", id);
  }
  private sessDir() {
    return join(this.dataDir, "sessions");
  }

  async init() {
    await mkdir(this.snapDir(), { recursive: true });
    await mkdir(join(this.dataDir, "profiles"), { recursive: true });
    await mkdir(this.sessDir(), { recursive: true });
  }

  // ---- snapshots ----
  async listSnapshots(): Promise<AgentSnapshot[]> {
    const snapshots = await this.readDir<AgentSnapshot>(this.snapDir());
    return Promise.all(snapshots.map((s) => this.withMarkdownDocs(s)));
  }
  async getSnapshot(id: string): Promise<AgentSnapshot | undefined> {
    const snapshot = await this.readJson<AgentSnapshot>(join(this.snapDir(), `${id}.json`));
    return snapshot ? this.withMarkdownDocs(snapshot) : undefined;
  }
  async saveSnapshot(s: AgentSnapshot): Promise<AgentSnapshot> {
    const normalized = normalizeMarkdownSnapshot(s);
    await mkdir(this.profileDir(normalized.id), { recursive: true });
    await writeFile(join(this.profileDir(normalized.id), "identity.md"), identityMarkdown(normalized), "utf8");
    await writeFile(join(this.profileDir(normalized.id), "seed-memory.md"), seedMarkdown(normalized), "utf8");
    await writeFile(join(this.snapDir(), `${normalized.id}.json`), JSON.stringify(normalized, null, 2), "utf8");
    return normalized;
  }
  async deleteSnapshot(id: string): Promise<void> {
    await rm(join(this.snapDir(), `${id}.json`), { force: true });
    await rm(this.profileDir(id), { recursive: true, force: true });
  }

  // ---- sessions ----
  async listSessions(): Promise<Session[]> {
    return this.readDir<Session>(this.sessDir());
  }
  async getSession(id: string): Promise<Session | undefined> {
    return this.readJson<Session>(join(this.sessDir(), `${id}.json`));
  }
  async saveSession(s: Session): Promise<Session> {
    await writeFile(join(this.sessDir(), `${s.id}.json`), JSON.stringify(s, null, 2), "utf8");
    return s;
  }
  async deleteSession(id: string): Promise<void> {
    await rm(join(this.sessDir(), `${id}.json`), { force: true });
  }

  private async readDir<T>(dir: string): Promise<T[]> {
    const files = await readdir(dir).catch(() => [] as string[]);
    const out: T[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const v = await this.readJson<T>(join(dir, f));
      if (v) out.push(v);
    }
    return out;
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (err: any) {
      if (err?.code === "ENOENT") return undefined;
      throw err;
    }
  }

  private async withMarkdownDocs(snapshot: AgentSnapshot): Promise<AgentSnapshot> {
    const identity = await this.readText(join(this.profileDir(snapshot.id), "identity.md"));
    const seed = await this.readText(join(this.profileDir(snapshot.id), "seed-memory.md"));
    return normalizeMarkdownSnapshot({
      ...snapshot,
      identity: {
        ...snapshot.identity,
        markdown: identity ?? identityMarkdown(snapshot),
      },
      seedMemoryMd: seed ?? seedMarkdown(snapshot),
    });
  }

  private async readText(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT") return undefined;
      throw err;
    }
  }
}

function normalizeMarkdownSnapshot(s: AgentSnapshot): AgentSnapshot {
  const identity = identityMarkdown(s);
  const seed = seedMarkdown(s);
  return {
    ...s,
    identity: {
      ...s.identity,
      markdown: identity,
      systemPrompt: identity,
    },
    seedMemoryMd: seed,
    seedMemory: [{ id: "seed-memory.md", content: seed, tags: ["seed"] }],
  };
}

function identityMarkdown(s: AgentSnapshot): string {
  return s.identity.markdown ?? s.identity.systemPrompt ?? "";
}

function seedMarkdown(s: AgentSnapshot): string {
  if (s.seedMemoryMd !== undefined) return s.seedMemoryMd;
  return (s.seedMemory ?? []).map((m) => m.content).join("\n\n");
}
