// Engine-agnostic contracts shared across the project.

export type MemoryScope = "global" | "session";

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
  /** Short plaza barks. One line is one phrase in the profile editor. */
  catchphrases?: string[];
  skills: SkillRef[];
  model?: ModelRef;
  /** Agent runtime (harness) id from RUNTIME_CATALOG. Defaults to "pi". */
  runtime?: string;
  meta?: {
    author?: string;
    createdAt?: string;
    license?: string;
  };
}

// ---- Runtime contracts ----

/**
 * One entry of the memory index injected into the system prompt: one line per
 * memory entry, `{id, summary, tags}` — never full content. Host-internal
 * fields like file path are not exposed here.
 */
export interface MemoryIndexEntry {
  id: string;
  scope: MemoryScope;
  summary: string;
  tags: string[];
}

/**
 * Memory provider contract. Where memory lives is the provider's concern —
 * the MVP provider is local files on the host (FileMemoryStore); future
 * providers (sandbox fs, remote storage) implement the same interface.
 * Source of truth lives in the provider, write-through on every remember.
 */
export interface MemoryStore {
  remember(input: {
    content: string;
    scope: "global" | "session";
    tags?: string[];
  }): Promise<MemoryItem>;
  recall(input: { query?: string; scope?: MemoryScope }): Promise<MemoryItem[]>;
  /** Cheap, token-bounded listing for context injection. */
  index(): Promise<MemoryIndexEntry[]>;
}

/** Normalized streaming event surfaced to the host, engine-independent. */
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; summary: string }
  /** The agent chose not to respond this turn (group chat). Host drops the turn. */
  | { type: "skip"; reason?: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** One message in the shared group-chat transcript. */
export interface GroupMessage {
  /** Stable id of the source message; used as the per-agent ingest watermark. */
  id: string;
  /** Display name of the speaker; "用户" for the human. */
  speaker: string;
  /** Agent instance id when spoken by an agent; absent for the human. */
  selfId?: string;
  text: string;
}

/**
 * Engine-owned conversation state, persisted by the host per (agent, session).
 * Lets an agent resume across turns with its full transcript — including its own
 * tool calls — instead of being rebuilt statelessly each turn. The `state` blob
 * is opaque to the host; each engine decides its own shape (pi stores its
 * AgentMessage[]). A future Claude Code / Codex runtime reuses the same seam.
 */
export interface ConversationSnapshot {
  /** Id of the last group message this agent has already ingested. */
  watermark: string;
  /** Opaque engine state, e.g. pi's AgentMessage[]. */
  state: unknown;
}

export interface ConversationStore {
  load(): Promise<ConversationSnapshot | undefined>;
  save(snapshot: ConversationSnapshot): Promise<void>;
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
  /** Cross-turn conversation persistence for this (agent, session). */
  conversation: ConversationStore;
  /**
   * True when this turn was addressed to the agent directly (@mention). When
   * false (broadcast), the engine may let the agent skip rather than reply.
   */
  directed?: boolean;
  /**
   * Display names of all characters currently in the session (including self).
   * Lets a broadcasting agent decide whether someone else is better placed to
   * answer instead of skipping blind.
   */
  cast?: string[];
  model?: { provider: string; id: string };
  transcript: GroupMessage[];
}

/** Pluggable agent engine. pi-agent-core is the MVP implementation. */
export interface AgentRuntime {
  readonly mode: string; // e.g. "pi" | "echo"
  respond(
    snapshot: AgentSnapshot,
    turn: TurnContext,
  ): AsyncIterable<AgentEvent>;
}
