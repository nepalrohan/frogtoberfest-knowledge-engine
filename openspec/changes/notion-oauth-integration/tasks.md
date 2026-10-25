## 1. Backend Administrator Authorization & Configuration

- [x] 1.1 Add `adminApiKey` configuration to `AppConfigService` and `AppConfiguration` in `apps/backend/src/config/configuration.ts` (with development fallback) and verify with `pnpm --filter @my-project/backend check-types`.
- [x] 1.2 Implement `AdminAuthGuard` in `apps/backend/src/common/guards/admin-auth.guard.ts` verifying `x-admin-key` header or `Authorization: Bearer <ADMIN_API_KEY>`, and verify with unit tests in `apps/backend/src/common/guards/admin-auth.guard.spec.ts`.
- [x] 1.3 Implement `ConnectionStorageService` in `apps/backend/src/modules/integrations/connection-storage.service.ts` with AES-256-GCM encryption/decryption, single-connection atomic updates, and idempotent disconnect, and verify with unit tests in `apps/backend/src/modules/integrations/connection-storage.service.spec.ts`.

## 2. Backend OAuth Initiation & Callback Services

- [x] 2.1 Implement `NotionOAuthService` in `apps/backend/src/modules/integrations/notion-oauth.service.ts` with 32-byte anti-CSRF state generation (10-minute TTL), single-use consumption validation, and HTTP Basic authentication code exchange against Notion's token endpoint, and verify with unit tests in `apps/backend/src/modules/integrations/notion-oauth.service.spec.ts`.
- [x] 2.2 Implement `IntegrationsController` in `apps/backend/src/modules/integrations/integrations.controller.ts` with `AdminAuthGuard` on management routes (`oauth/authorize`, `status`, `disconnect`), secure callback redirect handling, and zero token leakage, and verify with unit tests in `apps/backend/src/modules/integrations/integrations.controller.spec.ts`.
- [x] 2.3 Register `IntegrationsModule` in `AppModule` and verify backend compilation and tests pass with `pnpm --filter @my-project/backend test`.

## 3. Frontend Integrations Interface & UX

- [x] 3.1 Implement Notion integration card component in `apps/web/app/integrations/components/notion-integration-card.tsx` using `@repo/ui` components (`Card`, `Badge`, `Button`, `Avatar`, `Spinner`) and semantic tokens, displaying connection status, workspace avatar/name, and Connect/Disconnect triggers.
- [x] 3.2 Implement the Integrations page at `apps/web/app/integrations/page.tsx` fetching authoritative backend status, passing admin headers, redirecting to Notion for authorization, evaluating callback return parameters, and rendering feedback alerts without storing credentials in client storage.
- [x] 3.3 Add navigation link to Integrations in `apps/web/app/page.tsx` and verify frontend builds cleanly with `pnpm --filter @my-project/web check-types`.

## 4. End-to-End Testing & Security Verification

- [x] 4.1 Write end-to-end integration tests in `apps/backend/test/integrations/notion-oauth.e2e-spec.ts` covering unauthorized rejection (401), authorization URL generation, state expiration and replay rejection, code exchange, encrypted persistence, status retrieval, and disconnect lifecycle.
- [x] 4.2 Verify zero token leakage in API responses, logs, and client payloads, and verify all backend tests pass with `pnpm --filter @my-project/backend test`.

## 5. Setup & Deployment Documentation

- [x] 5.1 Create comprehensive Notion OAuth setup guide in `docs/notion-oauth-setup.md` detailing Notion developer portal integration creation, redirect URI registration, environment variables configuration, local testing instructions, HTTPS callback requirements, and single-connection limitations without real secrets.
