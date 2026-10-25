## Why

To allow the Knowledge Engine to ingest internal documentation from Notion without requiring administrators to manually copy and paste long-lived integration secrets, the system requires a secure, automated Notion OAuth 2.0 flow. Connecting Notion workspaces directly from the frontend, exchanging authorization codes exclusively on the backend, and storing access tokens using AES-256-GCM encryption provides a secure, single-tenant connection lifecycle managed strictly by authorized application administrators.

## What Changes

- Implement an administrative authorization guard (`AdminAuthGuard`) requiring an administrative key (`x-admin-key` / `ADMIN_API_KEY`) to restrict Notion connection management to authorized application administrators.
- Implement backend Notion OAuth endpoints:
  - `GET /api/v1/integrations/notion/oauth/authorize`: Generates an anti-CSRF state token with 10-minute TTL and returns the Notion authorization URL.
  - `GET /api/v1/integrations/notion/oauth/callback`: Validates and consumes the state token, exchanges the authorization code using HTTP Basic authentication against Notion's token endpoint, persists encrypted connection credentials, and redirects to the frontend with safe query status.
  - `GET /api/v1/integrations/notion/status`: Returns safe workspace metadata (workspace name, icon, ID, connection timestamp) without exposing credentials.
  - `POST /api/v1/integrations/notion/disconnect`: Clears credentials and transitions status to disconnected safely and idempotently.
- Implement single-tenant credential storage using AES-256-GCM authenticated encryption (`iv.tag.ciphertext`) with atomic overwrite behavior on reconnects.
- Provide a responsive Next.js frontend Integrations page (`apps/web/app/integrations/page.tsx`) with Notion connection card, real-time status badges, feedback banners, and Connect/Disconnect controls.
- Create comprehensive setup and deployment documentation (`docs/notion-oauth-setup.md`) covering Notion developer portal configuration, required environment variables, local testing, and HTTPS redirect requirements without leaking secrets.

## Capabilities

### New Capabilities
- `notion-oauth`: Backend OAuth 2.0 authorization initiation, administrator access control, CSRF state validation, token exchange via Notion API, AES-256-GCM credential encryption, and connection lifecycle endpoints.
- `integrations-ui`: Frontend integration management interface displaying the Notion card, workspace metadata, connection status, and handling the OAuth redirect flow.

### Modified Capabilities

## Impact

- **Backend Architecture**: Adds `AdminAuthGuard` in `apps/backend/src/common/guards/admin-auth.guard.ts` and configures `IntegrationsController` in `apps/backend/src/modules/integrations`.
- **Frontend Architecture**: Integrates `/integrations` in `apps/web/app/integrations` using `@repo/ui` design system and Lucide icons.
- **Configuration**: Extends `AppConfigService` in `apps/backend/src/config/configuration.ts` with `adminApiKey`, `notion.clientId`, `notion.clientSecret`, `notion.redirectUri`, `frontendUrl`, and `encryptionSecret`.
- **Documentation**: Adds `docs/notion-oauth-setup.md` detailing integration setup, redirect registration, environment variables, and local testing.
- **Security**: Ensures zero credential leakage in client responses or telemetry logs; enforces admin authorization on all connection management endpoints.
