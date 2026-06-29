import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PROVIDER_CATALOG } from "@white-square/core";

export interface SecretStatus {
  provider: string;
  label: string;
  dashboardUrl: string;
  configured: boolean;
  source: "ui" | "env" | "none";
  last4: string;
}

function primaryEnvVar(provider: string): string | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === provider)?.envVars[0];
}

/**
 * Provider API keys configured from the UI. Persisted to a gitignored local
 * file and mirrored into process.env so the catalog's env-based key resolution
 * (and pi-ai's own auth) just works. UI keys override env.
 */
export class SecretStore {
  private readonly file: string;
  private keys: Record<string, string> = {};

  constructor(dataDir: string) {
    this.file = join(dataDir, "secrets.json");
  }

  /** Load from disk and inject into process.env. */
  async load(): Promise<void> {
    try {
      this.keys = JSON.parse(await readFile(this.file, "utf8"));
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
      this.keys = {};
    }
    for (const [provider, key] of Object.entries(this.keys)) this.toEnv(provider, key);
  }

  async set(provider: string, key: string): Promise<void> {
    if (!PROVIDER_CATALOG.some((p) => p.id === provider)) throw new Error(`unknown provider: ${provider}`);
    this.keys[provider] = key;
    this.toEnv(provider, key);
    await this.persist();
  }

  async remove(provider: string): Promise<void> {
    delete this.keys[provider];
    const envVar = primaryEnvVar(provider);
    if (envVar) delete process.env[envVar];
    await this.persist();
  }

  status(): SecretStatus[] {
    return PROVIDER_CATALOG.map((p) => {
      const uiKey = this.keys[p.id];
      const envKey = p.envVars.map((n) => process.env[n]).find((v) => v?.trim());
      const source: SecretStatus["source"] = uiKey ? "ui" : envKey ? "env" : "none";
      const effective = uiKey ?? envKey ?? "";
      return {
        provider: p.id,
        label: p.label,
        dashboardUrl: p.dashboardUrl,
        configured: Boolean(effective),
        source,
        last4: effective ? effective.slice(-4) : "",
      };
    });
  }

  private toEnv(provider: string, key: string) {
    const envVar = primaryEnvVar(provider);
    if (envVar) process.env[envVar] = key;
  }

  private async persist() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.keys, null, 2), { mode: 0o600 });
    await chmod(this.file, 0o600).catch(() => {});
  }
}
