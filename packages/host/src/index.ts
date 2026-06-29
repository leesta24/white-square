import { join } from "node:path";
import { availableProviders } from "@white-square/core";
import { EchoRuntime, PiLocalRuntime } from "@white-square/runtime";
import { AgentManager } from "./agents.ts";
import { SecretStore } from "./secrets.ts";
import { startServer } from "./server.ts";
import { Storage } from "./storage.ts";

const PORT = Number(process.env.PORT ?? 4319);
const dataDir = process.env.WHITE_SQUARE_DATA ?? join(process.cwd(), ".data");

const storage = new Storage(dataDir);
const secrets = new SecretStore(dataDir);
await secrets.load(); // inject any UI-configured keys into env before runtimes resolve them

const manager = new AgentManager(storage, new PiLocalRuntime(), new EchoRuntime(), dataDir);

await startServer({ storage, manager, secrets }, PORT);

const providers = [...availableProviders()];
console.log(`[host] listening on http://localhost:${PORT}`);
console.log(`[host] data dir: ${dataDir}`);
console.log(
  providers.length
    ? `[host] providers with keys: ${providers.join(", ")} → pi engine`
    : "[host] no provider key → echo mode. Configure a key in the UI (Settings) or set env, e.g. ANTHROPIC_API_KEY / AI_GATEWAY_API_KEY.",
);
