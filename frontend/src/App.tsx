import { useCallback, useEffect, useState } from "react";
import { api, type Brain, type Health } from "./api";
import Story from "./components/Story";
import Board from "./components/Board";
import Services from "./components/Services";
import Impact from "./components/Impact";

type Tab = "story" | "incidents" | "memory" | "impact";
const TAB_LABEL: Record<Tab, string> = { story: "Demo story", incidents: "Incidents", memory: "Memory", impact: "Impact" };
const BRAIN_LABEL: Record<Brain, string> = { fresh: "New brain", trained: "1 month of memory" };

export default function App() {
  const [tab, setTab] = useState<Tab>("story");
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  // bumps whenever memory/brain/board state changes globally so views refetch
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    api.health().then((h) => { setHealth(h); setError(null); }).catch((e) => setError(String(e.message ?? e)));
  }, [version]);

  // Server not up yet (or restarting)? Keep retrying, then reload every view once it answers.
  useEffect(() => {
    if (!error) return;
    const t = window.setInterval(() => {
      api.health().then(() => { setError(null); refresh(); }).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(t);
  }, [error, refresh]);

  const toggleMemory = async () => {
    if (!health) return;
    await api.toggleMemory(!health.memory_enabled);
    refresh();
  };

  const switchBrain = async (b: Brain) => {
    await api.setBrain(b);
    refresh();
  };

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="brand">
          <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="8" fill="var(--brand)" />
            <path d="M16 6l11 20H5z" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" />
            <path d="M16 13v6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
            <circle cx="16" cy="22.5" r="1.5" fill="#fff" />
          </svg>
          <div>
            <div className="brand-name">WarRoom</div>
            <div className="brand-sub">The on-call AI that remembers every outage</div>
          </div>
        </div>
        <nav className="tabs" aria-label="Main">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </nav>
        {health && (
          <div className="top-right">
            {tab !== "story" && tab !== "impact" && (
              <div className="seg" role="group" aria-label="Which memory WarRoom uses">
                {(["fresh", "trained"] as Brain[]).map((b) => (
                  <button key={b} className={health.brain === b ? "on" : ""} aria-pressed={health.brain === b} onClick={() => switchBrain(b)}
                          title={`Hindsight bank: ${b === health.brain ? health.bank_id : b}`}>
                    {BRAIN_LABEL[b]}
                  </button>
                ))}
              </div>
            )}
            <button className={`mem-toggle ${health.memory_enabled ? "on" : "off"}`} onClick={toggleMemory} aria-pressed={health.memory_enabled}
                    title="With memory off WarRoom recalls nothing and pages a human for everything">
              <span className="knob" aria-hidden />
              Memory {health.memory_enabled ? "on" : "off"}
            </button>
          </div>
        )}
      </header>
      {error && <div className="banner error" role="alert">Can't reach the WarRoom server ({error}). Retrying every 2 seconds… if this stays, start it with <code>start.bat</code>.</div>}
      {health && !health.llm_configured && <div className="banner off" role="status">No GROQ_API_KEY: WarRoom will safely page a human for everything.</div>}
      {health && !health.memory_enabled && (
        <div className="banner off" role="status">Memory is off: WarRoom can't recall any past incident, so it pages a human for everything.</div>
      )}
      <main id="main">
        {tab === "story" && <Story version={version} onChanged={refresh} goTo={setTab} />}
        {tab === "incidents" && <Board version={version} />}
        {tab === "memory" && <Services version={version} />}
        {tab === "impact" && <Impact version={version} onChanged={refresh} />}
      </main>
      {health && (
        <footer className="foot muted small">
          Memory by Hindsight ({health.memory_backend === "hindsight" ? `bank ${health.bank_id}` : "local stand-in"}) · reasoning by Groq {health.models[0] ?? ""} · PaySetu is a fictional company
        </footer>
      )}
    </div>
  );
}
