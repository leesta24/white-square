# 设计文档 — White Square

状态：草案 v0.1 ·  最后更新 2026-06-29

本文定义产品形态、核心概念和关键架构决策。技术细节见 [tech-design.md](./tech-design.md)。

---

## 1. 一句话定位

> 不是又一个 agent 框架，而是 **"agent 角色的定义、生成与群聊"** ——像分享 persona 一样定义和分享 agent。

差异点（护城河）：
- **消费级体感**：像素动画 UI，而非专业控制台。
- **agent group 群聊**：一个 session 拉进多个 agent，是现有项目（OpenHands / Letta / Agentman 都是单 agent 干活视角）没占的位。
- **snapshot 即资产**：自包含、可移植、未来可分享。

## 2. 核心概念

### 2.1 White Square
声明式描述一个 agent，是项目最核心的资产。两个核心维度：

| 维度 | 内容 | 可变性 |
|---|---|---|
| **identity** | 人设、背景、说话风格 → 映射 system prompt | 随 snapshot，定义后基本不变 |
| **skill** | agent 可用的技能/工具引用 | 随 snapshot |

Snapshot 是**可序列化的单文件**（参考 Letta `.af` 的思路），未来分享的就是它。

### 2.2 Agent 实例
把 snapshot 注入 runtime 后生成的运行中的 agent。实例有自己的 **runtime memory**（运行时产生、可写、持久化在 host）。同一个 snapshot 可生成多个实例。

### 2.3 Session（群聊会话）
一次群聊。一个 session 可 `include` 多个 agent 实例。不同 session 可包含不同的 agent 子集。

### 2.4 Memory 框架（关键设计）
核心理念：**框架只定义「有哪些存储位置、怎么存怎么读」，主动权全部交给 agent**——agent 自己判断什么内容存哪个 scope、去哪个 scope 读。没有「用户手动固化」这类人工干预。

**两个 scope（agent 写入时自己选）：**

| scope | 来源 | 可变 | 作用域 | 注入策略 |
|---|---|---|---|---|
| **session** | agent 运行时写入 | 是 | per (agent, session) | 对话自然在 context，超长靠 compaction |
| **global** | agent 运行时写入 | 是 | per agent 全局（跨 session） | index 进 context，细节按需 `recall` |

**agent 拿到两个工具，主动权全在它：**
- `remember({ content, scope, tags })` — agent 决定**存哪**（session / global）。
- `recall({ query, scope? })` — agent 决定**读哪**，按需取回全量。

> Lest 的明确要求（2026-06-29）：runtime memory 不全量塞进 context；平时只注入 index（`id + 摘要 + tags`），agent 需要细节时自己调 `recall`。

设计要点：
- **session 学到的默认不污染别的 session**（session scope 隔离）。需要跨 session 永久记住的，agent 主动写进 `global`——像人判断「这事记一辈子」还是「聊完算了」。
- **identity 承载出厂人设**；memory 只保存运行时产生的可写内容。
- **memory provider 可插拔**：`MemoryStore` 接口是 provider 契约，「memory 存在哪」是实现细节。MVP 是 local file provider（host 本地 md 文件，每个 scope 一个文件，文件内按 section 分条目）；未来可换 sandbox filesystem、远端存储等 provider，上层工具与注入逻辑不动。

## 3. 架构总览

```
┌─────────────────────────────────────────────┐
│  本地像素风 UI (浏览器)                          │
│  · Snapshot 编辑器   · Chat / 群聊             │
└───────────────┬─────────────────────────────┘
                │ HTTP / WS
┌───────────────▼─────────────────────────────┐
│  Host 服务 (本地)                              │
│  · Snapshot 存储   · Memory 存储 (source of    │
│  · Session 管理      truth, md files)          │
│  · AgentRuntime 抽象 ───────┐                  │
└─────────────────────────────┼─────────────────┘
        注入 snapshot + memory index │ memory files 读写
                  ┌─────────────▼─────────────────┐
                  │  AgentRuntime（可插拔引擎）      │
                  ├───────────────────────────────┤
                  │ PiLocalRuntime (MVP, pi)       │
                  │ PiSandboxRuntime  (未来, +E2B)  │
                  │ ClaudeCodeRuntime (未来, 本地)   │
                  │ CodexRuntime      (未来, 本地)   │
                  └───────────────────────────────┘
```
两根轴都可插拔：**用哪个引擎**（pi / Claude Code / Codex）× **跑在哪**（本地 / sandbox）。snapshot 与 file-based memory 是引擎无关的契约，换引擎不动。

