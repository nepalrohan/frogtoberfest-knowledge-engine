## Context

See proposal.md - Why.

The Knowledge Engine operates as a TypeScript modular monolith containing a NestJS 12 backend (`apps/backend`) and a Next.js 16 App Router frontend (`apps/web`). The Notion connector, adapter traversal, AST parser, and canonical normalization design exist in `apps/backend/src/modules/ingestion`.

The system currently lacks an application user table, Google OAuth provider implementation, or RBAC role framework. To fulfill the strict requirement that only an authorized application administrator can connect, inspect, or disconnect Notion without building an unneeded full RBAC engine, we propose the smallest appropriate access-control mechanism: an administrative authorization guard (`AdminAuthGuard`) that checks an administrative API key header (`x-admin-key` or `Authorization: Bearer <ADMIN_API_KEY>`).

This is a single-tenant MVP. There are no tenant tables, organization hierarchies, or multi-tenant abstractions.

## Goals / Non-Goals

**Goals:**
- Provide a secure, seamless OAuth 2.0 flow: initiate from `/integrations`, authorize on Notion, exchange code for token via Notion's OAuth token endpoint using HTTP Basic client authentication, and persist encrypted credentials.
- Restrict connection management actions (`authorize`, `status`, `disconnect`) to authorized application administrators using a minimal, robust `AdminAuthGuard`.
- Manage anti-CSRF state tokens with 10-minute TTL and immediate one-time consumption to prevent replay attacks.
- Securely encrypt Notion access tokens at rest using AES-256-GCM authenticated encryption (`iv.tag.ciphertext`).
- Enforce the single-tenant constraint: reconnecting updates the existing connection record atomically without creating duplicates.
- Ensure zero token leakage: access tokens and client secrets are never sent to the frontend, included in redirect parameters, or written to telemetry logs.
- Deliver comprehensive setup documentation (`docs/notion-oauth-setup.md`) detailing integration configuration in Notion, environment variables, redirect URIs, and local testing instructions.

**Non-Goals:**
- Multi-tenant architectures, organization management, or per-user connection records.
- Document selection UI, page tree synchronization, or ingestion job scheduling (handled in downstream pipeline phases).
- Vector chunking, embeddings generation, or semantic retrieval.
- Building a full RBAC or user management system.

## Decisions

### 1. Minimal Application Administrator Authorization (`AdminAuthGuard`)
- **Decision**: Implement `AdminAuthGuard` in `apps/backend/src/common/guards/admin-auth.guard.ts` applied to `IntegrationsController`. It validates an `x-admin-key` request header or `Authorization: Bearer <ADMIN_API_KEY>` against `AppConfigService.adminApiKey` (with a secure development fallback).
- **Rationale**: The repository currently has no user model or session store. An admin key guard satisfies the requirement that "Only an authorized application administrator may connect, inspect, or disconnect the shared Notion integration" without over-engineering a full RBAC system.
- **Alternatives Considered**: 
  - *Full RBAC system with User and Role tables*: Rejected as premature over-engineering for a single-tenant MVP.
  - *Unprotected endpoints*: Rejected because leaving integration credentials open to arbitrary clients violates core security constraints.

### 2. Dedicated Integration Module Decoupled from Ingestion
- **Decision**: House OAuth services and connection management in `apps/backend/src/modules/integrations` comprising:
  - `NotionOAuthService`: Anti-CSRF state generation, state verification/consumption, and Notion token exchange.
  - `ConnectionStorageService`: AES-256-GCM token encryption, retrieval, atomic updates, and disconnection.
  - `IntegrationsController`: HTTP routes for authorization initiation, callback processing, status query, and disconnect.
- **Rationale**: Follows SOLID single-responsibility and NestJS module architecture guidelines. Ingestion and parsing logic remain completely agnostic of OAuth credential lifecycle.

### 3. Strict Notion OAuth 2.0 Protocol Compliance
- **Decision**: Follow official Notion OAuth specifications:
  - **Authorization URL**: `https://api.notion.com/v1/oauth/authorize` with query parameters `client_id`, `response_type=code`, `owner=user`, `redirect_uri`, and `state`.
  - **Token Endpoint**: `POST https://api.notion.com/v1/oauth/token` using HTTP Basic Authentication (`Authorization: Basic base64(clientId:clientSecret)`), `Content-Type: application/json`, and body `{ grant_type: 'authorization_code', code, redirect_uri }`.
