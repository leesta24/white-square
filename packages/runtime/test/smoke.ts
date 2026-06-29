import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSnapshot, FileMemoryStore } from "@white-square/core";
import { EchoRuntime, PiLocalRuntime, selectRuntime } from "../src/index.ts";

const snapshot: AgentSnapshot = {
  schemaVersion: "0.1",
  id: "test-agent",
  name: "测试猫",
  identity: { systemPrompt: "你是一只爱帮忙的像素猫娘，说话简短。" },
  seedMemory: [{ id: "seed-1", content: "主人叫 Lest", tags: ["fact"] }],
  skills: [],
};

const dataDir = await mkdtemp(join(tmpdir(), "white-square-smoke-"));
const sessionId = "s1";
const memory = new FileMemoryStore(dataDir, snapshot, snapshot.id, sessionId);

console.log("== Stage 1: MemoryStore ==");
await memory.remember({ content: "Lest 在做一个 agent snapshot 开源项目", scope: "longterm", tags: ["project"] });
const recalled = await memory.recall({ query: "项目" });
console.log("recall '项目':", recalled.map((m) => `${m.scope}:${m.content}`));
const idx = await memory.index();
console.log("index:", idx);
if (idx.length < 2) throw new Error("index should include seed + longterm");

console.log("\n== Stage 2: runtime stream (turn-based group chat) ==");
const runtime = selectRuntime();
console.log("selected runtime mode:", runtime.mode);

const turn = {
  sessionId,
  agentId: snapshot.id,
  selfInstanceId: "inst-1",
  selfName: snapshot.name,
  memory,
  transcript: [{ speaker: "用户", text: "你好" }],
};

// Echo path always works (no key needed).
const echo = new EchoRuntime();
let out = "";
for await (const ev of echo.respond(snapshot, turn)) {
  if (ev.type === "text") out += ev.delta;
  if (ev.type === "error") throw new Error("echo error: " + ev.message);
}
console.log("echo reply:", out);
if (!out.includes("你好")) throw new Error("echo should reference last message");

// Real path only if a key is present.
if (process.env.ANTHROPIC_API_KEY) {
  console.log("\n-- pi (real LLM, with a 2nd speaker in transcript) --");
  const pi = new PiLocalRuntime();
  let real = "";
  for await (const ev of pi.respond(snapshot, {
    ...turn,
    transcript: [
      { speaker: "用户", text: "大家好" },
      { speaker: "禁欲猫头鹰", selfId: "inst-2", text: "嗯，专注当下。" },
      { speaker: "用户", text: "猫娘你怎么看？" },
    ],
  })) {
    if (ev.type === "text") real += ev.delta;
    if (ev.type === "tool") console.log("[tool]", ev.name);
    if (ev.type === "error") throw new Error("pi error: " + ev.message);
  }
  console.log("pi reply:", real);
} else {
  console.log("\n(skip pi real test — no ANTHROPIC_API_KEY)");
}

console.log("\n✅ smoke passed. dataDir:", dataDir);
