import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  MemoryIndexEntry,
  MemoryItem,
  MemoryScope,
  MemoryStore,
} from "./types.ts";

/**
 * Local-file memory provider. `MemoryStore` is the provider contract; this
 * implementation keeps the source of truth on the host filesystem. Future
 * providers (sandbox fs, remote storage) implement the same interface.
 *
 * Layout (per agent, under dataDir/memory/<agentId>/):
 *   global.md                  cross-session, agent-written
 *   sessions/<sessionId>.md    per (agent, session)
 *
 * Each scope is one human-editable markdown file; `remember()` appends a
 * `## <timestamp>` section (with an optional `Tags:` line). Sections are the
 * logical entries: reads parse them back out so index/recall work per entry.
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
    const stamp = new Date().toISOString();
    const tags = input.tags?.length ? `\nTags: ${input.tags.join(", ")}` : "";
    const entry = `\n\n## ${stamp}${tags}\n\n${input.content.trim()}\n`;
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, entry, "utf8");
    const entries = await this.loadScope(input.scope);
    return {
      id: entryId(input.scope, entries.length - 1),
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
    // MVP retrieval: substring over content + tags, per entry. Good enough;
    // swap for embeddings later without changing the interface.
    return all.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  async index(): Promise<MemoryIndexEntry[]> {
    // Keep this cheap: one {id, summary, tags} line per entry, never full content.
    const items = await this.loadAll();
    return items.map((m) => ({
      id: m.id,
      scope: m.scope,
      summary: summarize(m.content),
      tags: m.tags,
    }));
  }

  private async loadAll(scope?: MemoryScope): Promise<MemoryItem[]> {
    const out: MemoryItem[] = [];
    if (!scope || scope === "global") out.push(...(await this.loadScope("global")));
    if (!scope || scope === "session") out.push(...(await this.loadScope("session")));
    return out;
  }

  private async loadScope(scope: MemoryScope): Promise<MemoryItem[]> {
    const path = scope === "global" ? this.globalPath : this.sessionPath;
    const raw = await this.readMd(path);
    return parseEntries(raw).map((e, i) => ({
      id: entryId(scope, i),
      scope,
      path,
      content: e.content,
      tags: e.tags,
      createdAt: e.createdAt,
    }));
  }

  private async readMd(path: string): Promise<string> {
    try {
      return await readFile(path, "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT") return "";
      throw err;
    }
  }
}

function entryId(scope: MemoryScope, index: number): string {
  return `${scope}-${index + 1}`;
}

interface ParsedEntry {
  content: string;
  tags: string[];
  createdAt: number;
}

/**
 * Parse a memory markdown file into entries, one per `## ` section. Tolerant
 * of hand-edited files: text before the first heading becomes its own entry,
 * and the `Tags:` line is optional.
 */
function parseEntries(raw: string): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  const blocks = raw.split(/^## /m);
  for (const [i, block] of blocks.entries()) {
    if (!block.trim()) continue;
    let header = "";
    let body = block;
    if (i > 0) {
      const nl = block.indexOf("\n");
      header = (nl === -1 ? block : block.slice(0, nl)).trim();
      body = nl === -1 ? "" : block.slice(nl + 1);
    }
    const tags: string[] = [];
    const lines = body.split("\n");
    const firstText = lines.findIndex((l) => l.trim());
    if (firstText !== -1 && /^tags:/i.test(lines[firstText].trim())) {
      const listed = lines[firstText].trim().slice("tags:".length);
      tags.push(...listed.split(",").map((t) => t.trim()).filter(Boolean));
      lines.splice(firstText, 1);
    }
    const content = lines.join("\n").trim();
    if (!content && !header) continue;
    const stamp = Date.parse(header.split(" ")[0] ?? "");
    out.push({
      content: content || header,
      tags,
      createdAt: Number.isNaN(stamp) ? 0 : stamp,
    });
  }
  return out;
}

function summarize(content: string): string {
  const line = content
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith("#"));
  if (!line) return "(empty)";
  return line.length > 100 ? `${line.slice(0, 100)}...` : line;
}
