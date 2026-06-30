export interface SeedMemory { id: string; content: string; tags?: string[] }
export interface Snapshot {
  schemaVersion: "0.1";
  id: string;
  name: string;
  sprite?: string;
  avatar?: string;
  identity: { markdown?: string; systemPrompt?: string; persona?: Record<string, string> };
  seedMemoryMd?: string;
  seedMemory?: SeedMemory[];
  skills: { name: string; description?: string; content?: string; ref?: string }[];
  model?: { provider: string; id: string };
}

export interface AgentInstance { instanceId: string; snapshotId: string; name: string; sprite?: string; avatar?: string }
export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  agentId?: string;
  name?: string;
  ts: number;
}
export interface Session {
  id: string;
  title: string;
  agents: AgentInstance[];
  messages: ChatMessage[];
  createdAt: number;
}
export interface MemoryFile {
  scope: "global" | "session";
  path: string;
  sessionId?: string;
  sessionTitle?: string;
  content: string;
}

export interface ProviderInfo { id: string; label: string; envVars: string[]; dashboardUrl: string; available: boolean }
export interface ModelInfo { provider: string; id: string; label: string }
export interface SecretStatus {
  provider: string;
  label: string;
  dashboardUrl: string;
  configured: boolean;
  source: "ui" | "env" | "none";
  last4: string;
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export const api = {
  runtime: () => fetch("/api/runtime").then((r) => j<{ mode: string }>(r)),
  models: () => fetch("/api/models").then((r) => j<{ providers: ProviderInfo[]; models: ModelInfo[] }>(r)),

  secrets: () => fetch("/api/secrets").then((r) => j<SecretStatus[]>(r)),
  setSecret: (provider: string, key: string) =>
    fetch(`/api/secrets/${provider}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    }).then((r) => j<SecretStatus[]>(r)),
  removeSecret: (provider: string) =>
    fetch(`/api/secrets/${provider}`, { method: "DELETE" }).then((r) => j<SecretStatus[]>(r)),

  listSnapshots: () => fetch("/api/snapshots").then((r) => j<Snapshot[]>(r)),
  saveSnapshot: (s: Partial<Snapshot>) =>
    fetch(s.id ? `/api/snapshots/${s.id}` : "/api/snapshots", {
      method: s.id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    }).then((r) => j<Snapshot>(r)),
  deleteSnapshot: (id: string) => fetch(`/api/snapshots/${id}`, { method: "DELETE" }).then((r) => j(r)),
  listMemoryFiles: (snapshotId: string) =>
    fetch(`/api/snapshots/${snapshotId}/memory-files`).then((r) => j<MemoryFile[]>(r)),
  saveMemoryFile: (snapshotId: string, file: Pick<MemoryFile, "scope" | "sessionId" | "content">) =>
    fetch(`/api/snapshots/${snapshotId}/memory-files/${file.scope}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(file),
    }).then((r) => j<MemoryFile>(r)),

  listSessions: () => fetch("/api/sessions").then((r) => j<Session[]>(r)),
  getSession: (id: string) => fetch(`/api/sessions/${id}`).then((r) => j<Session>(r)),
  createSession: (title: string) =>
    fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((r) => j<Session>(r)),
  deleteSession: (id: string) => fetch(`/api/sessions/${id}`, { method: "DELETE" }).then((r) => j(r)),
  addAgent: (sessionId: string, snapshotId: string) =>
    fetch(`/api/sessions/${sessionId}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshotId }),
    }).then((r) => j<Session>(r)),
  removeAgent: (sessionId: string, instanceId: string) =>
    fetch(`/api/sessions/${sessionId}/agents/${instanceId}`, { method: "DELETE" }).then((r) => j<Session>(r)),
};
