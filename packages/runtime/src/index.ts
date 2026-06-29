import { type AgentRuntime, allProviderEnvVars } from "@white-square/core";
import { EchoRuntime } from "./echo-runtime.ts";
import { PiLocalRuntime } from "./pi-runtime.ts";

export { PiLocalRuntime } from "./pi-runtime.ts";
export { EchoRuntime } from "./echo-runtime.ts";

/** Pick the engine: pi when any provider key is set, else the echo fallback. */
export function selectRuntime(): AgentRuntime {
  const hasKey = allProviderEnvVars().some((name) => process.env[name]?.trim());
  return hasKey ? new PiLocalRuntime() : new EchoRuntime();
}
