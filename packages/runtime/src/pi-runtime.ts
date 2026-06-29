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
      if (!model) throw new Error(`未知模型: ${m.provider}/${m.id}（不在 pi-ai 目录里）`);

      // All but the last transcript message become prior history; the last one
      // is the prompt that triggers this agent's response.
      const prior = turn.transcript.slice(0, -1).map((msg) => toLlmMessage(msg, turn.selfInstanceId));
      const last = turn.transcript[turn.transcript.length - 1];
      const triggerText = last ? renderForeign(last) : "(继续)";

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
    `你正在一个群聊房间里，房间里有多个角色。对话中以 [发言人] 开头的是别人（用户或其他 agent）说的话；没有前缀的是你自己（${turn.selfName}）之前的发言。`,
    `请以 ${turn.selfName} 的身份自然参与对话：可以回应别人、也可以跟其他 agent 互动；不要复述别人的话，不要在自己的回复前加 [${turn.selfName}] 前缀。`,
  ].join("\n");
  return [snapshot.identity.systemPrompt, groupNote, memoryBlock].filter(Boolean).join("\n\n");
}
