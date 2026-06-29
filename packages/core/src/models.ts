// LLM provider + model catalog for the built-in pi runtime.
// Mirrors the pattern from guace (PROVIDER_CATALOG / MODEL_CATALOG → getModel).
// Keys are read from env per provider; the Vercel AI Gateway routes many models
// through a single key (AI_GATEWAY_API_KEY).

export interface ProviderEntry {
  id: string; // pi-ai provider id
  label: string;
  envVars: string[]; // any present → provider is available
  dashboardUrl: string;
}

export interface ModelEntry {
  provider: string;
  id: string; // pi-ai model id (modelName)
  label: string;
}

export const PROVIDER_CATALOG: ProviderEntry[] = [
  { id: "anthropic", label: "Claude (Anthropic)", envVars: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"], dashboardUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openai", label: "GPT (OpenAI)", envVars: ["OPENAI_API_KEY"], dashboardUrl: "https://platform.openai.com/api-keys" },
  { id: "zai", label: "GLM (Z.ai)", envVars: ["ZAI_API_KEY"], dashboardUrl: "https://z.ai/manage-apikey/apikey-list" },
  { id: "deepseek", label: "DeepSeek", envVars: ["DEEPSEEK_API_KEY"], dashboardUrl: "https://platform.deepseek.com/api_keys" },
  { id: "vercel-ai-gateway", label: "Vercel AI Gateway", envVars: ["AI_GATEWAY_API_KEY"], dashboardUrl: "https://vercel.com/dashboard/ai-gateway" },
];

export const MODEL_CATALOG: ModelEntry[] = [
  // Direct — Claude
  { provider: "anthropic", id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { provider: "anthropic", id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { provider: "anthropic", id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  // Direct — GPT
  { provider: "openai", id: "gpt-5.1", label: "GPT-5.1" },
  { provider: "openai", id: "gpt-5-pro", label: "GPT-5 Pro" },
  { provider: "openai", id: "gpt-4o", label: "GPT-4o" },
  // Direct — GLM
  { provider: "zai", id: "glm-5.2", label: "GLM-5.2" },
  { provider: "zai", id: "glm-5.1", label: "GLM-5.1" },
  { provider: "zai", id: "glm-4.7", label: "GLM-4.7" },
  // Direct — DeepSeek
  { provider: "deepseek", id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { provider: "deepseek", id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  // Vercel AI Gateway — one key, routes to many
  { provider: "vercel-ai-gateway", id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6 (Gateway)" },
  { provider: "vercel-ai-gateway", id: "openai/gpt-5.2", label: "GPT-5.2 (Gateway)" },
  { provider: "vercel-ai-gateway", id: "zai/glm-5.2", label: "GLM-5.2 (Gateway)" },
  { provider: "vercel-ai-gateway", id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro (Gateway)" },
];

export const DEFAULT_MODEL: { provider: string; id: string } = {
  provider: process.env.WHITE_SQUARE_PROVIDER ?? process.env.AGENT_SNAPSHOT_PROVIDER ?? "anthropic",
  id: process.env.WHITE_SQUARE_MODEL ?? process.env.AGENT_SNAPSHOT_MODEL ?? "claude-sonnet-4-6",
};

/** All env var names across providers (used to detect whether pi can run). */
export function allProviderEnvVars(): string[] {
  return PROVIDER_CATALOG.flatMap((p) => p.envVars);
}

/** First present env value for a provider, or undefined. */
export function apiKeyForProvider(provider: string): string | undefined {
  const entry = PROVIDER_CATALOG.find((p) => p.id === provider);
  if (!entry) return undefined;
  for (const name of entry.envVars) {
    const v = process.env[name];
    if (v?.trim()) return v;
  }
  return undefined;
}

/** Which providers currently have a key configured. */
export function availableProviders(): Set<string> {
  const set = new Set<string>();
  for (const p of PROVIDER_CATALOG) {
    if (p.envVars.some((n) => process.env[n]?.trim())) set.add(p.id);
  }
  return set;
}

export interface EngineResolution {
  engine: "pi" | "echo";
  model?: { provider: string; id: string };
  error?: string;
}

/**
 * Decide which engine + model to actually use for an agent, given which
 * provider keys are configured. Rules:
 * - No keys at all → echo (global mock).
 * - Explicit model whose provider has a key → use it.
 * - Explicit model whose provider has NO key (but others do) → error (don't
 *   silently mock; tell the user to configure that provider or switch model).
 * - No explicit model → default if its provider is keyed, else the first
 *   available provider's first catalog model.
 */
export function resolveEngineModel(snapshotModel?: { provider: string; id: string }): EngineResolution {
  const available = availableProviders();
  if (available.size === 0) return { engine: "echo" };

  if (snapshotModel) {
    if (available.has(snapshotModel.provider)) return { engine: "pi", model: snapshotModel };
    const label = PROVIDER_CATALOG.find((p) => p.id === snapshotModel.provider)?.label ?? snapshotModel.provider;
    return {
      engine: "pi",
      error: `This character uses ${label}, but that provider key is not configured. Add it in Settings or choose an available provider.`,
    };
  }

  if (available.has(DEFAULT_MODEL.provider)) return { engine: "pi", model: DEFAULT_MODEL };
  for (const p of PROVIDER_CATALOG) {
    if (available.has(p.id)) {
      const m = MODEL_CATALOG.find((mm) => mm.provider === p.id);
      if (m) return { engine: "pi", model: { provider: m.provider, id: m.id } };
    }
  }
  return { engine: "echo" };
}
