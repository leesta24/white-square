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
 *   global.md                  cross-session, agent-written
 *   sessions/<sessionId>.md    per (agent, session)
 *
 * Identity and seed memory are markdown docs under dataDir/profiles/<agentId>/.
 * Runtime memory is markdown too; remember() appends sections, recall() reads.
 */
export class FileMemoryStore implements MemoryStore {
  private readonly identityPath: string;
  private readonly seedPath: string;
  private readonly globalPath: string;
  private readonly sessionPath: string;
  private readonly seedContent: string;

  constructor(dataDir: string, snapshot: AgentSnapshot, agentId: string, sessionId: string) {
    const profileBase = join(dataDir, "profiles", agentId);
    const memoryBase = join(dataDir, "memory", agentId);
    this.identityPath = join(profileBase, "identity.md");
    this.seedPath = join(profileBase, "seed-memory.md");
    this.globalPath = join(memoryBase, "global.md");
    this.sessionPath = join(memoryBase, "sessions", `${sessionId}.md`);
    this.seedContent = seedMemoryMarkdown(snapshot);
  }

  async remember(input: {
    content: string;
    scope: "global" | "session";
    tags?: string[];
  }): Promise<MemoryItem> {
    const path = input.scope === "global" ? this.globalPath : this.sessionPath;
    const title = input.scope === "global" ? "Global memory" : "Session memory";
    const stamp = new Date().toISOString();
    const tags = input.tags?.length ? `\nTags: ${input.tags.join(", ")}` : "";
    const entry = `\n\n## ${stamp} - ${title}${tags}\n\n${input.content.trim()}\n`;
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, entry, "utf8");
    return {
      id: input.scope === "global" ? "global.md" : "session.md",
      scope: input.scope,
      path,
      content: input.content,
      tags: input.tags ?? [],
      createdAt: Date.now(),
    };
  }

  async recall(input: { query?: string; scope?: MemoryScope }): Promise<MemoryItem[]> {
    const all = await this.loadAll(input.scope);
    if (!input.query) return all;
    const q = input.query.toLowerCase();
    // MVP retrieval: substring over content + tags. Good enough; swap for
    // embeddings later without changing the interface.
    return all.filter((m) => m.content.toLowerCase().includes(q) || m.path?.toLowerCase().includes(q));
  }

  async index(): Promise<MemoryIndexEntry[]> {
    // Keep this cheap: inject paths and short summaries, not full markdown.
    const items = await this.loadAll();
    return items.map((m) => ({
      id: m.id,
      scope: m.scope,
      path: m.path,
      summary: summarizeMarkdown(m.content),
      tags: m.tags,
    }));
  }

  private async loadAll(scope?: MemoryScope): Promise<MemoryItem[]> {
    const out: MemoryItem[] = [];
    if (!scope || scope === "seed") {
      out.push({
        id: "seed-memory.md",
        scope: "seed",
        path: this.seedPath,
        content: await this.readMd(this.seedPath, this.seedContent),
        tags: ["seed"],
        createdAt: 0,
      });
    }
    if (!scope || scope === "global") {
      out.push({
        id: "global.md",
        scope: "global",
        path: this.globalPath,
        content: await this.readMd(this.globalPath, ""),
        tags: ["global"],
        createdAt: 0,
      });
    }
    if (!scope || scope === "session") {
      out.push({
        id: "session.md",
        scope: "session",
        path: this.sessionPath,
        content: await this.readMd(this.sessionPath, ""),
        tags: ["session"],
        createdAt: 0,
      });
    }
    return out;
  }

  private async readMd(path: string, fallback: string): Promise<string> {
    try {
      return await readFile(path, "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT") return fallback;
      throw err;
    }
  }
}

function seedMemoryMarkdown(snapshot: AgentSnapshot): string {
  if (snapshot.seedMemoryMd !== undefined) return snapshot.seedMemoryMd;
  return (snapshot.seedMemory ?? []).map((m) => m.content).join("\n\n");
}

function summarizeMarkdown(content: string): string {
  const line = content
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith("#"));
  if (!line) return "(empty)";
  return line.length > 100 ? `${line.slice(0, 100)}...` : line;
}
