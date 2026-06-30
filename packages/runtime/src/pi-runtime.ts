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
  resolveIdentityMarkdown,
  type TurnContext,
} from "@white-square/core";
import { AsyncQueue } from "./async-queue.ts";
import { memoryTools, skipTool } from "./tools.ts";

/** Agent engine backed by pi-agent-core. Stateless per turn: the host feeds the
 *  full group transcript each time, so every agent sees the whole conversation. */
export class PiLocalRuntime implements AgentRuntime {
  readonly mode = "pi";

  respond(
    snapshot: AgentSnapshot,
    turn: TurnContext,
  ): AsyncIterable<AgentEvent> {
    const q = new AsyncQueue<AgentEvent>();
    void this.run(snapshot, turn, q);
    return q;
  }

  private async run(
    snapshot: AgentSnapshot,
    turn: TurnContext,
    q: AsyncQueue<AgentEvent>,
  ) {
    let errored = false;
    const pushError = (message: string) => {
      if (errored) return;
      errored = true;
      q.push({ type: "error", message });
    };

    // Broadcast turns may stay silent; @mentioned (directed) turns must answer.
    const directed = turn.directed ?? false;
    let skipped = false;
    let skipReason: string | undefined;
    let sawText = false;

    try {
      const indexEntries = await turn.memory.index();
      const systemPrompt = buildSystemPrompt(
        snapshot,
        renderMemoryIndex(indexEntries),
        directed,
        turn.cast ?? [],
        turn.selfName,
      );

      const m = turn.model ?? snapshot.model ?? DEFAULT_MODEL;
      const model = getModel(m.provider as any, m.id as any);
      if (!model) throw new Error(`Unknown model: ${m.provider}/${m.id}`);

      // Resume this agent's own transcript (incl. its past tool calls) instead of
      // rebuilding statelessly, then ingest only the group messages that arrived
      // since it last responded. The last new foreign message is the trigger.
      const saved = await turn.conversation.load();
      const restored = (saved?.state as any[]) ?? [];
      const all = turn.transcript;
      const wmIdx = saved?.watermark
        ? all.findIndex((x) => x.id === saved.watermark)
        : -1;
      const fresh =
        wmIdx >= 0 ? all.slice(wmIdx + 1) : saved ? all.slice(-1) : all;
      const freshForeign = fresh.filter(
        (x) => x.selfId !== turn.selfInstanceId,
      );
      const last = freshForeign[freshForeign.length - 1];
      const triggerText = last ? renderForeign(last) : "(continue)";
      const priorMessages = [
        ...restored,
        ...freshForeign
          .slice(0, -1)
          .map((msg) => ({
            role: "user",
            content: renderForeign(msg),
            timestamp: Date.now(),
          })),
      ];

      const tools = directed
        ? memoryTools(turn.memory)
        : [...memoryTools(turn.memory), skipTool()];

      const agent = new Agent({
        initialState: {
          systemPrompt,
          model,
          tools,
          messages: priorMessages as any,
        },
        getApiKey: (provider: string) => apiKeyForProvider(provider),
        sessionId: turn.sessionId,
        // The skip tool ends the loop gracefully *after* its tool result is
        // finalized (terminate), so the transcript stays well-formed for resume.
        afterToolCall: async (ctx) => {
          if (ctx.toolCall.name === "skip") {
            skipped = true;
            skipReason = (ctx.args as { reason?: string } | undefined)?.reason;
            return { terminate: true };
          }
          return undefined;
        },
      });

      const unsub = agent.subscribe((event) => {
        switch (event.type) {
          case "message_update":
            if (event.assistantMessageEvent?.type === "text_delta") {
              sawText = true;
              q.push({
                type: "text",
                delta: event.assistantMessageEvent.delta,
              });
            }
            break;
          case "message_end":
            if (
              (event.message as any)?.role === "assistant" &&
              (event.message as any)?.errorMessage
            ) {
              pushError((event.message as any).errorMessage);
            }
            break;
          case "tool_execution_start":
            // `skip` is internal orchestration, not a visible action.
            if (event.toolName === "skip") break;
            q.push({
              type: "tool",
              name: event.toolName,
              summary: `calling ${event.toolName}`,
            });
            break;
        }
      });

      try {
        await agent.prompt(triggerText);
        if ((agent as any).state?.errorMessage)
          pushError((agent as any).state.errorMessage);
      } finally {
        unsub();
      }

      // A deliberate skip with no text is a silent turn: tell the host to drop it.
      if (skipped && !sawText) q.push({ type: "skip", reason: skipReason });

      // Persist resume state + watermark (last group message we ingested), so the
      // next turn continues from here — including after a skip, so this message
      // won't re-trigger the agent. Skip persistence on error to retry cleanly.
      if (!errored) {
        const watermark = all.length
          ? all[all.length - 1].id
          : (saved?.watermark ?? "");
        await turn.conversation.save({
          watermark,
          state: agent.state.messages,
        });
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

function buildSystemPrompt(
  snapshot: AgentSnapshot,
  memoryBlock: string,
  directed: boolean,
  cast: string[],
  selfName: string,
): string {
  const systemInstructions = [
    "## System Instructions",
    "### Message Labels",
    "Incoming messages may be prefixed with a speaker label.",
    "`[User] ...` is the human user's message.",
    "`[Name] ...` is another character's message.",
    "Your own prior assistant messages are provided without a speaker prefix.",
    "Use these labels to understand who said what, especially in multi-character conversations.",
    "",
    "### Memory Policy",
    "Memory is exposed through tools, not through host file paths.",
    "Use session memory for information that is useful only in this chat: the current task, temporary constraints, decisions made in this session, working notes, unresolved questions, and short-lived user preferences.",
    "Use global memory only for stable information that should carry across future sessions for this character: durable user preferences, recurring project facts, long-term relationships, standing instructions, and facts the user explicitly asks you to remember.",
    "When unsure, prefer session memory. Promote something to global memory only when it is clearly durable or the user asks for persistence.",
    "Do not store trivial small talk, throwaway phrasing, secrets/API keys, sensitive personal data, or facts the user did not intend you to preserve.",
    "Use recall before relying on memory when the short memory index is not enough, and mention memory only when it is relevant to the reply.",
  ].join("\n");
  // Only broadcast (non-directed) turns get the option to stay silent. Give the
  // agent the roster so it can judge whether someone else should take the message.
  const rosterLine = cast.length
    ? `The characters currently in this chat are: ${cast.join(", ")} (you are ${selfName}).`
    : "";
  const groupPolicy = directed
    ? ""
    : [
        "### Group Chat — Speaking vs. Staying Silent",
        rosterLine,
        "This message was not addressed to anyone by name. Decide whether you specifically are the right one to respond.",
        "If another character present is clearly a better fit for this message, or you have nothing meaningful to add, call the `skip` tool to stay silent instead of forcing a reply.",
        "Staying silent is normal and usually better than adding noise. Reply only when you genuinely have something to say.",
      ]
        .filter(Boolean)
        .join("\n");
  const identityMd = resolveIdentityMarkdown(snapshot);
  return [identityMd, systemInstructions, groupPolicy, memoryBlock]
    .filter(Boolean)
    .join("\n\n");
}
