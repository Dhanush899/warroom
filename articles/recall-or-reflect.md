# Recall or reflect? How I split Hindsight's two jobs

When I first wired agent memory into an incident-response system, I asked it everything the same way. Within a day I had an agent reading a synthesized summary at 3 AM and trying to justify a production rollback with a paragraph nobody could trace back to a real incident. The fix wasn't a better prompt. It was admitting that memory has two different jobs, and giving each its own API call.

## The system

WarRoom is the incident commander for companies like PaySetu, a UPI and payments platform with a dozen services, from checkout and the NPCI-facing UPI switch to a Postgres orders cluster, Kafka, Redis and a double-entry ledger. For the chosen data base, Whenever an alert fires:
- Deterministic code triages it: SEV1–SEV4, signals such as correlated deploys, degraded vendors, saturation, error-budget burn, scheduled-job overlap and duplicates, and role assignment.
- An LLM recommends one remediation.
- Guardrails decide whether that recommendation stands.
- The on-call engineer's resolution is written back to memory.

The memory layer is [Hindsight](https://github.com/vectorize-io/hindsight), and it gives you three operations: `retain`, `recall` and `reflect`. Retain is the easy one. Every resolution goes in as a self-contained paragraph with the service, timestamp, exact metrics, signals, the fix, time to resolve, root cause and the engineer's note, tagged with `service:`, `action:`, `cause:`, `signal:` and `incident:`. The interesting design question was the other two.

## Two questions that look alike

On-call work asks memory two kinds of questions:

1. **"What happened the last times this happened?"** This is asked mid-incident, about one service and one set of signals, and the answer drives an action on production.
2. **"What do we know about this service?"** or **"What keeps going wrong across the company?"** This is asked by a human who isn't firefighting, and the answer is a briefing.

The first needs evidence: specific, attributable memories you can cite and check. The second needs synthesis: something has to read forty incidents and tell you three of them share a root cause and an action item nobody closed.

In [Hindsight's API](https://hindsight.vectorize.io/), `recall` returns memories (facts extracted at retain time, each with its own tags and timestamp) and `reflect` returns an answer written by reasoning over those memories. I ended up with a simple rule: **recall on the hot path, reflect off it.**

## Recall: scoped, cheap, citable

Both calls live in one thin backend class:

```python
async def recall(self, query, tags, limit) -> list[MemoryItem]:
    resp = await self._retry(
        self.client.arecall, bank_id=self.bank_id, query=query, tags=tags or None,
        tags_match="any_strict" if tags else "any", max_tokens=2048, budget="mid",
    )
    items = [MemoryItem(id=r.id, text=r.text, tags=r.tags or [],
                        timestamp=r.occurred_start or r.mentioned_at) for r in resp.results]
    return items[:limit]
```

Every recommendation makes two recall calls. The first is scoped to the service: `tags=["service:orders-db"]`, with a query shaped like the question an engineer would ask ("how were past PgbouncerPoolExhausted incidents on Orders DB resolved, what was the root cause and time to resolve?"). The second looks for the same *causes* on other services:

```python
async def recall_pattern_precedent(self, service, signals, limit: int = 3):
    """How incidents with the same causal signals were resolved on *other* services."""
    codes = [s["code"] for s in signals if s["code"] in DISCRIMINATING]
    if not self.enabled or not codes:
        return []
    query = ("How are incidents with these signals normally resolved: "
             + _signal_line([s for s in signals if s["code"] in codes]) + "?")
    items = await self.backend.recall(query, tags=sorted({f"signal:{c}" for c in codes}), limit=limit * 4)
    return [m for m in items if m.tag("service") != service["id"] and f"({service['id']})" not in m.text][:limit]
```

The `DISCRIMINATING` list was the painful lesson here. My first version recalled on every signal, including `ERROR_RATE` and `LATENCY_SLO`. Almost every incident has a high error rate, so pattern recall returned a random sample of the whole bank and the model had to talk its way around irrelevant precedent. Filtering to causal signals (a correlated deploy, flag or config change, a degraded dependency, saturation, a scheduled job, data integrity, duplicates) made pattern memories rare and meaningful. A first-ever deploy regression on the card gateway can now cite rollbacks on checkout. It no longer drags in a Kafka lag incident because both had errors.

Why recall here and not reflect? Because the next step checks the model's work. Recalled memories are labelled `S1..` and `P1..`. The model has to cite labels, and a guardrail verifies that at least one cited memory carries an `action:` tag matching the recommended action. `suppress` additionally needs a precedent from the same service. That check only works on discrete memories with tags. A reflect answer is prose; there's nothing to verify it against except more prose.

There's also a quieter reason. Recall results are shown to the engineer as evidence cards: "INC-0917-01: pgbouncer pool exhausted, 13.8% of users affected, restart fixed it in 12 minutes." At 3 AM, a list of past incidents with IDs builds more trust than a well-written summary, because you can open the one it points to.

## Reflect: synthesis, where nobody is waiting

Reflect powers two screens. Each service gets a reliability profile, generated on demand:

```python
PROFILE_QUERY = (
    "Build a reliability profile of service {name} ({service_id}). Cover: (1) its recurring failure modes with "
    "typical magnitudes and times of day, (2) which remediation worked for each and how long it took, "
    "(3) repeat root causes and post-mortem action items that are still open, (4) alerts that are noisy or "
    "known false positives, (5) concrete runbook guidance for the next on-call engineer. Be concise, bullet points."
)

async def build_service_profile(self, service: dict[str, Any]) -> str:
    """Synthesise a service reliability profile from all its memories via reflect."""
    return await self.backend.reflect(PROFILE_QUERY.format(name=service["name"], service_id=service["id"]),
                                      tags=[f"service:{service['id']}"])
```

The second is an org-wide incident review: an untagged reflect asking which failure modes repeat, which post-mortem action items keep not getting done, which alerts are noisy, and which services need reliability investment. That's the quarterly review deck, produced from the same memories the agent uses minute to minute.

This is exactly what reflect is good at. A profile for orders-db has to notice that the nightly `pg_basebackup` makes replica lag spike every night with no user impact, and separately that the 15:00 finance export keeps exhausting pgbouncer because it reads from the primary. Getting there means reading every orders-db memory and generalizing across them, which is too much to push through a recommendation prompt and too slow to do mid-incident. Nobody is paged while a profile is generated, and nothing automatic acts on it.

The bank's mission, set when it's created, shapes both calls. It tells Hindsight this is an SRE team's institutional memory, that fixes, magnitudes, root causes and open action items matter, and that descriptions should be blameless. I underestimated how much that one paragraph changes what comes back from reflect.

## The case that sits in the middle: post-mortems

Post-mortems looked like a reflect job to me at first: a long synthesized document. I went with recall plus a normal LLM call instead. The incident being written up has to be described from its own record, with the timeline reconstructed from deploy times, the alert, the agent's recommendation and the resolution. The *history* has to be specific: which incident IDs shared this root cause, and which action item was promised and not done. So the post-mortem pulls up to six service-scoped memories by root cause and alert, drops the incident's own memory, and hands both to the writer with a strict template.

The result for a third pgbouncer exhaustion in a month was what I wanted:
- a blameless 5-whys ending in "no guardrail checks query destination against workload type";
- an action-item table;
- a note that the root cause had recurred across `INC-0908-02`, `INC-0917-01` and this incident, with the open action item carried over.

Those IDs came from recall. A reflect summary would have said "this has happened before" without saying which times.

## What I'd tell someone starting out

**1. Ask whether a machine will check the answer.** If code needs to verify something (a precedent, a tag, an incident ID), use recall and keep the results as discrete items. If a person will read and judge it, reflect is usually the better tool.

**2. Keep the latency-sensitive path boring.** WarRoom makes two scoped recall calls per recommendation, bounded by `limit` and `max_tokens`, and wraps them in retries for DNS failures and connection resets. That's predictable enough to sit in front of a pager. Reflect runs when someone asks for a profile.

**3. Choose recall filters on causes, not symptoms.** Tag-scoped recall with `any_strict` keeps other services' history out. Restricting cross-service recall to causal signals keeps "everything had errors" from matching everything.

**4. Invest in retain and both of the others get better.** Self-contained memories with exact numbers, timestamps set to when the incident actually happened, and a consistent tag schema made recall precise and reflect coherent. Most of my "memory quality" problems were retain problems.

**5. Write the bank mission as seriously as a system prompt.** Recall and reflect both read through it. A few sentences about what this memory is for did more for reflect quality than any query tweaking.

For the broader picture of why agents need memory beyond a vector index, Vectorize's piece on [agent memory for AI systems](https://vectorize.io/what-is-agent-memory) lays out the landscape well. My takeaway from building on it: split memory by who reads the answer. Code gets recall, people get reflect, and anything that touches production gets something it can cite.
