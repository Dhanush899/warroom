import type { ReactNode } from "react";
import type { Action, Memory, Sev } from "../api";

export const SIGNAL_LABELS: Record<string, string> = {
  DATA_INTEGRITY: "Data integrity",
  DUPLICATE_ALERT: "Duplicate",
  DEPLOY_CORRELATED: "Deploy",
  FLAG_CHANGE: "Flag change",
  CONFIG_CHANGE: "Config change",
  DEPENDENCY_DEGRADED: "Vendor degraded",
  SATURATION: "Saturation",
  ERROR_RATE: "Errors",
  LATENCY_SLO: "Latency",
  ERROR_BUDGET_BURN: "Budget burn",
  SCHEDULED_JOB: "Scheduled job",
  CUSTOMER_REPORTED: "Customer-reported",
  NO_USER_IMPACT: "No user impact",
};

const SIGNAL_TONE: Record<string, string> = {
  DATA_INTEGRITY: "high", DUPLICATE_ALERT: "info", DEPLOY_CORRELATED: "change", FLAG_CHANGE: "change",
  CONFIG_CHANGE: "change", DEPENDENCY_DEGRADED: "vendor", SCHEDULED_JOB: "info", NO_USER_IMPACT: "calm",
  CUSTOMER_REPORTED: "high",
};

export function SignalChip({ code }: { code: string }) {
  return <span className={`chip sig tone-${SIGNAL_TONE[code] ?? "symptom"}`}>{SIGNAL_LABELS[code] ?? code}</span>;
}

export const ACTION_LABEL: Record<Action, string> = {
  rollback: "Roll back",
  restart: "Restart",
  scale: "Scale up",
  failover: "Fail over",
  feature_flag: "Flip flag",
  vendor: "Vendor issue",
  monitor: "Monitor",
  suppress: "Suppress (noise)",
  merge: "Merge (duplicate)",
  escalate: "Escalate to IC",
};

export const ACTION_HINT: Record<Action, string> = {
  rollback: "Roll back the correlated deploy / flag / config change",
  restart: "Rolling restart of the component",
  scale: "Add capacity: replicas, shards, consumers",
  failover: "Switch to the secondary provider / replica",
  feature_flag: "Flip a kill switch or fallback flag",
  vendor: "Third party degraded: ticket + status page + wait",
  monitor: "Known transient: watch 15-30 min, no action",
  suppress: "Known noisy alert, no user impact: ack + tune",
  merge: "Duplicate of an open incident",
  escalate: "Page the human incident commander, open a war room",
};

export const ACTION_GROUP: Record<Action, string> = {
  rollback: "fix", restart: "fix", scale: "fix", failover: "fix", feature_flag: "fix",
  vendor: "wait", monitor: "wait", suppress: "quiet", merge: "quiet", escalate: "page",
};

export function ActionPill({ action, subtle }: { action: Action; subtle?: boolean }) {
  return <span className={`pill grp-${ACTION_GROUP[action]}${subtle ? " subtle" : ""}`}>{ACTION_LABEL[action]}</span>;
}

export function SevBadge({ sev, big }: { sev: Sev; big?: boolean }) {
  return <span className={`sev sev-${sev.toLowerCase()}${big ? " big" : ""}`}>{sev}</span>;
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="conf" title={`${pct}% confidence`}>
      <div className="conf-track">
        <div className="conf-fill" style={{ width: `${pct}%` }} />
      </div>
      <span>{pct}%</span>
    </div>
  );
}

export function MemoryCard({ m, cited, label }: { m: Memory; cited?: boolean; label?: string }) {
  const service = m.tags.find((t) => t.startsWith("service:"))?.slice(8);
  const action = m.tags.find((t) => t.startsWith("action:"))?.slice(7) as Action | undefined;
  const cause = m.tags.find((t) => t.startsWith("cause:"))?.slice(6);
  return (
    <div className={`memory${cited ? " cited" : ""}`}>
      <div className="memory-head">
        {label && <span className="mem-label">{label}</span>}
        {cited && <span className="mem-cited">cited</span>}
        {m.timestamp && <span className="muted small">{m.timestamp.slice(0, 10)}</span>}
        {label?.startsWith("P") && service && <span className="tag net">{service}</span>}
        <span className="mem-tags">
          {cause && <span className="tag">{cause}</span>}
          {action && ACTION_LABEL[action] && <span className="tag dec">→ {ACTION_LABEL[action]}</span>}
        </span>
      </div>
      <p>{m.text}</p>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="loading" />;
}

/** Tiny, safe markdown renderer for reflect / post-mortem output (headings, bullets, tables, bold). */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let table: string[][] = [];
  const flushList = () => {
    if (list.length) {
      blocks.push(<ul key={`ul${blocks.length}`}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
      list = [];
    }
  };
  const flushTable = () => {
    if (table.length) {
      const [head, ...body] = table;
      blocks.push(
        <div className="md-table" key={`t${blocks.length}`}>
          <table>
            <thead><tr>{head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead>
            <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      table = [];
    }
  };
  const flush = () => {
    flushList();
    flushTable();
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList();
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) table.push(cells);
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (bullet) {
      flushTable();
      list.push(bullet[1]);
      continue;
    }
    flush();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) blocks.push(h[1].length <= 1 ? <h3 className="md-h1" key={blocks.length}>{inline(h[2])}</h3>
      : <h4 key={blocks.length}>{inline(h[2])}</h4>);
    else if (line.trim() && !/^-{3,}$/.test(line.trim())) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}

function inline(s: string): (string | ReactNode)[] {
  return s.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    return part.replace(/<br\s*\/?>/g, " ");
  });
}
