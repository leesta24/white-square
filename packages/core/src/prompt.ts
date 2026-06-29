import type { MemoryIndexEntry } from "./types.ts";

/**
 * Render the memory index for injection into the system prompt.
 * Only an index (id + summary + tags), never full content — the agent calls
 * `recall` to fetch details on demand.
 */
export function renderMemoryIndex(entries: MemoryIndexEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map(
    (e) => `- [${e.id}] (${e.scope}${e.tags.length ? `, ${e.tags.join(",")}` : ""}) ${e.summary}`,
  );
  return [
    "## Your memory index",
    "These are things you know. Use the `recall` tool with an id or query to read the full content.",
    ...lines,
    "Use `remember` to store new facts: scope `longterm` to keep across all conversations, `session` for just this one.",
  ].join("\n");
}
