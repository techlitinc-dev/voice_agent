# Incident Response

Companion to `04-disaster-recovery.md` §6. This is the on-call contract: what
"page" means, who does what, and how a postmortem is written.

## Severity levels

| Severity | Definition | Response | Examples |
|---|---|---|---|
| **SEV1** | Total outage or data loss | Page on-call immediately; all-hands | DB down, payment system down |
| **SEV2** | Major feature broken | Page on-call; resolve in business hours | Calls failing for one tenant, billing broken |
| **SEV3** | Minor feature degraded | Slack alert; fix in next sprint | Slow analytics, a non-critical webhook failing |
| **SEV4** | Cosmetic / minor bug | Ticket | UI glitch, typo |

Routing (from the observability stack):

| Severity | Channel | Response time |
|---|---|---|
| `page` (SEV1/SEV2) | PagerDuty → phone call | < 5 min |
| `warn` (SEV3) | Slack `#alerts` | < 1 hour |
| `info` (SEV4) | Slack `#alerts` (no notify) | Best effort |

## SEV1 response runbook

1. **Acknowledge** the page (PagerDuty) within 5 min.
2. **Assess**: check Grafana, Sentry, Loki for the cause (`/api/health/deep` for
   dependency status, `vaani_*` metrics for error-rate / queue spikes).
3. **Communicate**: post in `#incidents` Slack, update the status page
   (`/status` banner via `src/content/incidents.md`).
4. **Mitigate**: rollback deploy / failover DB (Patroni auto-promotes) / scale
   up / block traffic (drain nodes via `scripts/drain-web.sh`).
5. **Resolve**: apply fix, verify health checks pass
   (`curl https://<domain>/api/health/deep`).
6. **Postmortem**: within 48h, blameless doc covering timeline, root cause,
   action items (template below). Append to `src/content/incidents.md` (newest
   first) so the public status page shows it.

## On-call rotation

- PagerDuty weekly rotation; primary + secondary (escalation after 5 min).
- Follow-the-sun if the team spans timezones.
- Handoff doc kept in the team wiki.

## Postmortem template

```markdown
# Incident YYYY-NNN — <title>

**Date:** 2026-08-07
**Severity:** SEV1
**Duration:** 47 minutes

## Summary
<one paragraph>

## Timeline (IST)
- 14:32 — Alert fired (HighErrorRate)
- 14:35 — On-call acknowledged
- 14:40 — Root cause identified (bad migration)
- 14:50 — Rollback deployed
- 15:19 — Service recovered

## Root cause
<detailed technical explanation>

## Impact
- <N> tenants affected
- <N> calls dropped
- ₹<X> revenue impact

## Action items
- [ ] Add migration test to CI (owner: ___ , due: ___)
- [ ] Add alert for <pattern> (owner: ___ , due: ___)
```

## Blameless postmortem principles

- Focus on systems and process, not people.
- Every action item has an owner + due date.
- Action items are tracked to closure in the team's issue tracker.
