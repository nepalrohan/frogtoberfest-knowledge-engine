# Deployment Runbook

## Releasing
Every production release is a signed git tag of the form `release-YYYY.MM.DD-N`. The release pipeline builds the
container image once, runs the smoke suite against staging, and then promotes the same image to production with a
rolling update of 25% of pods at a time.

## Deploy freeze
Production deploys are frozen from 16:00 on Friday until 09:00 on Monday, and during the last five working days of
each quarter. Emergency fixes during a freeze need approval from the on-call engineering manager in #release-approvals.

## Rolling back
To roll back a bad deploy, redeploy the previous release tag with `make deploy TAG=<previous-tag>`; never revert
commits on main to roll back. A rollback must start within 15 minutes of detecting a customer-facing regression.
Database migrations are written expand/contract style, so the previous release always runs against the new schema.
After a rollback, open an incident ticket and link the bad tag.
