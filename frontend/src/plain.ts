/** Plain-language copy: turn alerts, actions and numbers into sentences a non-SRE judge understands. */
import type { Action, Incident, Memory, Service, Sev, Suggestion } from "./api";

const ALERT_TITLE: Record<string, string> = {
  CheckoutHigh5xxRate: "Checkout is failing",
  UPISuccessRateDrop: "UPI payments are failing",
  CardAuthTimeouts: "Card payments are timing out",
  PostgresReplicaLagHigh: "Database replica is lagging",
  PgbouncerPoolExhausted: "Database connections ran out",
  RedisMemoryHigh: "Session cache is full",
  Auth401Spike: "Logins are being rejected",
  KafkaConsumerLagHigh: "Payment events are backing up",
  OTPDeliveryFailures: "OTP messages aren't arriving",
  ESHeapPressure: "Search is slow",
  KYCVendorTimeouts: "KYC checks are timing out",
  ReconPendingHigh: "Settlement reconciliation is behind",
  ReconMismatch: "Ledger doesn't match the bank",
  Origin504Spike: "Merchant dashboard is erroring",
};

export const titleForAlert = (name: string) => ALERT_TITLE[name] ?? name;
export const alertTitle = (inc: Incident) => titleForAlert(inc.alert.name);

/** "22% of users affected · 1,540 failed payments/min" or "No customers affected". */
export function impactLine(inc: Incident): string {
  const m = inc.metrics;
  if (inc.data_integrity) {
    return `${inc.data_integrity.mismatch_count} ledger entries worth ₹${(inc.data_integrity.amount_inr / 1e5).toFixed(1)} lakh don't match`;
  }
  const users = Number(m.affected_users_pct ?? 0);
  const parts = [users > 0 ? `${users}% of users affected` : "No customers affected"];
  if (m.failed_txn_per_min) parts.push(`${Number(m.failed_txn_per_min).toLocaleString("en-IN")} failed payments/min`);
  if (inc.customer_reported) parts.push(`${inc.support_tickets} support tickets`);
  return parts.join(" · ");
}

export const ACTION_HEADLINE: Record<Action, string> = {
  rollback: "Roll back the change that caused it",
  restart: "Restart the struggling component",
  scale: "Add more capacity",
  failover: "Switch to the backup provider",
  feature_flag: "Flip the kill switch",
  vendor: "It's the vendor: update customers and wait it out",
  monitor: "Known blip: just keep an eye on it",
  suppress: "False alarm: nobody is affected",
  merge: "Duplicate: already being handled",
  escalate: "Wake up a human incident commander",
};

export const ACTION_SHORT: Record<Action, string> = {
  rollback: "Roll back", restart: "Restart", scale: "Add capacity", failover: "Switch provider",
  feature_flag: "Kill switch", vendor: "Vendor issue", monitor: "Watch it", suppress: "False alarm",
  merge: "Duplicate", escalate: "Page a human",
};

export const SEV_WORD: Record<Sev, string> = { SEV1: "Critical", SEV2: "Major", SEV3: "Moderate", SEV4: "Low" };

export function confidenceWord(c: number): string {
  return c >= 0.85 ? "Very sure" : c >= 0.7 ? "Fairly sure" : c > 0 ? "Not sure" : "No idea";
}

export const GUARDRAIL_PLAIN: Record<string, string> = {
  "data-integrity-sev1": "Money records don't match, so this is always Critical and always goes to a human.",
  "duplicate-merged": "The same alert is already open, so no second war room is started.",
  "no-parent-incident": "There's nothing open to merge this into.",
  "vendor-is-green": "Every vendor says they're healthy, so it can't be blamed on a vendor.",
  "nothing-to-roll-back": "Nothing was changed recently, so there's nothing to roll back.",
  "impact-not-noise": "Real users are affected, so this can't be written off as a false alarm.",
  "precedent-required": "WarRoom only acts on its own when it remembers the same fix working before.",
  "safe-fallback": "The AI was unavailable, so a human was paged (the safe default).",
};

/** First-person verdict line for the agent card. */
export function verdict(s: Suggestion): string {
  if (!s.memory_enabled) return "My memory is switched off, so I have nothing to go on.";
  if (s.recalled_count === 0) return "I've never seen anything like this before.";
  if (s.action === "escalate") return "I remember similar incidents, but this one doesn't fit the pattern.";
  const n = pastIncidents(s.cited_memories);
  if (n) {
    const here = s.cited_memories.some((m) => m.label?.startsWith("S"));
    return `I've seen this ${here ? "before" : "on other services"} (${n} past incident${n > 1 ? "s" : ""}).`;
  }
  return "Here's my best call.";
}

/** Hindsight splits one retained incident into several facts: count incidents, not facts. */
export function pastIncidents(ms: Memory[]): number {
  const ids = new Set(ms.map((m) => m.tags.find((t) => t.startsWith("incident:")) ?? m.id));
  return ids.size;
}

/** Readable memory text: drops Hindsight's "| When: … | Involving: …" metadata suffix. */
export function cleanMemory(text: string): string {
  return text.replace(/\s*\|\s*(When|Involving|Where):.*$/s, "").replace(/\s+/g, " ").trim();
}

/** Short, readable excerpt of a memory. */
export function excerpt(text: string, n = 220): string {
  const t = cleanMemory(text);
  return t.length > n ? t.slice(0, n).replace(/\s\S*$/, "") + "…" : t;
}

export const roleLine = (roles: { incident_commander: string; tech_lead: string; communications_lead: string }) =>
  `Commander ${roles.incident_commander} · Tech lead ${roles.tech_lead} · Comms ${roles.communications_lead}`;

export const serviceLine = (svc: Service) => `${svc.name} · ${svc.team} team`;
