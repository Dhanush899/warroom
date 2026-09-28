import { useEffect, useMemo, useState } from "react";
import { api, fmtDay, fmtTime, type BoardRow } from "../api";
import { ACTION_SHORT, titleForAlert } from "../plain";
import { SevBadge } from "./ui";
import IncidentDetail from "./IncidentDetail";

type Filter = "open" | "resolved" | "all";
const FILTER_LABEL: Record<Filter, string> = { open: "Open", resolved: "Resolved", all: "All" };

export default function Board({ version }: { version: number }) {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api.incidents().then(setRows).catch(() => setRows([]));
  }, [version, tick]);

  const match = (r: BoardRow, f: Filter) => (f === "open" ? !r.resolution : f === "resolved" ? !!r.resolution : true);
  const visible = useMemo(() => rows.filter((r) => match(r, filter)), [rows, filter]);

  useEffect(() => {
    if ((!selected || !rows.some((r) => r.id === selected)) && visible.length) setSelected(visible[0].id);
  }, [visible, selected, rows]);

  return (
    <div className="queue-layout">
      <aside className="queue" aria-label="Incidents">
        <div className="filters" role="tablist">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]} <span className="count">{rows.filter((r) => match(r, f)).length}</span>
            </button>
          ))}
        </div>
        <ul className="rows">
          {visible.map((r) => (
            <li key={r.id}>
              <button className={`row sev-edge-${r.severity.toLowerCase()}${selected === r.id ? " selected" : ""}${r.resolution ? " done" : ""}`}
                      onClick={() => setSelected(r.id)} aria-current={selected === r.id}>
                <span className="row-top">
                  <SevBadge sev={r.severity} />
                  <span className="row-title">{titleForAlert(r.alert)}</span>
                </span>
                <span className="row-sub muted small">{r.service_name} · {fmtDay(r.started_at)}, {fmtTime(r.started_at)}</span>
                <span className="row-status">
                  {r.resolution ? <span className="badge done">✓ {ACTION_SHORT[r.resolution.action]}</span>
                    : r.suggestion ? (r.suggestion.needs_human
                      ? <span className="badge human">Needs a human</span>
                      : <span className="badge auto">WarRoom: {ACTION_SHORT[r.suggestion.action]}</span>)
                    : <span className="badge new">New</span>}
                  {r.suggestion?.repeat && <span className="badge repeat">Repeat</span>}
                </span>
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="empty">Nothing here. The pager is quiet.</li>}
        </ul>
      </aside>
      <section className="detail">
        {selected ? (
          <IncidentDetail key={`${selected}-${version}`} id={selected} onChanged={() => setTick((t) => t + 1)} />
        ) : (
          <div className="empty">Pick an incident on the left</div>
        )}
      </section>
    </div>
  );
}
