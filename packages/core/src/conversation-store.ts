import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConversationSnapshot, ConversationStore } from "./types.ts";

/**
 * File-backed conversation persistence, one JSON file per (agent, session):
 *   dataDir/conversations/<agentId>/<sessionId>.json
 *
 * Holds the engine's opaque resume state plus the ingest watermark, so an agent
 * can continue across turns with its own tool-call history intact.
 */
export class FileConversationStore implements ConversationStore {
  private readonly path: string;

  constructor(dataDir: string, agentId: string, sessionId: string) {
    this.path = join(dataDir, "conversations", agentId, `${sessionId}.json`);
  }

  async load(): Promise<ConversationSnapshot | undefined> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as ConversationSnapshot;
    } catch (err: any) {
      if (err?.code === "ENOENT") return undefined;
      throw err;
    }
  }

  async save(snapshot: ConversationSnapshot): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(snapshot), "utf8");
  }
}
