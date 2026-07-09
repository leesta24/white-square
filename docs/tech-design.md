# 技术方案 — White Square

状态：草案 v0.1 · 最后更新 2026-06-29

承接 [design.md](./design.md)。本文定 snapshot schema、注入契约、memory 分层落地、模块划分。**末尾「开放问题」是需要 Lest 拍板的点。**

---

## 1. 依赖底座：pi-agent-core

复用 [`@earendil-works/pi-agent-core`](https://github.com/earendil-works/pi)（MIT）。已核对的关键类型：

```ts
// pi 提供
interface Skill { name: string; description: string; content: string; filePath: string; disableModelInvocation?: boolean }
interface AgentState { systemPrompt: string; model: Model; tools: AgentTool[]; /* ... */ }
class Agent { constructor(opts: { initialState: AgentState }); prompt(text): ...; subscribe(cb) }
class Session  // append-only 状态树，通过 storage.appendEntry(entry) 持久化；可插拔 storage
// 还提供：compaction（上下文压缩 + branch summary）、jsonl-repo / memory-repo
```

映射关系：

| 我们的概念 | pi 落点 |
|---|---|
| snapshot.identity | `AgentState.systemPrompt`（+ system-prompt provider） |
| snapshot.skills | `Skill[]` 注入 `AgentState.tools` / skills 资源 |
| runtime memory | `Session` + **自定义 storage**（写回 host） |
| 不全量注入 | pi `compaction` + 我们的 memory index |
| 多 LLM provider | 底层 `pi-ai` |

## 2. White Square Schema（草案）

单文件、自包含、可序列化。文件名 `*.agent.json`（或 yaml）。

```jsonc
{
  "schemaVersion": "0.1",
  "id": "uuid",                      // snapshot 唯一 id
  "name": "像素猫娘",
  "avatar": "pixel-cat.png",         // 像素头像（UI 用）
  "identity": {
    "systemPrompt": "你是……",        // 直接映射 pi systemPrompt
    "persona": { "tone": "……", "background": "……" }  // 结构化，可拼进 prompt
  },
  "skills": [
    { "name": "web_search", "ref": "builtin:web_search" },   // 引用内置/外部 skill
    { "name": "diary", "description": "...", "content": "..." } // 或内联 pi Skill
  ],
  "model": { "provider": "anthropic", "id": "claude-..." },   // 默认模型，可被 host 覆盖
  "meta": { "author": "...", "createdAt": "...", "license": "..." }
}
```

设计原则：
- **可移植**：分享时整份文件带走，不依赖 host 私有状态。
- **skill 用引用 + 内联两种**：引用内置 skill（`builtin:`）保持文件小；内联用于自定义。
- **不含 runtime memory**：snapshot 是「出厂态」，runtime memory 单独存（§4）。

## 3. 注入契约（Snapshot → AgentRuntime）

`AgentRuntime` 是**可插拔抽象**，封装两根轴——「用哪个 agent 引擎」和「跑在哪」。pi-agent-core 只是默认实现，用户可换成本地的 Codex / Claude Code。host 上层只依赖这个接口，不感知具体引擎/位置。

```ts
interface AgentRuntime {
  spawn(snapshot: AgentSnapshot, ctx: SpawnContext): Promise<AgentRuntimeHandle>;
}
interface SpawnContext {
  sessionId: string;
  memory: MemoryEndpoint;   // host 侧 memory 的访问入口（见 §3.2），引擎无关
}
interface AgentRuntimeHandle {
  prompt(input: string): AsyncIterable<AgentEvent>;  // 归一化的流式事件
  dispose(): Promise<void>;
}
```

### 3.1 实现矩阵
大部分引擎本身是本地的，所以是扁平的实现列表而非 N×M 矩阵：

| 实现 | 引擎 | 位置 | 状态 |
|---|---|---|---|
| `PiLocalRuntime` | pi-agent-core | 本地进程 | **MVP** |
| `PiSandboxRuntime` | pi-agent-core | E2B sandbox | 未来 |
| `ClaudeCodeRuntime` | 用户本地 Claude Code | 本地 CLI | 未来 |
| `CodexRuntime` | 用户本地 Codex | 本地 CLI | 未来 |

**MVP 只实现 `PiLocalRuntime`，但把接缝留干净。** Codex/Claude Code adapter 以后再接。

### 3.2 引擎无关的契约：snapshot + file-based memory
换引擎时，两样东西不动：
1. **AgentSnapshot**：identity / seed / skills，纯数据。
2. **file-based memory**：md 文件（§4.1）+ prompt 注入的 memory index。pi 由 host 包一层 `remember`/`recall` 原生 AgentTool 读写这些文件（现状）；Claude Code / Codex 本身就有文件工具，注入 memory index 后直接读写同一批 memory files，无需任何额外协议层。

### 3.3 引擎适配器(adapter)的职责（很薄）
每个 adapter 只负责把引擎无关的契约翻译成该引擎的原生机制：

| 契约 | pi-agent-core | Claude Code | Codex |
|---|---|---|---|
| identity + memory index | `AgentState.systemPrompt` | `CLAUDE.md` / system prompt | `AGENTS.md` |
| skills | `Skill[]` → tools | skills / tools | tools |
| memory 读写 | 原生 AgentTool（remember/recall） | 自带文件工具直接读写 memory files | 自带文件工具直接读写 memory files |
| 输出流 | pi events → 归一化 `AgentEvent` | CLI 流 → 归一化 | CLI 流 → 归一化 |

以 `PiLocalRuntime` 为例，注入时组装 `AgentState`：
```
systemPrompt = identity.systemPrompt + memoryIndex(global + session)  // index 而非全量
tools        = resolveSkills(snapshot.skills) + [remember, recall]
model        = host 覆盖值 ?? snapshot.model
Session       = new Session({ storage: HostMemoryStorage(sessionId, agentId) })
```

## 4. Memory 框架落地（核心）

**source of truth = host。** Runtime 通过接口读写，**write-through 实时回写**，不等 session 结束。
**主动权全在 agent**：框架只提供 scope + 工具 + 持久化 + index 注入，agent 自己决定存哪读哪。无人工「固化」步骤。

### 4.1 存储布局（local provider）
```
~/.white-square/
  snapshots/<snapshotId>.agent.json     # 出厂态，含 identity / skills / model
  memory/
    <agentId>/
      global.md                          # agent 主动写的跨 session 记忆（append-only）
      sessions/<sessionId>.md            # session scope（per agent+session，append-only）
  sessions/<sessionId>.json              # 群聊会话：包含哪些 agent、消息树
```
- **session**：`sessions/<sessionId>.md`，per (agent, session) 隔离。
- **global**：`global.md`，per agent 全局；由 agent 调 `remember({scope:"global"})` 主动写入。
- **载体：每个 scope 一个 markdown 文件**（不是一条一条的 jsonl）——人可读、可直接编辑。`remember` 往文件尾追加一个 `## <时间戳>` section（含可选 `Tags:` 行）。文件内的 section 是**逻辑条目**：读取侧按 `##` 解析出逐条 entry（id / tags / 摘要），供 index 与 recall 使用。载体是整文件，粒度是条目。

### 4.2 记忆工具（agent 的主动权）
注入给 agent 两个工具：
```ts
remember({ content: string, scope: "session" | "global", tags?: string[] })  // 写
recall({ query: string, scope?: "session" | "global" })                     // 读，按需取全量
```
agent 自己判断：值得长期记 → `scope:"global"`；只这次有用 → `scope:"session"`。

### 4.3 持久化机制：MemoryStore = provider 接口
**`MemoryStore` 接口就是 memory provider 的契约**（`remember` / `recall` / `index`）。存储载体在哪，是 provider 实现的事，上层（工具注入、index 渲染、host 路由）只依赖接口：

| provider | 载体 | 状态 |
|---|---|---|
| `FileMemoryStore`（local provider） | host 本地文件系统的 md 文件（§4.1） | MVP 唯一实现 |
| sandbox provider | sandbox filesystem 里的 md 文件 | 未来 |
| 远端 provider | 云端存储 / DB | 未来 |

**source of truth 在 provider**，write-through 实时落盘，不等 session 结束。换 provider 只换 `MemoryStore` 实现，工具定义、index 注入、md 格式都不动。

> **引擎怎么接入**：pi 跑在 host 进程内，由 host 把 MemoryStore 包成原生 AgentTool（现状）。未来接 Claude Code / Codex 时不走额外协议——它们自带文件工具，host 注入 memory index 后让它们**直接读写同一批 memory files** 即可。file-based 本身就是引擎无关的契约。

### 4.4 不全量注入（Lest 第 2 点要求）
runtime memory **不整段塞进 context**。注入时只放：
- **memory index**：**每条 entry**（md 文件里的每个 section）的 `{id, 摘要, tags}` 列表（便宜、token 可控）放进 system prompt。不是每个 scope 一行。
- agent 看 index 觉得需要细节 → 调 `recall` 按需取回，`recall` 按 entry 粒度匹配（query 命中 content 或 **tags**），只返回命中的条目，不是整个文件。

session scope 的内容随对话自然在 context 里；配合 pi 自带 `compaction`，context 长了自动压缩历史，进一步控 token。

> 这条让 agent「知道有哪些记忆 + 去哪读」，而不是被全量记忆撑爆 context。

## 5. 模块划分（MVP）

```
white-square/
  packages/
    core/         # snapshot schema、AgentRuntime 接口、MemoryStore（provider 契约）、契约类型
    runtime-pi/   # PiLocalRuntime（基于 pi-agent-core）— MVP 唯一引擎实现
    host/         # 本地服务：HTTP/WS API、snapshot/memory/session 存储、群聊路由
    ui/           # 像素风前端（snapshot 编辑器 + 群聊）
  docs/
```
- 未来引擎适配器各自成包：`runtime-claudecode/`、`runtime-codex/`、`runtime-pi` 的 sandbox 变体。**MVP 不做**，但 `core` 的 `AgentRuntime` 接口为它们留好接缝。
- memory 接入不需要独立的协议包：未来引擎（Claude Code / Codex）用自带文件工具直接读写 memory files（见 §4.3）。
- group chat 编排逻辑放 `host`：MVP 只做 @点名路由（解析 `@name` → 路由给对应 agent handle）。

## 6. 技术栈（已定）
- 语言：**TypeScript 全栈**（pi 是 TS，复用最顺）。
- UI：**React + 像素风组件库**（NES.css / RPGUI 这类），动画靠 CSS/sprite。
- Snapshot 格式：**JSON**（`*.agent.json`）。
- Host 服务：Node（与 pi 同运行时，可直接 `import` pi）。
- 群聊发言：**@点名路由**（解析 `@name` → 路由给对应 agent，只有被点的回）。
- MVP skill：**只做 `recall`**（按需取回 memory），其余后置。
- **LLM provider**（给内置 pi 引擎用）：复用 pi-ai 原生 provider，集中清单在 `packages/core/src/models.ts`（`PROVIDER_CATALOG` + `MODEL_CATALOG`，参考 guace 的实现）。支持 **Claude / GPT / GLM(zai) / DeepSeek**，以及 **Vercel AI Gateway**（一个 `AI_GATEWAY_API_KEY` 路由所有模型）。key 按 provider 从 env 读，`getModel(provider, id)` 解析；snapshot 的 `model:{provider,id}` 指定，host `GET /api/models` 暴露清单+可用性，UI 分组选择。

## 7. 里程碑（粗）
1. **M1 schema + core**：定 snapshot schema、`AgentRuntime`/`MemoryStore` 接口。
2. **M2 单 agent 跑通**：`PiLocalRuntime` + 一个 snapshot → CLI 能对话、memory 落盘。
3. **M3 群聊**：host + 多 agent + @点名 + 分 session。
4. **M4 像素 UI**：snapshot 编辑器 + chat。
5. **M5 打磨 memory 分层**：index 注入 + recall 工具 + promoted 固化。

---

## 决策记录

已定（2026-06-29）：
- **UI**：React + 像素风组件库。
- **Snapshot 格式**：JSON。
- **群聊默认发言**：@点名（只有被点的 agent 回）。
- **MVP skill**：只做 `recall`。

- **Memory 框架**：scope = session / global；主动权交给 agent，通过 `remember` / `recall` 工具自决存读，无人工固化。

仍待 Lest 拍板：
- **Q6. 项目名 / License**：仓库名暂用 `white-square`，正式名定了吗？License 用 MIT？
