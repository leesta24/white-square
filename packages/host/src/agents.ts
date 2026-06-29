import { FileMemoryStore, type GroupMessage, resolveEngineModel } from "@white-square/core";
import type { AgentEvent, AgentRuntime } from "@white-square/core";
import type { AgentInstance, Storage } from "./storage.ts";

/**
 * Stateless per-turn responder. The host owns the transcript and feeds the full
 * group conversation to whichever agent is responding, so agents see each other.
 * Picks the engine per turn: pi when the model's provider has a key, else echo.
 */
export class AgentManager {
  private readonly storage: Storage;
  private readonly pi: AgentRuntime;
  private readonly echo: AgentRuntime;
  private readonly dataDir: string;

  constructor(storage: Storage, pi: AgentRuntime, echo: AgentRuntime, dataDir: string) {
    this.storage = storage;
    this.pi = pi;
    this.echo = echo;
    this.dataDir = dataDir;
  }

  async *respond(
    sessionId: string,
    instance: AgentInstance,
    transcript: GroupMessage[],
  ): AsyncIterable<AgentEvent> {
    const snapshot = await this.storage.getSnapshot(instance.snapshotId);
    if (!snapshot) throw new Error(`snapshot not found: ${instance.snapshotId}`);

    const resolved = resolveEngineModel(snapshot.model);
    if (resolved.error) throw new Error(resolved.error);
    const runtime = resolved.engine === "pi" ? this.pi : this.echo;

    const memory = new FileMemoryStore(this.dataDir, snapshot, snapshot.id, sessionId);
    yield* runtime.respond(snapshot, {
      sessionId,
      agentId: snapshot.id,
      selfInstanceId: instance.instanceId,
      selfName: instance.name,
      memory,
      model: resolved.model,
      transcript,
    });
  }
}
