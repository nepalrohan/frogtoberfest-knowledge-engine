# Payment Service Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| ERR_4521 | The ledger lock timed out while posting a transfer. | Retry the transfer after 30 seconds; it is idempotent. |
| ERR_4607 | The card issuer declined the authorization. | Show the decline message; do not retry automatically. |
| ERR_5003 | The fraud check service did not respond. | The transfer is held for manual review by the risk team. |
