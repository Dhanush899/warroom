# One on-call note in Hindsight changed my agent's next answer

The most useful thing an on-call engineer writes is also the most neglected: the two sentences at the bottom of an incident explaining what actually fixed it. I built an incident agent around the idea that those two sentences should change what happens next time. Then I watched one note do exactly that.

## The system in one paragraph

WarRoom is an incident commander for PaySetu, a UPI and payments platform: checkout, a UPI switch that talks to NPCI and partner banks, a card gateway, a double-entry ledger, a Postgres orders cluster behind pgbouncer, Redis, Kafka, notifications, search, KYC and a merchant dashboard.

For every alert, WarRoom:
1. Runs deterministic triage: SEV1–SEV4 classification, signals such as a correlated deploy, a degraded vendor, saturation or error-budget burn, and role assignment.
2. Recalls relevant history from [Hindsight, an open-source agent memory system](https://github.com/vectorize-io/hindsight).
3. Asks an LLM for one remediation, with citations.
4. Passes the answer through guardrails.
5. When a human resolves the incident, writes what they did back to memory.

The whole loop is that last step feeding the second one. Here is one turn of it, end to end.

## Wednesday, 11:20: an empty memory

A new version of checkout-api goes out. Nineteen minutes later the 5xx ratio is 8.2%, a quarter of users are affected, and about 1,700 payments a minute are failing. Triage calls it SEV2, sees the deploy, and assigns a commander, a tech lead and a comms lead.

The agent's memory bank is empty. This is what it says:

> I've never seen anything like this before. **Wake up a human incident commander.** No service or pattern memories exist to validate a specific remediation. While the deploy correlation is high, the absence of precedent for this specific failure mode (NPE in PromoResolver) on a tier-1 service…

That's the correct answer, and it isn't the model being modest. A deterministic guardrail refuses any automatic action that isn't backed by a cited memory where the same fix worked. With nothing to cite, "roll it back" isn't available to it, however obvious it looks. I think that's the right default. An agent that confidently rolls back your payment service on its first day, based on vibes, is an agent you'll turn off by Friday.

## 11:58: the note

The tech lead rolls back and resolves the incident with this note:

> Rolled back checkout-api to the previous version; errors gone 4 minutes later. The new version crashed on carts without a promo code. Our canary check only watches latency, not error rate. Action item AI-CHK-12: add error rate to the canary check.

WarRoom doesn't retain that note on its own. It wraps it in the incident's facts, so the memory makes sense read cold, months later, by a model that has never seen this incident:

```python
return (f"On {when:%Y-%m-%d} at {when:%H:%M} IST ({when:%A}), incident {incident['id']} hit "
        f"{service['name']} ({service['id']}, tier {service['tier']}, team {service['team']}). "
        f"Alert {incident['alert']['name']}: {incident['alert']['summary']}. Severity {severity}; {impact}. "
        f"Signals: {_signal_line(signals)}. The on-call engineer {ACTION_VERB[action]}{took}."
        + (f" Root cause: {cause}." if cause else "")
        + f" Engineer note: {note.strip() or 'none'}")
```

What actually went into [Hindsight](https://hindsight.vectorize.io/) reads like a short incident record: the date, weekday and time; the service and team; the exact numbers (8.2% 5xx, p99 684 ms, 37.2x error-budget burn); the signal that a deploy of v2.44.0 landed 19 minutes before the alert; "the on-call engineer ROLLED BACK the correlated change in 38 min"; the root-cause slug `bad-deploy-canary-misses-5xx`; and then the engineer's own words.

It's stored with tags (`service:checkout-api`, `action:rollback`, `cause:bad-deploy-canary-misses-5xx`, `incident:INC-0902-02`) and with the incident's start time as its timestamp. The bank itself was created with a mission that tells Hindsight what matters here: services, signals with exact numbers, the fix, time to resolve, root causes, open action items, and blameless language.

Two details were deliberate. The exact numbers stay in because "8.2% after a deploy" and "42% with every vendor healthy" call for different decisions, and a memory that says "high error rate" can't tell them apart. The action item stays in because it's the part of the note most likely to matter again.

## The next Wednesday, 14:40: same alert

Another checkout release, v2.45.0. The 5xx ratio is climbing, about 1,000 payments a minute are failing, and there was a deploy nine minutes before. Before anything reaches the LLM, WarRoom recalls this service's history:

```python
async def recall_service_history(self, service, incident, signals, limit: int = 8):
    """Past incidents on this service relevant to this alert ([] when memory is off)."""
    if not self.enabled:
        return []
    query = (f"How were past {incident['alert']['name']} incidents on {service['name']} ({service['id']}) "
             f"resolved, what was the root cause and time to resolve? Current signals: {_signal_line(signals)}")
    return await self.backend.recall(query, tags=[f"service:{service['id']}"], limit=limit)
```

The query is phrased like the question an engineer would ask in the incident channel, and the `service:` tag keeps other services' histories out. Hindsight returns facts extracted from last week's memory: the alert and its numbers, the root cause, and the fact that a rollback fixed it in 38 minutes. The agent's answer:

> I've seen this before (1 past incident). **Roll back the change that caused it.** The alert correlates with a deploy 9 minutes prior, and logs show the exact same NullPointerException in PromoResolver that caused the previous incident. Very sure (95%).
>
> **This keeps happening.** 2nd occurrence of `bad-deploy-canary-misses-5xx`. Open action item: add error rate to the canary check.

The same model with the same prompt now handles the incident itself instead of paging someone. More interesting to me, it brought back the part of the note that wasn't about the fix at all. The action item that would have died in a closed ticket is now on screen for whoever is on call, attached to the second outage it would have prevented. That's the moment the project started feeling useful rather than clever.

## Proving it was the note

I didn't want to take "memory helped" on faith, so WarRoom has a global switch that makes recall return nothing while leaving everything else unchanged. Same incident, memory off:

> My memory is switched off, so I have nothing to go on. **Wake up a human incident commander.** No service or pattern memories exist to validate a specific remediation like rollback, and the error budget burn rate (39.6x) significantly exceeds the page threshold… Not sure (20%).

Flip it back on and the answer returns to "Roll back, 95%". Nothing else changed: the model, the prompt, the triage and the guardrails are all identical. The difference between those two answers is one retained note.

Retain keeps running while recall is off, so the toggle never costs you history. It only lets you see what the agent does without it.

## The part I got wrong first

The first time I clicked "ask again" on an incident I had just resolved, the agent enthusiastically cited that incident as precedent for itself. It was technically correct and completely useless. Now every recall result is filtered against the incident being decided:

```python
# never let an incident cite its own resolution (e.g. "Ask again" after resolving)
own = lambda m: f"incident:{incident_id}" in m.tags or incident_id in m.text  # noqa: E731
svc_mem = [m for m in svc_mem if not own(m)]
pat_mem = [m for m in pat_mem if not own(m)]
```

The second mistake was counting. Hindsight extracts several facts from one retained memory, which is good for retrieval, so the agent's evidence list showed four or five items from a single incident, and my UI called that "5 past incidents". Grouping by the `incident:` tag fixed it. Hindsight knows facts; engineers count incidents.

## What the note doesn't get to decide

It would be easy to read this as "memory makes the agent do whatever worked last time". It doesn't. Some rules don't consult memory at all:
- A money mismatch between the ledger and the bank is always SEV1 and always goes to a human.
- A duplicate alert is merged into the open incident.
- "Vendor issue" is blocked when every vendor reports healthy.
- "Roll back" is blocked when nothing was deployed.

I tested the last two with a UPI incident whose memories all said "NPCI blip, wait it out". NPCI was healthy and failures were at 42% instead of the usual 6–9%. The agent recalled those memories, cited them, and escalated anyway. A note can teach the agent a fix. It can't teach it to ignore the facts in front of it.

## Lessons

**1. The resolution note is the highest-value data your on-call process produces.** Make it cheap to write (one text box, prefilled when the engineer accepts the agent's suggestion) and make sure it goes somewhere that gets read at the next incident, not into a ticket nobody opens.

**2. Retain context, not just the note.** The note alone ("rolled back, fixed") is nearly useless in six months. The note plus service, time, exact numbers, signals and resolution time is a precedent another model can reason about.

**3. Keep the numbers.** Magnitudes are how the agent tells "this again" from "something new that looks like this". Round them away and you lose the ability to escalate the lookalikes.

**4. Build the off switch on day one.** A memory toggle turned "I think memory helps" into a before-and-after I can show anyone in thirty seconds, and it keeps me honest when I change the prompt.

**5. Let action items ride along with fixes.** The most valuable thing Hindsight gave back wasn't the rollback. It was the unfinished promise from last week, resurfaced at the moment it mattered.

If you're new to the idea, Vectorize's explainer on [what agent memory is and why agents need it](https://vectorize.io/what-is-agent-memory) is a good primer. My advice is simpler: pick the one sentence your humans already write after doing the hard work, and make sure your agent reads it next time.