- **Rationale**: Notion strictly requires HTTP Basic client authentication and rejects client credentials sent in the JSON body.
- **Alternatives Considered**: Sending `client_id` and `client_secret` in JSON body. Rejected because Notion's OAuth token endpoint rejects unauthenticated POST bodies with HTTP 401.

### 4. AES-256-GCM Token Encryption at Rest
- **Decision**: Encrypt plaintext access tokens using Node.js built-in `crypto.createCipheriv('aes-256-gcm', key, iv)` with a 12-byte random IV and 16-byte authentication tag. Credentials are stored as `iv.tag.ciphertext` (hex-encoded).
- **Rationale**: Authenticated encryption provides both confidentiality and integrity protection against tampering without external dependencies.
- **Alternatives Considered**: Plaintext token storage. Rejected as a severe security vulnerability.

### 5. Ephemeral Anti-CSRF State Management
- **Decision**: Store active OAuth states in an in-memory TTL map within `NotionOAuthService`. State entries include `state`, `userId`, `createdAt`, `expiresAt` (10 minutes), and `consumed` (boolean). State is validated and marked consumed in a single atomic check.
- **Rationale**: Ephemeral, zero database overhead for single-tenant operations, and guarantees one-time consumption to prevent replay attacks.

### 6. Single-Tenant Data Contract & Atomic Reconnection
- **Decision**: Store a single active connection record:
  - `id`: UUID
  - `provider`: 'notion'
  - `workspace_id`: string
  - `workspace_name`: string
  - `workspace_icon`: string | null
  - `credential_ref`: string (encrypted token)
  - `connected_by`: string
  - `status`: 'connected' | 'disconnected'
  - `created_at`: Date
  - `updated_at`: Date
  Reconnecting an active workspace atomically updates the existing record, avoiding duplicate rows. Disconnecting clears `credential_ref` and transitions status to `'disconnected'` safely and idempotently.
- **Rationale**: Enforces the single-connection constraint at the persistence boundary.

### 7. Modern UI Design System & Zero Client Token Storage
- **Decision**: Build the Integrations page in `apps/web/app/integrations/page.tsx` using `@repo/ui` components (`Card`, `Badge`, `Button`, `Alert`, `Spinner`, `Avatar`), Tailwind CSS semantic tokens, and Lucide icons. All OAuth tokens remain exclusively on the backend; the frontend only receives safe metadata (`workspaceName`, `workspaceIcon`, `connectedAt`).
- **Rationale**: Guarantees zero credential leakage while delivering a clean, modern administrative user experience.

### 8. Comprehensive Setup Documentation
- **Decision**: Document end-to-end integration configuration in `docs/notion-oauth-setup.md` including Notion developer portal settings, environment variables, local testing commands, HTTPS callback notes, and admin limitations.
- **Rationale**: Empowers developers and administrators to configure and test the integration securely without hardcoding secrets.

## Risks / Trade-offs

- **[Risk] OAuth CSRF attack or replayed authorization codes**  
  → *Mitigation*: 32-byte cryptographically secure random state with 10-minute TTL; state is consumed immediately upon first validation attempt.
- **[Risk] Accidental credential exposure to frontend or telemetry logs**  
  → *Mitigation*: DTOs explicitly omit tokens; `StructuredLogger` never logs authorization codes or decrypted tokens; redirect URLs pass only status codes.
- **[Risk] Repeated disconnect or reconnect attempts cause race conditions or duplicate rows**  
  → *Mitigation*: `ConnectionStorageService.saveConnection` and `disconnect` atomically update the existing record.
- **[Risk] Unauthorized user connects or disconnects the organization's Notion source**  
  → *Mitigation*: `AdminAuthGuard` validates administrative API key on all connection management endpoints.

## Open Questions

*(None. All protocol specifications, endpoint shapes, access control patterns, and documentation requirements are resolved).*
