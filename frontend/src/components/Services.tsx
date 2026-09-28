import { useEffect, useState } from "react";
import { api, type Memory, type Service } from "../api";
import { Markdown, MemoryCard, Spinner } from "./ui";

const ORG = "__org__";

export default function Services({ version }: { version: number }) {
  const [services, setServices] = useState<Service[]>([]);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    api.services().then((s) => {
      setServices(s);
      setSel((cur) => cur ?? ORG);
    });
  }, [version]);

  return (
    <div className="vendors-layout">
      <aside className="vendor-list">
        <button className={`network-btn ${sel === ORG ? "selected" : ""}`} onClick={() => setSel(ORG)}>
          <div className="vendor">Incident review (all services)</div>
          <div className="muted small">Reflect across the whole memory bank</div>
        </button>
        {services.map((s) => (
          <button key={s.id} className={sel === s.id ? "selected" : ""} onClick={() => setSel(s.id)}>
            <div className="vendor">{s.name} <span className="tier">T{s.tier}</span></div>
            <div className="muted small">{s.team} · {s.resolved}/{s.incidents} resolved this month</div>
          </button>
        ))}
      </aside>
      <section className="detail">
        {sel === ORG ? <OrgReview key={version} />
          : sel && services.length > 0 && <ServiceProfile key={`${sel}-${version}`} service={services.find((s) => s.id === sel)!} />}
      </section>
    </div>
  );
}

function useReflect(fn: () => Promise<{ text: string; backend: string }>) {
  const [text, setText] = useState<string | null>(null);
  const [backend, setBackend] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fn();
      setText(r.text);
      setBackend(r.backend);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return { text, backend, loading, error, run };
}

function ReflectOutput({ text, backend }: { text: string; backend: string }) {
  return (
    <div className="profile">
      <Markdown text={text} />
      <div className="muted small">Synthesised by {backend === "hindsight" ? "Hindsight reflect" : "local reflect (Groq over stored memories)"}.</div>
    </div>
  );
}

function ServiceProfile({ service }: { service: Service }) {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const r = useReflect(() => api.serviceProfile(service.id).then((x) => ({ text: x.profile, backend: x.backend })));

  useEffect(() => {
    api.serviceMemories(service.id).then(setMemories).catch(() => setMemories([]));
  }, [service.id]);

  return (
    <div className="invoice">
      <div className="inv-header">
        <div>
          <h2>{service.name}</h2>
          <div className="muted small">{service.description}</div>
          <div className="muted small">
            tier {service.tier} · team {service.team} · {service.channel} · SLO {service.slo.availability}% · p99 ≤ {service.slo.p99_ms} ms
          </div>
        </div>
        <div className="inv-meta small muted">
          <div>On-call rotation</div>
          <div><b>{service.oncall.join(" → ")}</b></div>
        </div>
      </div>
      <div className="docs">
        {service.external.map((e) => <span key={e} className="doc vendor-doc">{e}</span>)}
        {service.jobs.map((j) => <span key={j.name} className="doc">{j.name} · {j.start}</span>)}
        {service.runbooks.map((rb) => <span key={rb} className="doc runbook-doc" title={rb}>runbook: {rb.split(":")[0]}</span>)}
      </div>

      <div className="section">
        <div className="section-head">
          <h3>Reliability profile (reflect)</h3>
          <button className="primary" onClick={r.run} disabled={r.loading || !memories?.length}>
            {r.loading ? <><Spinner /> Reflecting over memories…</> : r.text ? "Rebuild profile" : "Build profile from memory"}
          </button>
        </div>
        {r.error && <div className="banner error">{r.error}</div>}
        {r.text ? <ReflectOutput text={r.text} backend={r.backend} /> : (
          <p className="muted">Reflect reasons over every incident this service has had: failure modes, what fixed them, repeat root causes, open action items and noisy alerts.</p>
        )}
      </div>

      <div className="section">
        <h3>What WarRoom remembers {memories && <span className="count">{memories.length}</span>}</h3>
        {!memories ? <Spinner /> : memories.length === 0 ? (
          <p className="muted">Nothing yet. Resolve one of this service's incidents, seed August history or run a replay.</p>
        ) : (
          <div className="memories">
            {[...memories].sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? "")).map((m) => (
              <MemoryCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OrgReview() {
  const r = useReflect(() => api.insights().then((x) => ({ text: x.insights, backend: x.backend })));
  return (
    <div className="invoice">
      <div className="inv-header">
        <div>
          <h2>Incident review</h2>
          <div className="muted small">One reflect call over the whole bank: repeat root causes, overdue action items, noisy alerts, where to invest.</div>
        </div>
      </div>
      <div className="section">
        <div className="section-head">
          <h3>Incident commander's briefing</h3>
          <button className="primary" onClick={r.run} disabled={r.loading}>
            {r.loading ? <><Spinner /> Reflecting…</> : r.text ? "Rebuild" : "Reflect across all services"}
          </button>
        </div>
        {r.error && <div className="banner error">{r.error}</div>}
        {r.text ? <ReflectOutput text={r.text} backend={r.backend} /> : (
          <p className="muted">The quarterly incident review, generated on demand from memory: which failure modes keep coming back and which post-mortem action items never got done.</p>
        )}
      </div>
    </div>
  );
}
