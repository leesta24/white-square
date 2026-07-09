import type { MemoryIndexEntry } from "./types.ts";

/**
 * Render the memory index for injection into the system prompt.
 * Only an index (id + summary + tags), never full content — the agent calls
 * `recall` to fetch details on demand.
 */
export function renderMemoryIndex(entries: MemoryIndexEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => {
    const tags = e.tags.length ? ` [${e.tags.join(", ")}]` : "";
    return `- ${e.id} (${labelForScope(e.scope)})${tags} — ${e.summary}`;
  });
  return [
    "## Memory Index",
    "You have access to global memory and session memory through tools.",
    "This is only a short index. Use `recall` when you need the full memory content.",
    ...lines,
  ].join("\n");
}

function labelForScope(scope: MemoryIndexEntry["scope"]): string {
  if (scope === "global") return "global memory";
  return "session memory";
}
