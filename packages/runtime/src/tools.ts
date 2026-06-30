import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MemoryItem, MemoryStore } from "@white-square/core";
import { type Static, Type } from "typebox";

const rememberSchema = Type.Object({
  content: Type.String({ description: "The fact or note to store." }),
  scope: Type.Union([Type.Literal("session"), Type.Literal("longterm")], {
    description: "longterm stores stable cross-session memory; session stores memory only for the current chat session.",
  }),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Short tags for retrieval." })),
});

const recallSchema = Type.Object({
  query: Type.Optional(Type.String({ description: "Keyword/substring to search memories. Omit to list all." })),
  scope: Type.Optional(
    Type.Union([Type.Literal("seed"), Type.Literal("session"), Type.Literal("longterm")], {
      description: "Restrict to a memory scope. Omit to search all.",
    }),
  ),
});

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/** Wrap the host MemoryStore as pi tools so the agent controls store/recall. */
export function memoryTools(memory: MemoryStore): AgentTool[] {
  const remember: AgentTool<typeof rememberSchema> = {
    name: "remember",
    label: "Remember",
    description: "Store a concise memory note. Use scope `longterm` for stable cross-session facts/preferences, or `session` for context that should only apply to the current chat session.",
    parameters: rememberSchema,
    execute: async (_id: string, params: Static<typeof rememberSchema>) => {
      const item = await memory.remember(params);
      const safe = sanitizeMemoryItem(item);
      return { ...text(`Stored in ${scopeLabel(item.scope)} memory.`), details: safe };
    },
  };

  const recall: AgentTool<typeof recallSchema> = {
    name: "recall",
    label: "Recall",
    description: "Read memory by optional keyword query and/or scope. Use scope `seed` for profile seed memory, `longterm` for global cross-session memory, or `session` for the current chat session memory.",
    parameters: recallSchema,
    execute: async (_id: string, params: Static<typeof recallSchema>) => {
      const items = await memory.recall(params);
      if (items.length === 0) return { ...text("No matching memories."), details: [] };
      const safe = items.map(sanitizeMemoryItem);
      const body = safe.map((m) => `[${m.id}] (${m.scope}) ${m.content}`).join("\n");
      return { ...text(body), details: safe };
    },
  };

  return [remember as AgentTool, recall as AgentTool];
}

function sanitizeMemoryItem(item: MemoryItem): Omit<MemoryItem, "path"> {
  const { path: _path, ...safe } = item;
  return safe;
}

function scopeLabel(scope: MemoryItem["scope"]): string {
  if (scope === "longterm") return "global";
  return scope;
}
