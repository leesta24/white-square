import type {
  AgentEvent,
  AgentRuntime,
  AgentSnapshot,
  TurnContext,
} from "@white-square/core";

/**
 * No-LLM fallback used when no provider API key is set. Lets the full
 * UI/host/session/memory/group-chat pipeline be exercised without a key.
 */
export class EchoRuntime implements AgentRuntime {
  readonly mode = "echo";

  async *respond(snapshot: AgentSnapshot, turn: TurnContext): AsyncIterable<AgentEvent> {
    const last = turn.transcript[turn.transcript.length - 1];
    const heard = last ? `${last.speaker} said "${last.text}"` : "(no message)";
    const reply = `(mock · ${snapshot.name}) I heard ${heard}. Configure an LLM key to make me join the square for real.`;
    for (const ch of chunk(reply, 6)) {
      yield { type: "text", delta: ch };
      await sleep(25);
    }
    yield { type: "done" };
  }
}

function* chunk(s: string, size: number): Generator<string> {
  for (let i = 0; i < s.length; i += size) yield s.slice(i, i + size);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
