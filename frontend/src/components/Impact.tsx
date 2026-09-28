import { useEffect, useRef, useState } from "react";
import { api, fmtHours, pct, type Metrics, type ReplayStatus, type Summary } from "../api";
import { Spinner } from "./ui";

type Week = Summary & { label: string };

/** Impact of memory over the month (always the trained brain), plus presenter tools. */
export default function Impact({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [status, setStatus] = useState<ReplayStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const refresh = async () => {
    await api.setBrain("trained");
    const [m, s] = await Promise.all([api.metrics(), api.replayStatus()]);
    setMetrics(m);
    setStatus(s);
    return s;
  };

  const poll = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      const s = await refresh();
      if (!s.running && timer.current) {
        window.clearInterval(timer.current);
        timer.current = null;
        onChanged();
      }
    }, 2000);
  };

  useEffect(() => {
    refresh().then((s) => s.running && poll());
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [version]);

  const run = async (label: string, fn: () => Promise<unknown>, then: string) => {
    setBusy(label);
    setMsg(null);
    try {
      await api.setBrain("trained");
      const r = await fn();
      setMsg(then.replace("{n}", String((r as { retained?: number }).retained ?? "")));
      await refresh();
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const startReplay = async () => {
    setMsg(null);
    await api.setBrain("trained");
    setStatus(await api.replay(30));
    poll();
  };

  const t = metrics?.totals;
  const weeks = metrics?.weeks ?? [];
  const first = weeks.find((w) => w.processed);
  const lastW = [...weeks].reverse().find((w) => w.processed);
  const locked = !!busy || !!status?.running;

  return (
    <div className="impact">
      <section className="card hero-card">
        <h1>What memory changed in one month</h1>
        <p className="lead">Every September incident at PaySetu, handled by WarRoom while it learned from each fix an engineer made.</p>
        {t && t.processed ? (
          <div className="hero-stats">
            <Stat big={`${pct(first?.human_rate)} → ${pct(lastW?.human_rate)}`} label="of alerts needed a human (first week → last week)" />
            <Stat big={`${first?.mttr_median ?? "–"} → ${lastW?.mttr_median ?? "–"} min`} label="typical (median) time to fix" />
            <Stat big={fmtHours(t.minutes_saved)} label="engineer time saved" />
            <Stat big={pct(t.agreement)} label="of calls matched what the engineer did" />
          </div>
        ) : <p className="muted">No incidents processed yet. Use Presenter tools below to replay the month.</p>}
      </section>

      {weeks.some((w) => w.processed) && (
        <section className="card">
          <h2 className="card-title">Alerts that needed a human, week by week</h2>
          <WeeklyChart weeks={weeks} />
          <details className="more">
            <summary>Weekly numbers</summary>
            <table className="match">
              <thead>
                <tr><th>Week</th><th className="num">Incidents</th><th className="num">Needed a human</th><th className="num">Handled by WarRoom</th>
                  <th className="num">Matched engineer</th><th className="num">Critical</th><th className="num">Repeats caught</th><th className="num">Typical fix time</th></tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.label}>
                    <td>{w.label}</td><td className="num">{w.processed}</td><td className="num">{w.human_needed}</td>
                    <td className="num">{w.auto_handled}</td><td className="num">{pct(w.agreement)}</td><td className="num">{w.sev1}</td>
                    <td className="num">{w.repeats_flagged}</td><td className="num">{w.mttr_median == null ? "–" : `${w.mttr_median} min`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      )}

      <details className="card presenter">
        <summary>Presenter tools (month replay, seed history, reset)</summary>
        <p className="muted small">
          These act on the <b>trained</b> brain (Hindsight bank for the whole month). The replay sends every unresolved September
          incident through WarRoom; a simulated engineer resolves it and the fix is saved to memory. About 20 minutes on free tiers,
          so run it before the demo.
        </p>
        <div className="control-row">
          <button className="primary" onClick={startReplay} disabled={locked}>
            {status?.running ? <><Spinner /> Replaying {status.done}/{status.total}</> : "Replay September"}
          </button>
          <button onClick={() => run("seed", api.seed, "Saved {n} August incidents to memory.")} disabled={locked}>
            {busy === "seed" ? <Spinner /> : null} Seed August history
          </button>
          <button className="danger" disabled={locked}
                  onClick={() => confirm("Wipe the trained brain's memory and all resolutions?") && run("reset", () => api.reset(true, true), "Trained brain reset.")}>
            Reset trained brain
          </button>
        </div>
        {status?.running && <div className="progress"><div style={{ width: `${status.total ? (100 * status.done) / status.total : 0}%` }} /></div>}
        {status?.error && <div className="banner error">Replay stopped: {status.error}. Press Replay again to continue.</div>}
        {msg && <div className="banner info">{msg}</div>}
      </details>
    </div>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return <div className="stat"><div className="stat-big">{big}</div><div className="muted small">{label}</div></div>;
}

/** Stacked bars (needed a human / handled) per week with an average-fix-time line. */
export function WeeklyChart({ weeks }: { weeks: Week[] }) {
  const W = 640, H = 250, pad = { l: 36, r: 52, t: 22, b: 40 };
  const max = Math.max(4, ...weeks.map((w) => w.processed));
  const mMax = Math.max(10, ...weeks.map((w) => w.mttr_median ?? 0));
  const band = (W - pad.l - pad.r) / weeks.length;
  const bw = Math.min(70, band * 0.52);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ym = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / mMax);
  const cx = (i: number) => pad.l + band * i + band / 2;
  const pts = weeks.map((w, i) => (w.mttr_median == null ? null : [cx(i), ym(w.mttr_median)] as const))
    .filter((p): p is readonly [number, number] => p !== null);
  const desc = weeks.map((w) => `${w.label.split(" (")[0]}: ${w.human_needed} of ${w.processed} needed a human, fix time ${w.mttr_median ?? "n/a"} min`).join("; ");

  return (
    <figure className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={desc}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={pad.l - 8} y={y(max * f) + 4} className="axis" textAnchor="end">{Math.round(max * f)}</text>
            <text x={W - pad.r + 8} y={y(max * f) + 4} className="axis">{Math.round(mMax * f)} min</text>
          </g>
        ))}
        {weeks.map((w, i) => (
          <g key={w.label}>
            <rect x={cx(i) - bw / 2} y={y(w.human_needed)} width={bw} height={y(0) - y(w.human_needed)} className="bar-human" rx="4" />
            <rect x={cx(i) - bw / 2} y={y(w.processed)} width={bw} height={Math.max(0, y(w.human_needed) - y(w.processed) - 2)} className="bar-auto" rx="4" />
            <text x={cx(i)} y={H - 18} className="axis strong" textAnchor="middle">{w.label.split(" (")[0]}</text>
            {w.processed > 0 && (
              <text x={cx(i)} y={H - 4} className="axis" textAnchor="middle">{w.human_needed} of {w.processed} to a human</text>
            )}
          </g>
        ))}
        {pts.length > 1 && <polyline points={pts.map((p) => p.join(",")).join(" ")} className="rate-line" />}
        {pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r="5" className="rate-dot" />)}
      </svg>
      <figcaption className="legend">
        <span><i className="sw human" /> needed a human</span>
        <span><i className="sw auto" /> handled by WarRoom</span>
        <span><i className="sw line" /> typical (median) time to fix</span>
      </figcaption>
    </figure>
  );
}
