import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
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
 * Runtime memory is markdown too; remember() appends sections, recall() reads.
 */
export class FileMemoryStore implements MemoryStore {
  private readonly globalPath: string;
  private readonly sessionPath: string;

  constructor(
    dataDir: string,
    _snapshot: unknown,
    agentId: string,
    sessionId: string,
  ) {
    const memoryBase = join(dataDir, "memory", agentId);
    this.globalPath = join(memoryBase, "global.md");
    this.sessionPath = join(memoryBase, "sessions", `${sessionId}.md`);
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

  async recall(input: {
    query?: string;
    scope?: MemoryScope;
  }): Promise<MemoryItem[]> {
    const all = await this.loadAll(input.scope);
    if (!input.query) return all;
    const q = input.query.toLowerCase();
    // MVP retrieval: substring over content + tags. Good enough; swap for
    // embeddings later without changing the interface.
    return all.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.path?.toLowerCase().includes(q),
    );
  }

  async index(): Promise<MemoryIndexEntry[]> {
    // Keep this cheap: inject a short summary per scope, not full markdown.
    const items = await this.loadAll();
    return items.map((m) => ({
      scope: m.scope,
      summary: summarizeMarkdown(m.content),
    }));
  }

  private async loadAll(scope?: MemoryScope): Promise<MemoryItem[]> {
    const out: MemoryItem[] = [];
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

function summarizeMarkdown(content: string): string {
  const line = content
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith("#"));
  if (!line) return "(empty)";
  return line.length > 100 ? `${line.slice(0, 100)}...` : line;
}
