# AGENTS.md: WarRoom

Instructions for coding agents (OpenAI Codex and others) working in this repo.

## What this is
WarRoom is an AI incident commander for "PaySetu", a fictional Indian UPI/payments platform
(HackwithHyderabad 3.0 entry). Hindsight (Vectorize) is the required memory layer. For every alert:
deterministic triage → recall past resolutions from Hindsight → Groq LLM recommends a remediation →
guardrails → an on-call engineer resolves → the resolution is retained to memory.
The frontend opens on a guided 8-chapter demo story aimed at hackathon judges.

## Layout
```
app/triage.py     deterministic signals, SEV1-4 matrix, escalation triggers, role assignment (no LLM)
app/memory.py     Hindsight wrapper (retain / recall / reflect) + LocalBackend offline stand-in
app/agent.py      prompt, JSON validation, guardrails, safe fallback to "escalate"
app/comms.py      stakeholder status updates, blameless post-mortems
app/service.py    workflow, month replay, metrics (pages to humans, median MTTR, repeats)
app/store.py      loads data/*.json, keeps board state in var/state*.json
app/api.py        FastAPI; two "brains": trained (bank warroom-sre) and fresh (warroom-sre-fresh)
scripts/          generate_data.py (synthetic dataset + validation), seed_history.py
data/             generated dataset: services, August history, September incidents, ground truth
tests/            pytest, no network needed
frontend/         React 19 + Vite + TypeScript (Story, Board/IncidentDetail, Services, Impact)
```

## Setup and checks
```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt   # Windows: .venv\Scripts\pip
cp .env.example .env            # keys optional for tests
pytest                          # must stay green: 37+ tests, runs offline
cd frontend && npm install && npx tsc -b    # typecheck must be clean
```
Run locally: `uvicorn app.api:app --port 8020` and `cd frontend && npm run dev` (port 5190; `/api` is proxied).
Without `HINDSIGHT_BASE_URL` the local JSON memory stand-in is used; without `GROQ_API_KEY` the agent
safely escalates everything. Both are fine for development and tests.

If you change `scripts/generate_data.py`, rerun it: it validates that every ground-truth fix has the
signals it depends on and fails loudly otherwise. Story chapter incident IDs are hard-coded in
`app/api.py` (`STORY_FRESH`, `STORY_TRAINED`) and `frontend/src/components/Story.tsx`; keep them in sync
with `data/ground_truth.json`.

## Rules that must not break
Safety guardrails in `app/agent.py` (each has tests in `tests/test_agent.py`):
- Data integrity signal → SEV1 and `escalate`, always.
- Duplicate alert → `merge`, never a second war room.
- `vendor` only if a dependency is actually degraded; `rollback` only with a correlated deploy/flag/config change.
- `suppress` only with zero user impact AND a precedent from the same service.
- Any other automatic action needs a cited memory where that same action worked; otherwise `escalate`.
- The LLM may upgrade severity, never downgrade below the SEV matrix in `app/triage.py`.
- Any LLM/JSON/network failure → `escalate` (page a human).

Other invariants:
- Post-mortems and memories are blameless: describe what the system lacked, never blame people.
- Memory recall respects the MEMORY ON/OFF toggle; retain always runs.
- Hindsight memories are tagged `service:`, `signal:`, `action:`, `cause:`, `severity:`, `incident:`;
  the guardrails read the `action:` tag, so keep the tagging in `retain_resolution` intact.
- Never commit `.env`, `var/`, `.venv/` or `node_modules/`. Never hard-code API keys.

## Conventions
- Python 3.11+, type hints, small modules, docstrings on public functions; match the existing style.
- Frontend: user-facing copy is plain language (see `frontend/src/plain.ts`); raw telemetry goes under
  "Technical details". Keep accessibility: visible focus, aria labels, reduced motion, readable contrast.
- Add or update tests with behaviour changes, especially triage rules and guardrails.
- Commit messages: imperative subject line, short body explaining why.
