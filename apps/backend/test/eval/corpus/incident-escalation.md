# Incident Escalation Policy

## Severity levels
- **SEV1**: full outage or data loss affecting customers. Page the incident commander immediately.
- **SEV2**: a major feature is degraded for many customers. Page the owning team's on-call within 15 minutes.
- **SEV3**: minor degradation with a workaround. Handle in business hours.

## SEV1 process
1. The first responder declares the incident in #incidents with `/incident sev1`.
2. The incident commander is paged automatically and takes ownership within 5 minutes.
3. Customer support posts a status page update within 20 minutes of declaration.
4. Updates go to #incidents every 30 minutes until resolved.
5. A blameless postmortem is due within 5 working days.
