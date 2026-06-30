import type { MemoryIndexEntry } from "./types.ts";

/**
 * Render the memory index for injection into the system prompt.
 * Only an index (id + summary + tags), never full content — the agent calls
 * `recall` to fetch details on demand.
 */
export function renderMemoryIndex(entries: MemoryIndexEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map(
    (e) => `- ${e.scope}: ${e.path ?? e.id} — ${e.summary}`,
  );
  return [
    "## Markdown memory files",
    "Your identity, seed memory, global memory, and session memory are markdown documents on the host.",
    "Use `recall` with a scope or filename-like query to read a markdown file.",
    "Use `remember` to append new notes: scope `longterm` writes global.md, scope `session` writes this session's md.",
    ...lines,
  ].join("\n");
}
