# Making an LLM prove it remembered, using Hindsight tags

The most dangerous sentence an on-call agent can produce is "this happened before, roll it back" when it didn't happen before. I built WarRoom so that sentence can't reach production unless the agent can point to the exact memory that backs it, and a few lines of deterministic code agree.

## What WarRoom does

WarRoom is an incident commander for PaySetu, an Indian UPI and payments platform with a dozen tier-1 and tier-2 services: checkout, the UPI switch, the card gateway, the ledger, an orders Postgres cluster, Redis session cache, Kafka, notifications, search, KYC and a merchant dashboard. When an alert fires, the pipeline runs in a fixed order:

1. **Triage, with no LLM.** A rules module classifies severity on a SEV1–SEV4 matrix (data integrity is always SEV1, more than 25% of users affected is SEV2, a customer-reported tier-1 problem is at least SEV2). It extracts signals: a deploy or flag change in the last hour, a degraded vendor like NPCI or an SMS provider, saturation, error-budget burn, overlap with a scheduled job, or a duplicate of an alert that's already open. Then it assigns an incident commander, tech lead, comms lead and scribe.
2. **Recall.** WarRoom asks [Hindsight agent memory](https://github.com/vectorize-io/hindsight) how this service's past incidents were resolved, and how incidents with the same causal signals were resolved elsewhere.
3. **Recommend.** An LLM (Groq, `gpt-oss-120b` with fallbacks) picks one of ten actions: rollback, restart, scale, failover, feature_flag, vendor, monitor, suppress, merge or escalate. It returns JSON with a hypothesis, runbook steps, a confidence score and the memories it cited.
4. **Guardrails.** Deterministic code decides whether the recommendation stands.
5. **Learn.** Whatever the on-call engineer actually does is written back to Hindsight.

This article is about the seam between steps 3 and 4: how I made "I remember this" a claim the system can verify, rather than something the model says because it sounds plausible.

## The problem with "the model will cite its sources"

My first version did the obvious thing. It recalled memories, pasted them into the prompt and asked the model to explain its reasoning. The explanations were good, and that was the trouble. A model that has just read eight paragraphs about checkout-api rollbacks will write a fluent paragraph justifying a rollback on the orders database, where there is no deploy to roll back.

Free-text justification isn't evidence. I wanted three properties:

- The model can only cite memories it was actually shown.
- A citation has to be about the *same fix* the model recommends, not just the same service.
- Checking a citation can't depend on another LLM call.

[Hindsight](https://hindsight.vectorize.io/) made the third one practical, because every memory can carry tags that survive retention, fact extraction and recall.

## Step one: write the evidence at retain time

Every resolution is retained with a structured tag set alongside the natural-language memory:

```python
tags = ([f"service:{service['id']}", f"action:{action}", f"severity:{severity}",
         f"incident:{incident['id']}"]
        + ([f"cause:{cause}"] if cause else [])
        + sorted({f"signal:{s['code']}" for s in signals}))
await self.backend.retain(
    content=text, tags=tags, timestamp=datetime.fromisoformat(incident["started_at"]),
    document_id=f"resolution-{incident['id']}",
    metadata={"incident_id": incident["id"], "service_id": service["id"], "action": action},
)
```

Three decisions here turned out to matter more than I expected.

**`action:` is the tag the guardrail reads.** The prose says things like "the on-call engineer ROLLED BACK the correlated change in 38 min", which is great for the model and for humans. The tag says `action:rollback`, which is what code can trust.

**The timestamp is when the incident started, not when I called retain.** Hindsight reasons about time, so a memory dated at the moment of the outage keeps the chronology honest when you ask "has this happened before?"

**`document_id` is per incident.** If an engineer re-resolves an incident, for example overriding their first call, the memory is replaced instead of duplicated. Without that, a corrected mistake would still be sitting in the bank as precedent.

## Step two: give the model labels, not IDs

Memory IDs are opaque strings, and models mangle them. So before the prompt is built, recalled memories get short labels: `S1..` for this service's history and `P1..` for pattern memories from other services.

```python
def label_memories(service_mem: list[MemoryItem], pattern_mem: list[MemoryItem]) -> dict[str, MemoryItem]:
    """S1.. for this service's memories, P1.. for pattern memories."""
    labels = {f"S{i}": m for i, m in enumerate(service_mem, 1)}
    labels.update({f"P{i}": m for i, m in enumerate(pattern_mem, 1)})
    return labels
```

The model must return `"cited_memories": ["S1", "P2"]`. The validator strips brackets, uppercases, and maps each label back to the real `MemoryItem`. Anything that doesn't resolve is dropped silently. The model can't invent a citation, because a citation is only a key into a dictionary that exists for this one request.

The S/P split isn't cosmetic either. Some fixes transfer across services and some don't. A rollback after a correlated deploy is standard practice everywhere, so a `P` citation is fine. Writing an alert off as noise is service-specific. "The nightly `pg_basebackup` makes replica lag spike on orders-db" says nothing about Kafka.

## Step three: check the citation against the tag

This is the entire verification step:

```python
def _used_action(m: MemoryItem, action: str) -> bool:
    """Did this memory's incident get resolved with ``action``? (tags first, text as a fallback)."""
    tag = m.tag("action")
    if tag:
        return tag == action
    text = m.text.lower()
    return any(w in text for w in ACTION_WORDS[action])
```

And in the guardrails:

```python
if action != "escalate":
    cited = result["cited"]
    pool = [m for label, m in cited if label.startswith("S")] if action == "suppress" \
        else [m for _, m in cited]
    if not any(_used_action(m, action) for m in pool):
        where = "from this service " if action == "suppress" else ""
        return _escalate(result, f"No cited precedent {where}where '{action}' resolved a matching incident, "
                                 "so a human IC must decide.", "precedent-required")
```

If the model recommends anything other than escalating, at least one cited memory must carry the same `action:` tag. For `suppress`, it has to come from this service. Otherwise the recommendation is turned into an escalation, confidence is capped at 0.5, and the UI shows a one-line reason: "WarRoom only acts on its own when it remembers the same fix working before."

This sits next to other deterministic rules that don't depend on memory at all:
- `vendor` is only allowed if a dependency is actually degraded.
- `rollback` needs a correlated deploy, flag or config change.
- A data-integrity signal is always SEV1 and always goes to a human.
- The model can raise severity but never lower it below the rule-based value.

Memory can make the agent more willing to act. It can never override those rules.

## What this looks like in practice

The interaction I show people first is a checkout failure a week after an identical one. The agent's answer, verbatim:

> I've seen this before (1 past incident). **Roll back the change that caused it.** The alert correlates with a deploy 9 minutes prior, and logs show the exact same NullPointerException in PromoResolver that caused the previous incident (S2, S3). Previous incidents with matching signals were resolved by rollback. Very sure (95%).

Every label in that answer resolves to a memory from `INC-0902-02`, and those memories carry `action:rollback`. The guardrail passes, so the agent handles it.

The more interesting case is where memory points one way and reality points another. UPI success rate drops. Hindsight returns two earlier incidents on the same service, both NPCI and partner-bank degradations resolved with `vendor`: raise a ticket, post a status banner, wait. The model sees those memories and still escalates, because NPCI reports healthy and failures are at 42% against a history of 6–9%. If it had followed the memories, the `vendor-is-green` guardrail would have escalated anyway. Memory is evidence, not an instruction.

## The bug that taught me tags beat text

After retain, Hindsight extracts facts from what you stored. One resolution I wrote as a single paragraph came back as four or five facts: one about the alert, one about the root cause, one about the fix, one about the engineer. That's the right behaviour for retrieval: you want the root-cause fact to match a root-cause query. But the first version of my UI counted cited memories and proudly told the on-call engineer "I've seen this before (5 past incidents)". It had seen one incident.

The fix was one function, and it only works because the `incident:` tag travels with every extracted fact:

```ts
/** Hindsight splits one retained incident into several facts: count incidents, not facts. */
export function pastIncidents(ms: Memory[]): number {
  const ids = new Set(ms.map((m) => m.tags.find((t) => t.startsWith("incident:")) ?? m.id));
  return ids.size;
}
```

The same lesson shows up in the guardrail. Extracted fact text is paraphrased, so "rolled back" might come back as "resolved the incident by rolling back checkout-api to the previous version". The keyword fallback in `_used_action` catches most of that, but I wouldn't want a production decision to depend on it. The tag is exact, and that's the point.

Recall is also scoped by tag with `tags_match="any_strict"`, so a query about orders-db can't be answered with a strikingly similar memory from session-cache. Semantic similarity decides what's relevant. Tags decide what's allowed.

## Lessons

**1. Decide what the machine verifies before you write the prompt.** I designed the tag schema (`service:`, `action:`, `cause:`, `signal:`, `incident:`) before the agent's prompt, because the guardrails needed to read it. The prose memory is for the model; the tags are for the code.

**2. Make citations dictionary keys, not strings.** Short per-request labels mapped to real objects remove a whole class of hallucinated references. Anything that doesn't resolve disappears instead of looking authoritative.

**3. A precedent has to match the decision, not the topic.** "We've had incidents on this service before" is not permission to restart it. The check that mattered was "a cited incident was fixed *with this action*", and for noise suppression, "on this exact service".

**4. Count what the user cares about.** Hindsight works in facts; engineers think in incidents. Put the unit you want to display into a tag so you can group by it later.

**5. Let memory widen what the agent may do, never what it must do.** The rules that page a human for money mismatches or refuse to blame a healthy vendor don't consult memory. That's what makes it safe to let memory handle the rest.

If you're building anything where an LLM acts on past experience, the concepts in [what agent memory actually is](https://vectorize.io/what-is-agent-memory) are worth reading before you pick a design. For me, the biggest step up in reliability came from treating memory tags as a contract between retain time and decision time.
