// Engine-agnostic contracts shared across the project.

export type MemoryScope = "seed" | "global" | "session";

/** A single memory item. */
export interface MemoryItem {
  id: string;
  scope: MemoryScope;
  /** Markdown file path on the host, when file-backed. */
  path?: string;
  /** Full content. Not always injected into context — see memory index. */
  content: string;
  /** Short tags for the index / retrieval. */
  tags: string[];
  /** Unix ms. */
  createdAt: number;
}

/** Predefined memory baked into a snapshot (read-only seed). */
export interface SeedMemory {
  id: string;
  content: string;
  tags?: string[];
}

export interface SkillRef {
  /** Stable name, model-visible. */
  name: string;
  description?: string;
  /** Inline skill instructions, or omit when using `ref`. */
  content?: string;
  /** Reference to a builtin/external skill, e.g. "builtin:recall". */
  ref?: string;
}

export interface ModelRef {
  provider: string; // e.g. "anthropic"
  id: string; // e.g. "claude-sonnet-4-20250514"
}

/** The portable, self-contained definition of an agent. */
export interface AgentSnapshot {
  schemaVersion: "0.1";
  id: string;
  name: string;
  /** Character form id (pixel sprite) shown in the plaza and as the avatar. */
  sprite?: string;
  /** Legacy emoji avatar (kept for back-compat; UI now uses `sprite`). */
  avatar?: string;
  identity: {
    /** Markdown identity document. `systemPrompt` is kept for old saved data. */
    markdown?: string;
    systemPrompt?: string;
    persona?: Record<string, string>;
  };
  /** Markdown seed memory document baked into this profile. */
  seedMemoryMd?: string;
  /** Legacy itemized seed memory. */
  seedMemory?: SeedMemory[];
  skills: SkillRef[];
  model?: ModelRef;
  meta?: {
    author?: string;
    createdAt?: string;
    license?: string;
  };
}

// ---- Runtime contracts ----

/** One entry of the memory index injected into the system prompt. */
export interface MemoryIndexEntry {
  id: string;
  scope: MemoryScope;
  path?: string;
  summary: string;
  tags: string[];
}

/** Host-side memory access. Source of truth lives on the host. */
export interface MemoryStore {
  remember(input: { content: string; scope: "global" | "session"; tags?: string[] }): Promise<MemoryItem>;
  recall(input: { query?: string; scope?: MemoryScope }): Promise<MemoryItem[]>;
  /** Cheap, token-bounded listing for context injection. */
  index(): Promise<MemoryIndexEntry[]>;
}

/** Normalized streaming event surfaced to the host, engine-independent. */
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** One message in the shared group-chat transcript. */
export interface GroupMessage {
  /** Display name of the speaker; "用户" for the human. */
  speaker: string;
  /** Agent instance id when spoken by an agent; absent for the human. */
  selfId?: string;
  text: string;
}

/**
 * One turn for one agent. The host owns the transcript (source of truth) and
 * rebuilds it each turn so every agent sees the full group conversation —
 * including other agents' messages. The last transcript item is what to
 * respond to.
 */
export interface TurnContext {
  sessionId: string;
  agentId: string; // snapshotId (memory key)
  selfInstanceId: string;
  selfName: string;
  memory: MemoryStore;
  model?: { provider: string; id: string };
  transcript: GroupMessage[];
}

/** Pluggable agent engine. pi-agent-core is the MVP implementation. */
export interface AgentRuntime {
  readonly mode: string; // e.g. "pi" | "echo"
  respond(snapshot: AgentSnapshot, turn: TurnContext): AsyncIterable<AgentEvent>;
}
