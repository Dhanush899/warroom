export type Action =
  | "rollback" | "restart" | "scale" | "failover" | "feature_flag"
  | "vendor" | "monitor" | "suppress" | "merge" | "escalate";
export const ACTIONS: Action[] = [
  "rollback", "restart", "scale", "failover", "feature_flag", "vendor", "monitor", "suppress", "merge", "escalate",
];
export type Sev = "SEV1" | "SEV2" | "SEV3" | "SEV4";
export type Brain = "trained" | "fresh";

export interface Signal {
  code: string;
  severity: "low" | "medium" | "high";
  message: string;
  details: Record<string, unknown>;
}

export interface Change {
  type: "deploy" | "flag" | "config";
  service: string;
  ref: string;
  at: string;
  team?: string;
}

export interface Incident {
  id: string;
  service_id: string;
  started_at: string;
  day: number;
  region: string;
  alert: { name: string; source: string; summary: string };
  metrics: Record<string, number | string>;
  recent_changes: Change[];
  dependencies: { name: string; status: string }[];
  customer_reported: boolean;
  support_tickets: number;
  data_integrity: { mismatch_count: number; amount_inr: number } | null;
  logs: string[];
}

export interface Job {
  name: string;
  start: string;
  minutes: number;
  days: string | string[];
}

export interface Service {
  id: string;
  name: string;
  tier: number;
  team: string;
  channel: string;
  oncall: string[];
  slo: { availability: number; p99_ms: number; error_rate: number };
  description: string;
  dependencies: string[];
  external: string[];
  jobs: Job[];
  dashboards: string;
  runbooks: string[];
  incidents?: number;
  resolved?: number;
}

export interface SevPolicy {
  name: string;
  criteria: string;
  response: string;
  cadence_min: number;
  escalation: string;
}

export interface Triage {
  signals: Signal[];
  severity: Sev;
  severity_reasons: string[];
  roles: { incident_commander: string; tech_lead: string; communications_lead: string; scribe: string };
  sev_policy: SevPolicy;
}

export interface Memory {
  id: string;
  text: string;
  tags: string[];
  timestamp: string | null;
  score: number | null;
  label?: string;
}

export interface StatusUpdate {
  subject: string;
  body: string;
}

export interface Suggestion {
  action: Action;
  severity: Sev;
  confidence: number;
  reason: string;
  hypothesis: string;
  runbook: string[];
  repeat: boolean;
  repeat_note: string;
  cited_memories: Memory[];
  recalled: Memory[];
  pattern: Memory[];
  recalled_count: number;
  memory_enabled: boolean;
  model: string | null;
  guardrail: string | null;
  latency_ms: number;
  needs_human: boolean;
  status_update: StatusUpdate;
}

export interface Resolution {
  action: Action;
  note: string;
  cause: string | null;
  resolved_by: string;
  severity: Sev;
  decided_at: string;
  suggested_action: Action | null;
  agreed: boolean;
  needs_human: boolean;
  repeat_flagged: boolean;
  mttr_min: number | null;
  retained_memory: string | null;
  status_update: StatusUpdate;
}

export interface IncidentContext {
  incident: Incident;
  service: Service;
  triage: Triage;
  suggestion: Suggestion | null;
  resolution: Resolution | null;
  postmortem: string | null;
}

export interface BoardRow {
  id: string;
  day: number;
  started_at: string;
  service_id: string;
  service_name: string;
  tier: number;
  alert: string;
  summary: string;
  severity: Sev;
  signals: string[];
  suggestion: { action: Action; confidence: number; needs_human: boolean; repeat: boolean } | null;
  resolution: { action: Action; resolved_by: string; mttr_min: number | null } | null;
}

export interface Health {
  memory_backend: string;
  memory_enabled: boolean;
  brain: Brain;
  bank_id: string;
  llm_configured: boolean;
  models: string[];
}

export interface Summary {
  processed: number;
  human_needed: number;
  auto_handled: number;
  human_rate: number | null;
  agreement: number | null;
  mttr_avg: number | null;
  mttr_median: number | null;
  mttr_baseline: number | null;
  minutes_saved: number;
  repeats_flagged: number;
  sev1: number;
}

export interface Metrics {
  weeks: (Summary & { label: string })[];
  totals: Summary & { incidents: number };
}

export interface ReplayStatus {
  running: boolean;
  done: number;
  total: number;
  current: string | null;
  error: string | null;
  through_day: number | null;
}

export interface StoryData {
  fresh: Record<string, IncidentContext | null>;
  trained: Record<string, IncidentContext | null>;
  metrics: Metrics;
  brain: Brain;
}

async function req<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not json */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<Health>("/health"),
  setBrain: (brain: Brain) => req<Health>("/brain", { brain }),
  story: () => req<StoryData>("/story"),
  incidents: () => req<BoardRow[]>("/incidents"),
  incident: (id: string) => req<IncidentContext>(`/incidents/${id}`),
  suggest: (id: string) => req<Suggestion>(`/incidents/${id}/suggest`, {}),
  resolve: (id: string, action: Action, note: string, cause: string) =>
    req<Resolution>(`/incidents/${id}/resolve`, { action, note, cause: cause || null }),
  postmortem: (id: string) => req<{ postmortem: string }>(`/incidents/${id}/postmortem`, {}),
  services: () => req<Service[]>("/services"),
  serviceMemories: (id: string) => req<Memory[]>(`/services/${id}/memories`),
  serviceProfile: (id: string) => req<{ profile: string; backend: string }>(`/services/${id}/profile`),
  insights: () => req<{ insights: string; backend: string }>("/insights"),
  toggleMemory: (enabled: boolean) => req<{ enabled: boolean }>("/memory/toggle", { enabled }),
  seed: () => req<{ retained: number }>("/memory/seed", {}),
  reset: (memory = true, queue = true) => req<{ ok: boolean }>("/reset", { memory, queue }),
  replay: (through_day: number) => req<ReplayStatus>("/replay", { through_day }),
  replayStatus: () => req<ReplayStatus>("/replay"),
  metrics: () => req<Metrics>("/metrics"),
};

export const fmtTime = (iso: string) => iso.slice(11, 16);
export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
export const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
export const fmtHours = (min: number) => (min >= 120 ? `${(min / 60).toFixed(1)} h` : `${min} min`);
export const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);