### 关键决策

**D1. Memory 的 source of truth 在 host。** Runtime 只是（可能易失的）算力。Runtime memory 在运行时产生，但通过 pi 的可插拔 Session repo **write-through 实时回写 host**，不等 session 结束（sandbox 可能等不到）。

**D2. 本地 MVP 不上 sandbox。** Runtime 直接跑在 host 本地进程。Sandbox（E2B）作为 `AgentRuntime` 的另一实现，是「跑不可信的、别人分享的 snapshot」时才需要的高阶玩法。**现在只留接口，不实现。**（Lest 2026-06-29 确认）

**D3. `AgentRuntime` 是可插拔接口，引擎可替换。** 不止「跑在哪」可换（本地/sandbox），「用哪个 agent 引擎」也可换：pi-agent-core 是 MVP 默认实现，用户未来可换成本地的 Claude Code / Codex。host 上层只依赖 `AgentRuntime` 接口，不感知具体引擎与位置。**MVP 只实现 `PiLocalRuntime`，但接缝留干净。**（Lest 2026-06-29 确认）

**D4. 换引擎不重写 memory：memory 始终是 file-based。** 记忆的引擎无关契约就是「md 文件 + prompt 里的 memory index」：pi 引擎由 host 注入 `remember`/`recall` 工具读写这些文件（MVP 现状）；未来接 Claude Code / Codex 时同样注入 memory index，它们用自带的文件工具直接读写同一批 memory files 即可，**不需要 MCP 之类的额外协议层**。引擎适配器只做薄翻译：identity+index → 该引擎的 prompt 机制，skills → 该引擎的 tools，输出流 → 归一化 `AgentEvent`。

**D5. 复用 pi-agent-core 而非自研 agent loop。** 作为 MVP 引擎，它的 Session 抽象（append-only + 可插拔 repo）承载 memory 持久化；skills 承载 skill；system-prompt 承载 identity；compaction 承载「不全量注入」。

**D6. Group chat 编排 MVP 最简。** 不做 orchestrator agent、不做自动 turn-taking 仲裁。MVP 只做最简发言策略（见下）。

## 4. Group Chat 交互（MVP）

一个 session 内多个 agent。发言策略：
- **不 @ 点名 → 广播**：所有在场 agent 依次回复。
- **@点名** → 只有被点的 agent 回（输入框打 `@` 有自动补全，支持部分名字过滤）。
- 同一个 snapshot 不能重复加进一个会话（去重）。

**真群聊（关键）**：host 持有完整会话记录（source of truth），**每轮把整段对话（带 `[发言人]` 标签，含其他 agent 的发言）重新喂给当前发言的 agent**，所以 agent 之间**互相看得见、能接话**。每个 agent 视角：别人的话是 `[名字] xxx`（user 角色），自己的历史发言是 assistant 角色，systemPrompt 里说明它是谁、在群聊里。

> 这是「agent group 群聊」区别于「多个独立一对一」的核心。已用真实 LLM 验证（被点名的 agent 会直呼前一个 agent 的名字接话）。

复杂编排（agent 自动决定谁说话、多轮自发往返）仍是 v2。

## 5. 范围边界

**MVP 做：** 本地 UI（像素风）、snapshot 编辑与生成、分 session 群聊、memory 三层分离与持久化、@点名发言。

**MVP 不做：** 远端 sandbox、web 分享、agent 间自动编排、权限/安全沙箱、多人协作。

## 6. 待决策（需 Lest 拍板）

见 [tech-design.md](./tech-design.md) 末尾「开放问题」。
