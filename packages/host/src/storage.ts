import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type AgentSnapshot,
  resolveIdentityMarkdown,
} from "@white-square/core";

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

export interface MemoryFile {
  scope: "global" | "session";
  path: string;
  sessionId?: string;
  sessionTitle?: string;
  content: string;
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
  private memoryDir(id: string) {
    return join(this.dataDir, "memory", id);
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
    const snapshot = await this.readJson<AgentSnapshot>(
      join(this.snapDir(), `${id}.json`),
    );
    return snapshot ? this.withMarkdownDocs(snapshot) : undefined;
  }
  async saveSnapshot(s: AgentSnapshot): Promise<AgentSnapshot> {
    const normalized = normalizeMarkdownSnapshot(s);
    await mkdir(this.profileDir(normalized.id), { recursive: true });
    await writeFile(
      join(this.profileDir(normalized.id), "identity.md"),
      resolveIdentityMarkdown(normalized),
      "utf8",
    );
    await rm(join(this.profileDir(normalized.id), "seed-memory.md"), {
      force: true,
    });
    await writeFile(
      join(this.snapDir(), `${normalized.id}.json`),
      JSON.stringify(normalized, null, 2),
      "utf8",
    );
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
    await writeFile(
      join(this.sessDir(), `${s.id}.json`),
      JSON.stringify(s, null, 2),
      "utf8",
    );
    return s;
  }
  async deleteSession(id: string): Promise<void> {
    await rm(join(this.sessDir(), `${id}.json`), { force: true });
  }

  async listMemoryFiles(snapshotId: string): Promise<MemoryFile[]> {
    const base = this.memoryDir(snapshotId);
    const sessions = await this.listSessions();
    const files: MemoryFile[] = [
      {
        scope: "global",
        path: join(base, "global.md"),
        content: (await this.readText(join(base, "global.md"))) ?? "",
      },
    ];
    for (const session of sessions) {
      if (!session.agents.some((a) => a.snapshotId === snapshotId)) continue;
      const path = join(base, "sessions", `${session.id}.md`);
      files.push({
        scope: "session",
        path,
        sessionId: session.id,
        sessionTitle: session.title,
        content: (await this.readText(path)) ?? "",
      });
    }
    return files;
  }

  async saveMemoryFile(
    snapshotId: string,
    input: { scope: "global" | "session"; content: string; sessionId?: string },
  ): Promise<MemoryFile> {
    const path =
      input.scope === "global"
        ? join(this.memoryDir(snapshotId), "global.md")
        : join(this.memoryDir(snapshotId), "sessions", `${input.sessionId}.md`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.content, "utf8");
    return {
      scope: input.scope,
      path,
      sessionId: input.sessionId,
      content: input.content,
    };
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

  private async withMarkdownDocs(
    snapshot: AgentSnapshot,
  ): Promise<AgentSnapshot> {
    const identity = await this.readText(
      join(this.profileDir(snapshot.id), "identity.md"),
    );
    return normalizeMarkdownSnapshot({
      ...snapshot,
      identity: {
        ...snapshot.identity,
        markdown: identity ?? resolveIdentityMarkdown(snapshot),
      },
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
  const identity = resolveIdentityMarkdown(s);
  const {
    seedMemoryMd: _seedMemoryMd,
    seedMemory: _seedMemory,
    ...rest
  } = s as AgentSnapshot & {
    seedMemoryMd?: unknown;
    seedMemory?: unknown;
  };
  return {
    ...rest,
    identity: {
      ...s.identity,
      markdown: identity,
      systemPrompt: identity,
    },
  };
}
