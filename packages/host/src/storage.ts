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
  private sessDir() {
    return join(this.dataDir, "sessions");
  }

  async init() {
    await mkdir(this.snapDir(), { recursive: true });
    await mkdir(this.sessDir(), { recursive: true });
  }

  // ---- snapshots ----
  async listSnapshots(): Promise<AgentSnapshot[]> {
    return this.readDir<AgentSnapshot>(this.snapDir());
  }
  async getSnapshot(id: string): Promise<AgentSnapshot | undefined> {
    return this.readJson<AgentSnapshot>(join(this.snapDir(), `${id}.json`));
  }
  async saveSnapshot(s: AgentSnapshot): Promise<AgentSnapshot> {
    await writeFile(join(this.snapDir(), `${s.id}.json`), JSON.stringify(s, null, 2), "utf8");
    return s;
  }
  async deleteSnapshot(id: string): Promise<void> {
    await rm(join(this.snapDir(), `${id}.json`), { force: true });
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
}
