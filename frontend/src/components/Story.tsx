import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, fmtHours, pct, type Brain, type IncidentContext, type StoryData } from "../api";
import { ACTION_SHORT, alertTitle, impactLine, roleLine } from "../plain";
import AgentCard from "./AgentCard";
import { WeeklyChart } from "./Impact";
import { Markdown, SevBadge, Spinner } from "./ui";

const FIRST = "INC-0902-02";   // checkout-api bad deploy, fresh brain
const AGAIN = "INC-0909-01";   // same failure a week later
const UPI = "INC-0922-01";     // looks like an NPCI blip, but NPCI is green
const LEDGER = "INC-0926-03";  // money mismatch
const DUP = "INC-0916-02";     // re-fired alert
const REPEAT = "INC-0929-01";  // pool exhaustion, third time, action item still open

const TEACH_NOTE =
  "Rolled back checkout-api to the previous version; errors gone 4 minutes later. The new version crashed on carts " +
  "without a promo code. Our canary check only watches latency, not error rate. Action item AI-CHK-12: add error " +
  "rate to the canary check.";

interface Props {
  version: number;
  onChanged: () => void;
  goTo: (tab: "incidents" | "impact") => void;
}

export default function Story({ version, onChanged, goTo }: Props) {
  const [data, setData] = useState<StoryData | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(TEACH_NOTE);
  const [memOff, setMemOff] = useState(false);

  const refresh = useCallback(
    () => api.story().then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => {
    refresh();
  }, [refresh, version]);

  /** Run a story action against a brain, then refresh everything. */
  const act = async (label: string, brain: Brain, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await api.setBrain(brain);
      await fn();
      await refresh();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const fresh = (id: string) => data?.fresh[id] ?? null;
  const trained = (id: string) => data?.trained[id] ?? null;
  const m = data?.metrics;
  const w1 = m?.weeks[0];
  const w4 = m?.weeks[m.weeks.length - 1];

  const chapters: { kicker: string; title: string; lead: ReactNode; body: ReactNode }[] = [
    {
      kicker: "Meet WarRoom",
      title: "An incident commander that never forgets an outage",
      lead: (
        <>
          PaySetu moves 3.2 million UPI orders a day. When something breaks, an engineer is woken up, often for a
          problem the team has <b>already solved</b> once. The fix lives in someone's head or a month-old chat thread.
          WarRoom remembers every incident in <b>Hindsight</b> memory, and gets better with every one.
        </>
      ),
      body: (
        <>
          <div className="how">
            <HowStep n="1" title="Triage" text="Rates the alert (SEV1-4) and assigns who's in charge, instantly." />
            <HowStep n="2" title="Remember" text="Recalls how this exact problem was fixed before, from Hindsight." />
            <HowStep n="3" title="Act or escalate" text="Fixes known problems itself. Anything new goes to a human." />
            <HowStep n="4" title="Learn" text="Every fix a human makes becomes a memory for next time." />
          </div>
          <div className="stage-actions">
            <button className="primary big" disabled={!!busy}
                    onClick={() => act("start", "fresh", () => api.reset(true, true)).then(() => setStep(1))}>
              {busy === "start" ? <><Spinner /> Giving WarRoom a fresh, empty memory…</> : "Start the story with an empty memory →"}
            </button>
          </div>
        </>
      ),
    },
    {
      kicker: "Wednesday, 11:20 AM",
      title: "Checkout starts failing",
      lead: <>A new version of the checkout service went out a few minutes ago. Now customers can't pay. WarRoom's memory is empty: this is its first day.</>,
      body: (
        <>
          <Situation ctx={fresh(FIRST)} />
          <AskOrShow ctx={fresh(FIRST)} busy={busy === "ask1"}
                     onAsk={() => act("ask1", "fresh", () => api.suggest(FIRST))} />
          {fresh(FIRST)?.suggestion && <Caption>With nothing to remember, WarRoom does the safe thing: it pages a human.</Caption>}
        </>
      ),
    },
    {
      kicker: "11:58 AM",
      title: "The engineer fixes it, and WarRoom takes notes",
      lead: <>{fresh(FIRST)?.triage.roles.tech_lead ?? "The on-call engineer"} rolls back the release and writes one sentence about why. That note is all WarRoom needs.</>,
      body: fresh(FIRST)?.resolution ? (
        <div className="saved">
          <div className="saved-head">✓ Saved to Hindsight memory <span className="muted small">· took {fresh(FIRST)!.resolution!.mttr_min} min to fix by hand</span></div>
          <p>{fresh(FIRST)!.resolution!.retained_memory}</p>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Engineer's note</span>
            <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="stage-actions">
            <button className="primary big" disabled={!!busy || !fresh(FIRST)}
                    onClick={() => act("teach", "fresh", () => api.resolve(FIRST, "rollback", note, "bad-deploy-canary-misses-5xx"))}>
              {busy === "teach" ? <><Spinner /> Writing the memory to Hindsight…</> : "Resolve: roll back, and save the note"}
            </button>
          </div>
        </>
      ),
    },
    {
      kicker: "One week later",
      title: "Same alert. Different outcome.",
      lead: <>Another checkout release, another spike in failed payments. Same problem, but this time WarRoom has a memory of it.</>,
      body: (
        <>
          <Situation ctx={fresh(AGAIN)} />
          <AskOrShow ctx={fresh(AGAIN)} busy={busy === "ask2"} disabled={!fresh(FIRST)?.resolution}
                     disabledHint="Resolve last week's incident first (previous chapter)."
                     onAsk={() => act("ask2", "fresh", () => api.suggest(AGAIN))} />
          {fresh(AGAIN)?.suggestion && fresh(FIRST)?.resolution && (
            <div className="versus">
              <div className="vs-cell"><div className="muted small">Last week</div><b>Paged a human</b><span>{fresh(FIRST)!.resolution!.mttr_min} min to fix</span></div>
              <div className="vs-arrow" aria-hidden>→</div>
              <div className="vs-cell good"><div className="muted small">Today</div>
                <b>{fresh(AGAIN)!.suggestion!.needs_human ? "Paged a human, with the answer" : "Handled by WarRoom"}</b>
                <span>{ACTION_SHORT[fresh(AGAIN)!.suggestion!.action]}, citing last week's fix</span></div>
            </div>
          )}
        </>
      ),
    },
    {
      kicker: "A month on the job",
      title: "Fewer 3 AM pages, faster fixes",
      lead: <>We replayed all of September's {m?.totals.incidents ?? 58} incidents. Each fix an engineer made was saved to Hindsight, and WarRoom took over more of the recurring problems every week.</>,
      body: m && m.totals.processed ? (
        <>
          <div className="hero-stats">
            <Stat big={`${pct(w1?.human_rate)} → ${pct(w4?.human_rate)}`} label="of alerts needed a human (week 1 → week 4)" />
            <Stat big={`${w1?.mttr_median ?? "–"} → ${w4?.mttr_median ?? "–"} min`} label="typical (median) time to fix" />
            <Stat big={fmtHours(m.totals.minutes_saved)} label="of engineer time saved this month" />
          </div>
          <WeeklyChart weeks={m.weeks} />
          <div className="stage-actions"><button onClick={() => goTo("impact")}>Open the full impact view</button></div>
        </>
      ) : <p className="muted">The month replay hasn't been run yet. Open <b>Impact → Presenter tools</b> to run it (≈20 min on free tiers).</p>,
    },
    {
      kicker: "22 September, 2:20 PM",
      title: "It knows when the past doesn't apply",
      lead: <>UPI payments fail again. Memory says "usually a bank-network blip, wait it out". But the bank network is healthy and 42% are failing, not the usual 6-9%. A lazy bot would repeat the old answer.</>,
      body: (
        <>
          <Situation ctx={trained(UPI)} />
          <AskOrShow ctx={trained(UPI)} busy={busy === "upi"} onAsk={() => act("upi", "trained", () => api.suggest(UPI))} compact />
          <div className="mini-row">
            <Mini ctx={trained(LEDGER)} label="Money doesn't match the bank" busy={busy === "ledger"}
                  onAsk={() => act("ledger", "trained", () => api.suggest(LEDGER))} />
            <Mini ctx={trained(DUP)} label="Same alert fires twice" busy={busy === "dup"}
                  onAsk={() => act("dup", "trained", () => api.suggest(DUP))} />
          </div>
        </>
      ),
    },
    {
      kicker: "29 September, 3:15 PM",
      title: "It holds the team to its promises",
      lead: <>The orders database runs out of connections, the third time this month. The fix promised after the first time was never done. WarRoom notices, and writes the blameless post-mortem.</>,
      body: (
        <>
          <Situation ctx={trained(REPEAT)} />
          <AskOrShow ctx={trained(REPEAT)} busy={busy === "rep"} onAsk={() => act("rep", "trained", () => api.suggest(REPEAT))} compact />
          {trained(REPEAT)?.resolution ? (
            trained(REPEAT)?.postmortem ? (
              <details className="pm" open>
                <summary>Blameless post-mortem (draft)</summary>
                <Markdown text={trained(REPEAT)!.postmortem!} />
              </details>
            ) : (
              <div className="stage-actions">
                <button className="primary" disabled={!!busy} onClick={() => act("pm", "trained", () => api.postmortem(REPEAT))}>
                  {busy === "pm" ? <><Spinner /> Writing from the timeline and past incidents…</> : "Draft the blameless post-mortem"}
                </button>
              </div>
            )
          ) : null}
        </>
      ),
    },
    {
      kicker: "The proof",
      title: "Now take its memory away",
      lead: <>Same AI model, same prompt, same incident as chapter 3. The only thing we switch off is Hindsight memory.</>,
      body: (
        <>
          <div className="stage-actions">
            {!memOff ? (
              <button className="danger big" disabled={!!busy || !fresh(FIRST)?.resolution}
                      onClick={() => act("off", "fresh", async () => { await api.toggleMemory(false); setMemOff(true); await api.suggest(AGAIN); })}>
                {busy === "off" ? <><Spinner /> Asking again with memory OFF…</> : "Switch memory OFF and ask again"}
              </button>
            ) : (
              <button className="primary big" disabled={!!busy}
                      onClick={() => act("on", "fresh", async () => { await api.toggleMemory(true); setMemOff(false); await api.suggest(AGAIN); })}>
                {busy === "on" ? <><Spinner /> Memory back on, asking again…</> : "Switch memory back ON"}
              </button>
            )}
          </div>
          {busy === "off" || busy === "on" ? <AgentCard s={null} loading /> : fresh(AGAIN)?.suggestion && <AgentCard s={fresh(AGAIN)!.suggestion} compact />}
          {memOff && fresh(AGAIN)?.suggestion && !fresh(AGAIN)!.suggestion!.memory_enabled && (
            <Caption>Without memory it's back to waking someone up for a problem the team solved last week. <b>Memory is the product.</b></Caption>
          )}
          <div className="stage-actions">
            <button onClick={() => api.setBrain("trained").then(() => { onChanged(); goTo("incidents"); })}>
              Explore the month's incidents yourself →
            </button>
          </div>
        </>
      ),
    },
  ];

  const last = chapters.length - 1;
  const c = chapters[step];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("textarea, input")) return;
      if (e.key === "ArrowRight") setStep((s) => Math.min(last, s + 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  return (
    <div className="story">
      <nav className="story-nav" aria-label="Story chapters">
        {chapters.map((ch, i) => (
          <button key={i} className={`dot-btn${i === step ? " on" : ""}${i < step ? " done" : ""}`}
                  onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined} title={ch.title}>
            <span className="dot-num">{i === 0 ? "★" : i}</span>
            <span className="dot-label">{ch.kicker}</span>
          </button>
        ))}
      </nav>

      <section className="stage" aria-live="polite">
        <div className="kicker">{step > 0 ? `Chapter ${step} · ` : ""}{c.kicker}</div>
        <h1>{c.title}</h1>
        <p className="lead">{c.lead}</p>
        {error && <div className="banner error">{error}</div>}
        {!data ? <Spinner /> : c.body}
      </section>

      <div className="story-foot">
        <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>← Back</button>
        <span className="muted small">Use ← → keys · {step + 1} / {chapters.length}</span>
        <button className="primary" onClick={() => setStep(Math.min(last, step + 1))} disabled={step === last}>Next →</button>
      </div>
    </div>
  );
}

function HowStep({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <div className="how-step">
      <div className="how-n">{n}</div>
      <div><b>{title}</b><p>{text}</p></div>
    </div>
  );
}

/** The incident as a one-glance card: what broke, how bad, what changed, who's on it. */
export function Situation({ ctx }: { ctx: IncidentContext | null }) {
  if (!ctx) return null;
  const { incident: inc, service: svc, triage } = ctx;
  const change = inc.recent_changes.find((c) => c.service === inc.service_id);
  const vendors = inc.dependencies.filter((d) => d.status !== "operational");
  const clue = change
    ? `${change.type === "deploy" ? "New release" : change.type === "flag" ? "Feature flag change" : "Config change"} ${change.ref} shortly before`
    : vendors.length ? `${vendors.map((v) => v.name).join(", ")} reporting problems`
    : inc.dependencies.length ? "All vendors report healthy" : null;
  return (
    <div className={`situation sev-edge-${triage.severity.toLowerCase()}`}>
      <div className="sit-top">
        <SevBadge sev={triage.severity} big />
        <div>
          <div className="sit-title">{alertTitle(inc)}</div>
          <div className="muted small">{svc.name} · {inc.started_at.slice(11, 16)} IST · {inc.id}</div>
        </div>
      </div>
      <div className="sit-impact">{impactLine(inc)}</div>
      {clue && <div className="sit-clue">{clue}</div>}
      <div className="muted small">{roleLine(triage.roles)}</div>
    </div>
  );
}

function AskOrShow({ ctx, busy, onAsk, disabled, disabledHint, compact }: {
  ctx: IncidentContext | null; busy: boolean; onAsk: () => void; disabled?: boolean; disabledHint?: string; compact?: boolean;
}) {
  if (busy) return <AgentCard s={null} loading />;
  if (ctx?.suggestion) return <AgentCard s={ctx.suggestion} compact={compact} />;
  return (
    <div className="stage-actions">
      <button className="primary big" onClick={onAsk} disabled={disabled || !ctx}>Page WarRoom</button>
      {disabled && disabledHint && <span className="muted small">{disabledHint}</span>}
    </div>
  );
}

function Mini({ ctx, label, busy, onAsk }: { ctx: IncidentContext | null; label: string; busy: boolean; onAsk: () => void }) {
  const s = ctx?.suggestion;
  return (
    <div className="mini">
      <div className="muted small">{label}</div>
      {busy ? <Spinner /> : s ? (
        <>
          <div className="mini-act"><SevBadge sev={s.severity} /> <b>{ACTION_SHORT[s.action]}</b></div>
          <div className="small">
            {s.action === "merge" ? "Attached to the open incident, no second war room."
              : s.severity === "SEV1" ? "Critical, straight to a human. Never auto-handled."
              : s.needs_human ? "Sent to a human." : "Handled by WarRoom."}
          </div>
        </>
      ) : <button onClick={onAsk} disabled={!ctx}>Page WarRoom</button>}
    </div>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return <div className="stat"><div className="stat-big">{big}</div><div className="muted small">{label}</div></div>;
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="caption">{children}</p>;
}
