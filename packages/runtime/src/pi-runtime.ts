import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  type AgentEvent,
  type AgentRuntime,
  type AgentSnapshot,
  apiKeyForProvider,
  DEFAULT_MODEL,
  type GroupMessage,
  renderMemoryIndex,
  type TurnContext,
} from "@white-square/core";
import { AsyncQueue } from "./async-queue.ts";
import { memoryTools } from "./tools.ts";

/** Agent engine backed by pi-agent-core. Stateless per turn: the host feeds the
 *  full group transcript each time, so every agent sees the whole conversation. */
export class PiLocalRuntime implements AgentRuntime {
  readonly mode = "pi";

  respond(snapshot: AgentSnapshot, turn: TurnContext): AsyncIterable<AgentEvent> {
    const q = new AsyncQueue<AgentEvent>();
    void this.run(snapshot, turn, q);
    return q;
  }

  private async run(snapshot: AgentSnapshot, turn: TurnContext, q: AsyncQueue<AgentEvent>) {
    let errored = false;
    const pushError = (message: string) => {
      if (errored) return;
      errored = true;
      q.push({ type: "error", message });
    };

    try {
      const indexEntries = await turn.memory.index();
      const systemPrompt = buildSystemPrompt(snapshot, turn, renderMemoryIndex(indexEntries));

      const m = turn.model ?? snapshot.model ?? DEFAULT_MODEL;
      const model = getModel(m.provider as any, m.id as any);
      if (!model) throw new Error(`Unknown model: ${m.provider}/${m.id}`);

      // All but the last transcript message become prior history; the last one
      // is the prompt that triggers this agent's response.
      const prior = turn.transcript.slice(0, -1).map((msg) => toLlmMessage(msg, turn.selfInstanceId));
      const last = turn.transcript[turn.transcript.length - 1];
      const triggerText = last ? renderForeign(last) : "(continue)";

      const agent = new Agent({
        initialState: {
          systemPrompt,
          model,
          tools: memoryTools(turn.memory),
          messages: prior as any,
        },
        getApiKey: (provider: string) => apiKeyForProvider(provider),
        sessionId: turn.sessionId,
      });

      const unsub = agent.subscribe((event) => {
        switch (event.type) {
          case "message_update":
            if (event.assistantMessageEvent?.type === "text_delta") {
              q.push({ type: "text", delta: event.assistantMessageEvent.delta });
            }
            break;
          case "message_end":
            if ((event.message as any)?.role === "assistant" && (event.message as any)?.errorMessage) {
              pushError((event.message as any).errorMessage);
            }
            break;
          case "tool_execution_start":
            q.push({ type: "tool", name: event.toolName, summary: `calling ${event.toolName}` });
            break;
        }
      });

      try {
        await agent.prompt(triggerText);
        if ((agent as any).state?.errorMessage) pushError((agent as any).state.errorMessage);
      } finally {
        unsub();
      }
    } catch (err) {
      pushError(err instanceof Error ? err.message : String(err));
    } finally {
      q.push({ type: "done" });
      q.close();
    }
  }
}

/** A foreign message (human or another agent) labelled with its speaker. */
function renderForeign(msg: GroupMessage): string {
  return `[${msg.speaker}] ${msg.text}`;
}

function toLlmMessage(msg: GroupMessage, selfInstanceId: string) {
  if (msg.selfId && msg.selfId === selfInstanceId) {
    // This agent's own past turn → assistant role, no label.
    return { role: "assistant", content: [{ type: "text", text: msg.text }], timestamp: Date.now() };
  }
  return { role: "user", content: renderForeign(msg), timestamp: Date.now() };
}

function buildSystemPrompt(snapshot: AgentSnapshot, turn: TurnContext, memoryBlock: string): string {
  const groupNote = [
    `You are ${turn.selfName} in a White Square group chat.`,
    "Messages prefixed with [speaker] are from the user or another character. Your own prior assistant messages have no prefix.",
    `Reply naturally as ${turn.selfName}. Do not prefix your own reply with [${turn.selfName}].`,
    "Your identity is a markdown document. Treat memory as markdown files, not database rows.",
  ].join("\n");
  const identityMd = snapshot.identity.markdown ?? snapshot.identity.systemPrompt ?? "";
  return [identityMd, groupNote, memoryBlock].filter(Boolean).join("\n\n");
}
