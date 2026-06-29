import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MemoryStore } from "@white-square/core";
import { type Static, Type } from "typebox";

const rememberSchema = Type.Object({
  content: Type.String({ description: "The fact or note to store." }),
  scope: Type.Union([Type.Literal("session"), Type.Literal("longterm")], {
    description: "longterm = remember across all future conversations; session = only this conversation.",
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
    description: "Store a memory. Choose scope: longterm (persist across conversations) or session (this conversation only).",
    parameters: rememberSchema,
    execute: async (_id: string, params: Static<typeof rememberSchema>) => {
      const item = await memory.remember(params);
      return { ...text(`Remembered (${item.scope}) [${item.id}].`), details: item };
    },
  };

  const recall: AgentTool<typeof recallSchema> = {
    name: "recall",
    label: "Recall",
    description: "Read full memory content by query/scope. Use this when the memory index shows something relevant.",
    parameters: recallSchema,
    execute: async (_id: string, params: Static<typeof recallSchema>) => {
      const items = await memory.recall(params);
      if (items.length === 0) return { ...text("No matching memories."), details: [] };
      const body = items.map((m) => `[${m.id}] (${m.scope}) ${m.content}`).join("\n");
      return { ...text(body), details: items };
    },
  };

  return [remember as AgentTool, recall as AgentTool];
}
