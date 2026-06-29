# White Square

> 用 **snapshot** 定义 agent（identity / memory / skill），注入运行时即可快速生成可对话的自定义 agent；本地像素风 UI 里把多个 agent 拉进同一个 chat session 群聊。未来可分享自己定义的 agent。

## 这是什么

一个**面向"agent 角色"的定义、生成与群聊**的开源项目。核心资产是一份可移植的 **White Square**——声明式描述一个 agent 的人设、初始记忆和技能。把 snapshot 注入运行时（本地进程，或未来的远端 sandbox），就能动态生成一个 agent 实例。

跟现有项目的区别（一句话）：
- **OpenHands** 让 agent 替你写代码 → 我们让你定义并分享 agent 角色。
- **Letta** 主打记忆工程的开发者基础设施 → 我们主打消费级、可群聊、可分享的体感（像素风 UI + agent group）。
- **Agentman** 是 DevOps 式 CLI → 我们有完整的本地 UI 和群聊交互。

## MVP 范围

1. 本地启动的像素动画风格 UI。
2. 用户编辑 White Square → 生成 agent 实例。
3. Chat 页面：分 session，每个 session 可 include 不同的 agent 子集，做多 agent 群聊。
4. Runtime memory 持久化在 host 本地，预定义（seed）与运行时（runtime）记忆分层存储、分层注入。

明确**不在** MVP：远端 sandbox 部署、web 分享、复杂的多 agent 自动编排。这些留好扩展口子，但不实现。

## 快速开始

```bash
npm install
npm run dev      # 同时起 host(:4319) + ui(:5173)
```

浏览器打开 **http://localhost:5173**。

- **没配任何 LLM key** → 自动进 **echo 模式**（回显，验证全流程不需要 key）。
- **真实对话**：配任意一个 provider 的 key，引擎自动切到 pi。两种配法：
  - **页面里配**（推荐）：UI 顶部 **Settings** 标签 → 粘贴对应 provider 的 key → 保存，实时生效、重启保留（存 `./.data/secrets.json`，gitignore + 权限 600）。
  - **环境变量**：`ANTHROPIC_API_KEY=... npm run dev`（见下表）。UI 配的会覆盖环境变量。

### 支持的 provider / 模型

给内置 pi 引擎用。设对应环境变量即可（设了哪个就能用哪个）：

| Provider | 模型 | 环境变量 |
|---|---|---|
| **Claude** (Anthropic) | Sonnet 4.6 / Opus 4.8 / Haiku 4.5 | `ANTHROPIC_API_KEY` |
| **GPT** (OpenAI) | GPT-5.1 / GPT-5 Pro / GPT-4o | `OPENAI_API_KEY` |
| **GLM** (Z.ai / 智谱) | GLM-5.2 / 5.1 / 4.7 | `ZAI_API_KEY` |
| **DeepSeek** | V4 Pro / V4 Flash | `DEEPSEEK_API_KEY` |
| **Vercel AI Gateway** | 上面所有模型（一个 key 路由） | `AI_GATEWAY_API_KEY` |

```bash
# 直连某家：
ANTHROPIC_API_KEY=sk-ant-... npm run dev
# 或用 Vercel 网关，一个 key 全都能调：
AI_GATEWAY_API_KEY=... npm run dev
```

在 **Agents** 编辑器里给每个 snapshot 选模型（按 provider 分组，未配 key 的会标 ⚠️）。底层都走 [pi-ai](https://github.com/earendil-works/pi) 原生 provider；模型清单见 `packages/core/src/models.ts`。

数据（snapshots / memory / sessions）落在 `./.data/`，删掉即重置。

用法：**Agents** 标签建/编辑 snapshot → **Chat** 标签新建会话 → 右侧把 agent 拉进来 → 多个 agent 时用 `@名字` 点名。

## 技术选型（已定）

- **Agent 运行时**：`AgentRuntime` 可插拔抽象。MVP 默认实现基于 [`@earendil-works/pi-agent-core`](https://github.com/earendil-works/pi)（复用其 agent loop / 工具调用 / skills / Session 持久化 / context compaction）；**引擎可替换**，未来可换成用户本地的 Claude Code / Codex。
- **LLM provider**：经由 pi 底层 `pi-ai`，天然多 provider。
- **换引擎不重写 memory**：host memory 包成 MCP server（`remember`/`recall`），任何支持 MCP 的引擎复用。
- **运行位置**：本地进程为默认；sandbox（E2B 等）作为同一接口的另一实现，后置。

## 文档

- [设计文档](docs/design.md) — 产品形态、核心概念、架构决策。
- [技术方案](docs/tech-design.md) — snapshot schema、注入契约、memory 分层、模块划分。

## 素材

像素素材来自 [Kenney](https://kenney.nl)（**CC0**，公共领域）：
- `Tiny Town` — 小镇地块（草地/房子/树/栅栏）
- `Tiny Dungeon` — 角色形象

License 文件随素材放在 `packages/ui/public/assets/*/License.txt`。

## License

MIT（待定）
