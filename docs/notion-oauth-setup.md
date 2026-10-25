# Notion OAuth Integration Setup Guide

This guide outlines how to configure, deploy, and verify the Notion OAuth 2.0 integration for the Knowledge Engine.

---

## 1. Prerequisites & Notion Portal Configuration

To connect a Notion workspace via OAuth, create a public integration in the Notion Developer Portal:

1. Navigate to the **[Notion Integrations Portal](https://www.notion.so/profile/integrations)**.
2. Click **+ New integration**.
3. Fill in basic information:
   - **Name**: e.g., `Knowledge Engine Assistant`
   - **Associated workspace**: Select your primary Notion workspace.
   - **Type**: Select **Public integration** (OAuth 2.0 requires Public type; Internal type only provides static internal integration tokens).
4. Fill in integration details:
   - **Company name**, **Website**, **Privacy policy**, and **Terms of use** (can be local placeholders or your organization's URLs).
5. Under **OAuth Domain & URIs**:
   - Add your redirect callback URI to **Redirect URIs**:
     - **Local development**: `http://localhost:5000/api/v1/integrations/notion/oauth/callback`
     - **Production**: `https://api.yourdomain.com/api/v1/integrations/notion/oauth/callback` (Notion requires HTTPS for production redirect URIs).
6. Under **Capabilities**:
   - **Read content**: Check `Read content`.
   - **Read user information without email**: Check (or with email if required).
7. Click **Submit** / **Save changes**.
8. Note the following credentials:
   - **OAuth Client ID**
   - **OAuth Client Secret**
   - **Authorization URL** (typically `https://api.notion.com/v1/oauth/authorize`)

> [!IMPORTANT]
> Never commit real OAuth Client Secrets or Access Tokens to version control. Always configure them via environment variables.

---

## 2. Environment Variables Configuration

Configure the backend and frontend environment files using placeholders.

### Backend (`apps/backend/.env.development` or `.env`)

```ini
# Application Port & Environment
PORT=5000
NODE_ENV=development

# Web Frontend URL for OAuth Redirects & CORS
FRONTEND_URL=http://localhost:3000
WEB_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000

# Administrator Authorization API Key (Protects integration endpoints)
ADMIN_API_KEY=your-secure-admin-api-key-here

# 32-byte Minimum Secret for AES-256-GCM Credential Encryption
ENCRYPTION_SECRET=your-32-byte-secure-encryption-secret-min!

# Notion OAuth Configuration
NOTION_CLIENT_ID=your-notion-client-id-here
NOTION_CLIENT_SECRET=your-notion-client-secret-here
NOTION_REDIRECT_URI=http://localhost:5000/api/v1/integrations/notion/oauth/callback
NOTION_AUTH_URL=https://api.notion.com/v1/oauth/authorize
```

### Frontend (`apps/web/.env.local` or `.env`)

```ini
# Backend API Base URL
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000

# Administrator API Key matching backend ADMIN_API_KEY
NEXT_PUBLIC_ADMIN_API_KEY=your-secure-admin-api-key-here
```

---

## 3. Running Locally

Start the development services across the workspace using `pnpm`:

```bash
# Start all workspace services (Backend on :5000, Frontend on :3000)
pnpm dev

# Or run individual workspaces:
pnpm --filter @my-project/backend dev
pnpm --filter @my-project/web dev
```

- **Frontend Dashboard**: Open `http://localhost:3000`
- **Integrations Page**: Open `http://localhost:3000/integrations`
- **Backend Swagger Docs**: Open `http://localhost:5000/api/docs`

---

## 4. End-to-End OAuth Testing Flow

1. Open `http://localhost:3000/integrations` in your browser.
2. The Notion card will display **Not Connected**.
3. Click **Connect Notion**.
4. The frontend calls `GET /api/v1/integrations/notion/oauth/authorize` with header `x-admin-key: <ADMIN_API_KEY>`.
5. The backend validates the admin key, generates a cryptographically secure 32-byte anti-CSRF state (10-minute TTL), and returns the Notion authorization URL.
6. The frontend redirects your browser to Notion's consent screen.
7. On Notion:
   - Select the Notion pages or databases you want to grant the Knowledge Engine access to.
   - Click **Allow access**.
8. Notion redirects to `GET /api/v1/integrations/notion/oauth/callback?code=...&state=...`.
9. The backend:
   - Validates and immediately consumes the state token (preventing replay attacks).
   - Exchanges the authorization code via HTTP Basic authentication against `https://api.notion.com/v1/oauth/token`.
   - Encrypts the received access token using AES-256-GCM (`iv.tag.ciphertext`).
   - Persists the single-tenant connection record.
   - Redirects the browser to `http://localhost:3000/integrations?status=success&workspace=<WorkspaceName>`.
10. The frontend displays a green success banner and renders the connected workspace card with workspace name, icon, and connection timestamp.
11. To disconnect, click **Disconnect** on the card and confirm the prompt. The backend removes credentials and transitions status to disconnected safely.

---

## 5. Security & Deployment Architecture

### Single-Tenant Constraint
- The application maintains a single, organization-wide Notion workspace connection.
- Reconnecting an existing workspace atomically overwrites the stored credentials and metadata without creating orphaned database rows.

### Administrator Access Control
- Connection management endpoints (`oauth/authorize`, `status`, `disconnect`) are protected by `AdminAuthGuard`.
- Requests must include either the `x-admin-key: <KEY>` header or `Authorization: Bearer <KEY>`.
- Calls without valid administrator credentials receive `401 Unauthorized`.
- Non-administrative users cannot inspect or modify third-party source connections.

### Token Protection & Anti-CSRF
- **Zero Token Leakage**: Notion access tokens and client secrets are never sent to the browser, never included in redirect query parameters, and never logged in telemetry or error stacks.
- **At-Rest Encryption**: Access tokens are encrypted using Node.js native AES-256-GCM authenticated encryption before being saved in storage.
- **CSRF & Replay Prevention**: OAuth states are random 32-byte hex strings with a strict 10-minute expiry and one-time consumption semantics.

### Production HTTPS & Redirect URI Requirements
- Notion's OAuth protocol requires **HTTPS** for redirect URLs in production environments (plain HTTP is only permitted on `localhost`).
- When deploying behind a reverse proxy (e.g., NGINX, Cloudflare, Traefik), ensure `X-Forwarded-Proto: https` is forwarded.
- The `NOTION_REDIRECT_URI` configured in your environment must exactly match the registered Redirect URI in the Notion Developer Portal.

---

## 6. Automated Testing

Verify the complete OAuth integration without making live requests to Notion:

```bash
# Run unit and contract tests in backend
pnpm --filter @my-project/backend test

# Run end-to-end OAuth contract test suite
pnpm --filter @my-project/backend test test/integrations/notion-oauth.e2e-spec.ts

# Type-check both workspaces
pnpm --filter @my-project/backend check-types
pnpm --filter @my-project/web check-types
```
