import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MemoryItem, MemoryStore } from "@white-square/core";
import { type Static, Type } from "typebox";

const rememberSchema = Type.Object({
  content: Type.String({ description: "The fact or note to store." }),
  scope: Type.Union([Type.Literal("global"), Type.Literal("session")], {
    description:
      "global stores stable cross-session memory; session stores memory only for the current chat session.",
  }),
  tags: Type.Optional(
    Type.Array(Type.String(), { description: "Short tags for retrieval." }),
  ),
});

const recallSchema = Type.Object({
  query: Type.Optional(
    Type.String({
      description: "Keyword/substring to search memories. Omit to list all.",
    }),
  ),
  scope: Type.Optional(
    Type.Union([Type.Literal("global"), Type.Literal("session")], {
      description: "Restrict to a memory scope. Omit to search all.",
    }),
  ),
});

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

const skipSchema = Type.Object({
  reason: Type.Optional(
    Type.String({ description: "Brief note on why you're staying silent (for logs)." }),
  ),
});

/** Lets an agent bow out of a group-chat turn. The runtime ends the loop on this
 *  call (afterToolCall → terminate), and the host drops the turn entirely. */
export function skipTool(): AgentTool {
  const skip: AgentTool<typeof skipSchema> = {
    name: "skip",
    label: "Skip",
    description:
      "Stay silent this turn. Call this when you have nothing meaningful to add, or a reply would just be noise.",
    parameters: skipSchema,
    execute: async () => ({ ...text("(staying silent)"), details: null }),
  };
  return skip as AgentTool;
}

/** Wrap the host MemoryStore as pi tools so the agent controls store/recall. */
export function memoryTools(memory: MemoryStore): AgentTool[] {
  const remember: AgentTool<typeof rememberSchema> = {
    name: "remember",
    label: "Remember",
    description:
      "Store a concise memory note. Use scope `global` for stable cross-session facts/preferences, or `session` for context that should only apply to the current chat session.",
    parameters: rememberSchema,
    execute: async (_id: string, params: Static<typeof rememberSchema>) => {
      const item = await memory.remember(params);
      const safe = sanitizeMemoryItem(item);
      return { ...text(`Stored in ${item.scope} memory.`), details: safe };
    },
  };

  const recall: AgentTool<typeof recallSchema> = {
    name: "recall",
    label: "Recall",
    description:
      "Read memory by optional keyword query and/or scope. Use scope `global` for cross-session memory, or `session` for the current chat session memory.",
    parameters: recallSchema,
    execute: async (_id: string, params: Static<typeof recallSchema>) => {
      const items = await memory.recall(params);
      if (items.length === 0)
        return { ...text("No matching memories."), details: [] };
      const safe = items.map(sanitizeMemoryItem);
      const body = safe
        .map((m) => `[${m.id}] (${m.scope}) ${m.content}`)
        .join("\n");
      return { ...text(body), details: safe };
    },
  };

  return [remember as AgentTool, recall as AgentTool];
}

function sanitizeMemoryItem(item: MemoryItem): Omit<MemoryItem, "path"> {
  const { path: _path, ...safe } = item;
  return safe;
}
