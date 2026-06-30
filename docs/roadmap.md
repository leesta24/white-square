# Dev Roadmap — White Square MVP

状态：MVP 完成（echo 模式端到端验证）· 目标：本地 UI 能看、基本功能可用，交 Lest 验收试用。

每个 Stage 有**可验证 checkpoint**。按顺序做，做完一个验证一个。

---

## 技术基线
- **TypeScript 全栈**，Node v25 原生跑 `.ts`（type-stripping），后端无需打包。
- **monorepo**：npm workspaces，`packages/*`。
- UI：**React + Vite + NES.css**（像素风），WebSocket 收流式回复。
- Agent 引擎：**pi-agent-core**（`PiLocalRuntime`）。无 LLM key 时回退 **`EchoRuntime`**，保证 UI/流程可验证。

## Stage 0 ✅ — Monorepo 脚手架
- 根 `package.json`(workspaces) + `tsconfig.base.json`。
- 四个包：`core` / `runtime` / `host` / `ui`。
- ✅ checkpoint：`npm install` 成功；`npm run dev` 能同时起 host + ui，浏览器打开 ui 空壳页。

## Stage 1 ✅ — `core`（契约层）
- Snapshot TS 类型 + JSON 校验。
- `MemoryStore`：文件实现（session / global），`remember` / `recall`。
- `remember` / `recall` 的 pi `AgentTool` 定义。
- `AgentRuntime` 接口。
- ✅ checkpoint：`node` 跑一段脚本，能 `remember` 写入、`recall` 读回、memory index 生成。

## Stage 2 ✅ — `runtime`（引擎层）
- `PiLocalRuntime.spawn(snapshot, ctx)`：组装 `AgentState`（systemPrompt + memory index + tools + model + getApiKey），返回 `prompt()` 流式 handle。
- `EchoRuntime`：无 key 回退，回显 + 标注 mock 模式。
- ✅ checkpoint：echo 模式可手动验证；有 provider key 时真实对话 + agent 能调 `remember`/`recall`。

## Stage 3 ✅ — `host`（服务层）
- HTTP + WebSocket 服务。
- 存储：snapshots、sessions（群聊会话：含哪些 agent、消息）。
- REST：snapshot CRUD、session CRUD、给 session include/remove agent。
- 群聊 **@点名路由**：解析 `@name` → 路由给对应 agent，流式回 WS。
- 内置 2-3 个示例 snapshot。
- ✅ checkpoint：curl 建 snapshot/session，ws 发 `@xxx 你好` 收到流式回复。

## Stage 4 ✅ — `ui`（像素风前端）
- 两个页面：
  - **Snapshot 编辑器**：列表 / 新建 / 编辑（identity、skills、model、像素头像）。
  - **Chat**：session 列表、往 session 里 include agent、@点名群聊、流式气泡。
- NES.css 像素风 + 简单 sprite 动画。
- ✅ checkpoint：**localhost 打开，能建/选 snapshot，开 session 拉 agent，@点名对话看到回复**。← Lest 验收点

## Stage 5 — Memory 打磨 & 收尾 ⏳（需真实 LLM key 验 recall 回路）
- memory index 注入 system prompt；`recall` 真实回路；global 跨 session 验证。
- 重置 agent（丢 memory 目录）。
- 错误态：无 key 提示、provider 报错提示。
- ✅ checkpoint：跨 session 让 agent 记住一条 global memory，新 session 里 recall 得到。

---

## 交付验收（给 Lest）
1. `ANTHROPIC_API_KEY=xxx npm run dev`（无 key 则 echo 模式）。
2. 浏览器开 `localhost:5173`。
3. 建 snapshot → 开 session → 拉 agent → @点名群聊。
4. Lest 试用 → 反馈 → 迭代调整。

## 砍出 MVP 的（明确不做）
sandbox/E2B、Claude Code/Codex 引擎、memory-mcp（MVP 用 pi 原生 AgentTool）、web 分享、agent 自动编排、权限沙箱。接缝留在 `core` 接口里。
