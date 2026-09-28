import { useState } from "react";
import type { Memory, Suggestion } from "../api";
import { ACTION_HEADLINE, GUARDRAIL_PLAIN, SEV_WORD, cleanMemory, confidenceWord, excerpt, pastIncidents, verdict } from "../plain";
import { ACTION_GROUP, SevBadge, Spinner } from "./ui";

/** The agent's answer, written as a first-person message with its evidence underneath. */
export default function AgentCard({ s, loading, compact }: { s: Suggestion | null; loading?: boolean; compact?: boolean }) {
  if (loading) {
    return (
      <div className="agent thinking" aria-live="polite">
        <AgentAvatar />
        <div className="agent-body">
          <div className="agent-name">WarRoom</div>
          <p className="agent-think"><Spinner /> Searching Hindsight for similar past incidents, then deciding…</p>
        </div>
      </div>
    );
  }
  if (!s) return null;
  const group = ACTION_GROUP[s.action];
  const cited = new Set(s.cited_memories.map((m) => m.id));
  const evidence = [...s.recalled, ...s.pattern].sort((a, b) => Number(cited.has(b.id)) - Number(cited.has(a.id)));
  return (
    <div className={`agent g-${group}`} aria-live="polite">
      <AgentAvatar />
      <div className="agent-body">
        <div className="agent-top">
          <span className="agent-name">WarRoom</span>
          {s.needs_human
            ? <span className="badge human">Needs a human</span>
            : <span className="badge auto">Handles it itself</span>}
          <SevBadge sev={s.severity} /> <span className="muted small">{SEV_WORD[s.severity]}</span>
        </div>
        <p className="agent-verdict">{verdict(s)}</p>
        <h3 className={`agent-headline t-${group}`}>{ACTION_HEADLINE[s.action]}</h3>
        <p className="agent-reason">{s.reason}</p>
        <div className="agent-meta">
          <Confidence value={s.confidence} />
          <span className="muted small">
            {s.memory_enabled ? `${s.recalled.length + s.pattern.length} memories recalled` : "memory off"} · {(s.latency_ms / 1000).toFixed(1)}s
          </span>
        </div>
        {s.repeat && (
          <div className="ribbon repeat" role="note">
            <b>This keeps happening.</b> {s.repeat_note || "Same root cause as before, and the fix promised last time isn't done."}
          </div>
        )}
        {s.guardrail && GUARDRAIL_PLAIN[s.guardrail] && (
          <div className="ribbon guard" role="note"><b>Safety check:</b> {GUARDRAIL_PLAIN[s.guardrail]}</div>
        )}
        {evidence.length > 0 && (
          <div className="evidence">
            <div className="evidence-title">
              What I remembered {cited.size > 0 && <span className="muted">· evidence from {pastIncidents(s.cited_memories)} past incident{pastIncidents(s.cited_memories) > 1 ? "s" : ""}</span>}
            </div>
            {evidence.slice(0, compact ? 2 : 4).map((m) => <Evidence key={m.id} m={m} cited={cited.has(m.id)} />)}
          </div>
        )}
        {!compact && s.runbook.length > 0 && (
          <details className="steps">
            <summary>Step-by-step runbook ({s.runbook.length})</summary>
            <ol>{s.runbook.map((x, i) => <li key={i}>{x}</li>)}</ol>
          </details>
        )}
      </div>
    </div>
  );
}

function AgentAvatar() {
  return (
    <div className="agent-avatar" aria-hidden>
      <svg viewBox="0 0 32 32" width="22" height="22">
        <path d="M16 6l11 20H5z" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M16 13v6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="16" cy="22.5" r="1.5" fill="currentColor" />
      </svg>
    </div>
  );
}

function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="confidence" title={`${pct}% confidence`}>
      <span className="conf-track" aria-hidden><span className="conf-fill" style={{ width: `${pct}%` }} /></span>
      {confidenceWord(value)} <span className="muted">({pct}%)</span>
    </span>
  );
}

function Evidence({ m, cited }: { m: Memory; cited: boolean }) {
  const [open, setOpen] = useState(false);
  const incident = m.tags.find((t) => t.startsWith("incident:"))?.slice(9);
  const service = m.tags.find((t) => t.startsWith("service:"))?.slice(8);
  const long = cleanMemory(m.text).length > 220;
  return (
    <div className={`ev${cited ? " cited" : ""}`}>
      <div className="ev-head">
        {cited && <span className="ev-used">Evidence</span>}
        {incident && <span className="mono small">{incident}</span>}
        {service && m.label?.startsWith("P") && <span className="muted small">on {service}</span>}
        {m.timestamp && <span className="muted small">{m.timestamp.slice(0, 10)}</span>}
      </div>
      <p>{open ? cleanMemory(m.text) : excerpt(m.text)}
        {long && <button className="link" onClick={() => setOpen(!open)}>{open ? "less" : "more"}</button>}
      </p>
    </div>
  );
}
