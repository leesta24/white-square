import type { AgentSnapshot } from "./types.ts";

/**
 * Authoritative resolution of a snapshot's identity markdown from its
 * back-compat dual fields. Single source of truth so storage and runtimes agree
 * on what the agent actually sees.
 */
export function resolveIdentityMarkdown(s: AgentSnapshot): string {
  return s.identity.markdown ?? s.identity.systemPrompt ?? "";
}
