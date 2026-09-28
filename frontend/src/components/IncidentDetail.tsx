import { useEffect, useRef, useState } from "react";
import { ACTIONS, api, fmtINR, fmtTime, type Action, type IncidentContext, type StatusUpdate } from "../api";
import { ACTION_HEADLINE, ACTION_SHORT } from "../plain";
import AgentCard from "./AgentCard";
import { Situation } from "./Story";
import { ACTION_GROUP, ACTION_HINT, Markdown, SignalChip, Spinner } from "./ui";

/**
 * One incident, top to bottom in the order a person thinks about it:
 * what's happening → what WarRoom says → decide → (after) what was learned, update, post-mortem.
 * Raw telemetry sits in a collapsed "Technical details" section.
 */
export default function IncidentDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [ctx, setCtx] = useState<IncidentContext | null>(null);
  const [loading, setLoading] = useState<"suggest" | "pm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [cause, setCause] = useState("");
  const [other, setOther] = useState(false);
  const [saving, setSaving] = useState<Action | null>(null);
  const asked = useRef(false);

  const load = () => api.incident(id).then((c) => { setCtx(c); return c; }).catch((e) => { setError(e.message); return null; });

  const ask = async () => {
    setLoading("suggest");
    setError(null);
    try {
      await api.suggest(id);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  useEffect(() => {
    // Open an incident and WarRoom answers straight away: no extra click needed.
    load().then((c) => {
      if (c && !c.suggestion && !c.resolution && !asked.current) {
        asked.current = true;
        ask();
      }
    });
  }, [id]);

  if (!ctx) return <div className="empty">{error ?? <Spinner />}</div>;
  const { incident: inc, service: svc, triage, suggestion, resolution, postmortem } = ctx;

  const resolve = async (action: Action) => {
    setSaving(action);
    setError(null);
    try {
      await api.resolve(id, action, note || (suggestion?.action === action ? suggestion.reason : ""), cause);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const pm = async () => {
    setLoading("pm");
    setError(null);
    try {
      await api.postmortem(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="incident">
      <Situation ctx={ctx} />

      <section className="block" aria-labelledby="h-agent">
        <div className="block-head">
          <h2 id="h-agent">What WarRoom says</h2>
          {suggestion && !resolution && <button className="ghost" onClick={ask} disabled={!!loading}>Ask again</button>}
        </div>
        {error && <div className="banner error">{error}</div>}
        {loading === "suggest" ? <AgentCard s={null} loading /> : suggestion ? <AgentCard s={suggestion} />
          : !resolution && <button className="primary big" onClick={ask}>Page WarRoom</button>}
      </section>

      <section className="block" aria-labelledby="h-decide">
        <h2 id="h-decide">{resolution ? "How it was resolved" : "Your call"}</h2>
        {resolution ? (
          <>
            <div className="saved">
              <div className="saved-head">
                ✓ {ACTION_SHORT[resolution.action]}{resolution.mttr_min != null && ` · fixed in ${resolution.mttr_min} min`}
                {resolution.suggested_action && (
                  <span className={`badge ${resolution.agreed ? "auto" : "human"}`}>
                    {resolution.agreed ? "matched WarRoom" : `overrode WarRoom (${ACTION_SHORT[resolution.suggested_action]})`}
                  </span>
                )}
              </div>
              {resolution.note && <p className="note">“{resolution.note}”</p>}
            </div>
            {resolution.retained_memory && (
              <details className="more">
                <summary>What WarRoom saved to Hindsight memory</summary>
                <p className="memory-text">{resolution.retained_memory}</p>
              </details>
            )}
            <UpdateCard title="All-clear message for stakeholders" u={resolution.status_update} />
            <div className="block-head pm-head">
              <h2>Blameless post-mortem</h2>
              <button className={postmortem ? "ghost" : "primary"} onClick={pm} disabled={!!loading}>
                {loading === "pm" ? <><Spinner /> Writing…</> : postmortem ? "Rewrite" : "Write it for me"}
              </button>
            </div>
            {postmortem ? <div className="pm"><Markdown text={postmortem} /></div>
              : <p className="muted small">Timeline, impact, 5 whys and action items. Earlier occurrences and unfinished action items come from memory.</p>}
          </>
        ) : (
          <>
            {suggestion && (
              <button className={`primary big accept g-${ACTION_GROUP[suggestion.action]}`} onClick={() => resolve(suggestion.action)} disabled={!!saving}>
                {saving === suggestion.action ? <Spinner /> : "✓"} Accept: {ACTION_HEADLINE[suggestion.action].toLowerCase()}
              </button>
            )}
            <label className="field">
              <span>Note for next time <span className="muted">(optional: WarRoom learns from it)</span></span>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder="e.g. Rolled back v2.41; the canary check doesn't look at error rate." />
            </label>
            <button className="link" onClick={() => setOther(!other)} aria-expanded={other}>
              {other ? "Hide other options" : "Do something else…"}
            </button>
            {other && (
              <div className="other">
                <label className="field">
                  <span>Root cause label <span className="muted">(optional, links repeats together)</span></span>
                  <input className="cause" value={cause} onChange={(e) => setCause(e.target.value)} placeholder="e.g. reporting-job-on-primary" />
                </label>
                <div className="decide-buttons">
                  {ACTIONS.filter((a) => a !== suggestion?.action).map((a) => (
                    <button key={a} className={`act-btn g-${ACTION_GROUP[a]}`} onClick={() => resolve(a)} title={ACTION_HINT[a]} disabled={!!saving}>
                      {saving === a ? <Spinner /> : null}{ACTION_SHORT[a]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {suggestion && <UpdateCard title="Draft update for stakeholders" u={suggestion.status_update} />}
          </>
        )}
      </section>

      <details className="block tech">
        <summary><h2>Technical details</h2><span className="muted small">metrics, triage signals, recent changes, logs</span></summary>
        <p className="small"><b>{triage.severity}</b> because {triage.severity_reasons.join("; ").toLowerCase()}. Updates every{" "}
          {triage.sev_policy.cadence_min >= 1440 ? "day" : `${triage.sev_policy.cadence_min} min`}; escalation: {triage.sev_policy.escalation}.</p>
        <div className="facts">
          {Object.entries(inc.metrics).filter(([, v]) => typeof v === "number").map(([k, v]) => (
            <div className="fact" key={k}><div className="fact-label">{k.replace(/_/g, " ")}</div><div className="fact-value">{Number(v).toLocaleString("en-IN")}</div></div>
          ))}
          {inc.data_integrity && <div className="fact bad"><div className="fact-label">mismatch</div><div className="fact-value">{fmtINR(inc.data_integrity.amount_inr)}</div></div>}
        </div>
        <ul className="flags">{triage.signals.map((s, i) => <li key={i}><SignalChip code={s.code} /><span>{s.message}</span></li>)}</ul>
        {inc.recent_changes.length > 0 && (
          <ul className="plain">
            {inc.recent_changes.map((c, i) => (
              <li key={i} className={c.service === inc.service_id ? "hot" : "muted"}>
                <span className="mono small">{fmtTime(c.at)}</span> {c.type} <b>{c.ref}</b> <span className="small">({c.service})</span>
              </li>
            ))}
          </ul>
        )}
        <pre className="logs">{inc.logs.join("\n")}</pre>
        <p className="muted small">{svc.name} · tier {svc.tier} · {svc.channel} · SLO p99 ≤ {svc.slo.p99_ms} ms · alert via {inc.alert.source}: {inc.alert.summary}</p>
      </details>
    </div>
  );
}

function UpdateCard({ title, u }: { title: string; u: StatusUpdate }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${u.subject}\n\n${u.body.replace(/\*\*/g, "")}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <details className="update">
      <summary>{title}</summary>
      <div className="update-head">
        <div className="update-subject">{u.subject}</div>
        <button className="ghost small" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <Markdown text={u.body} />
    </details>
  );
}
