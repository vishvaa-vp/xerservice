# XerService

XerService is a print-order platform with customer, administrator, shop-vendor, and native desktop experiences. Customers upload and configure documents, shops process paid orders, and administrators manage users, services, pricing, commissions, refunds, and settlements.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | One website: customers, admin, support, and API routes |
| `apps/desktop` | Tauri v2 vendor workstation and native print integration |
| `packages/backend` | Server-only auth, payments, pricing, finance, notification, and WhatsApp services |
| `packages/shared` | Shared domain helpers |
| `packages/printing` | Platform-neutral print contracts and validation |
| `packages/types` | Shared TypeScript types |
| `supabase/migrations` | Ordered database and storage migrations |
| `docs` | Architecture and product completion documents |

Older multi-frontend migration documents in `docs/` describe historical plans. The supported setup is now one website plus the desktop app.

## Prerequisites

- Node.js 20 or newer
- pnpm 10
- A Supabase project for authentication, PostgreSQL, and private document storage
- Razorpay credentials for live payments
- Rust and the Tauri v2 platform prerequisites when building the desktop application
- A Meta app and WhatsApp Cloud API configuration when enabling WhatsApp features

## Local setup

1. Install dependencies:

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   ```

2. Copy `.env.example` to `.env.local` and provide the required values. The desktop automatically reuses the public Supabase URL and publishable key from this file. Optional desktop overrides belong in `apps/desktop/.env.local`; never put server secrets in `VITE_*` variables.

3. Apply the SQL files in `supabase/migrations` to the intended Supabase project in filename order. Review the target project before applying migrations.

4. Start the canonical web and API application:

   ```bash
   pnpm dev
   ```

   The application runs at [http://localhost:3000](http://localhost:3000).

The website includes customer pages at `/`, administration at `/admin`, and the existing admin support workspace at `/admin/support`. All use the same backend and Supabase project.

For the **native vendor desktop app**, keep the website running and open a second terminal in this folder:

```bash
pnpm desktop
```

This opens a native application window. `pnpm --filter @apps/desktop dev` starts only the browser preview and does not provide native printing. Close an existing preview server on port 1420 before launching Tauri.

To produce the macOS application and installer:

```bash
pnpm package:desktop
```

The `.app` and `.dmg` are written under `apps/desktop/src-tauri/target/release/bundle/`. Local development connects to the website on port 3000. A distributed build needs the intended production backend configured and signing/notarization for normal macOS distribution.

## Validation

```bash
pnpm audit:publication
pnpm typecheck
pnpm test
pnpm build:all
```

For the native shell, also run:

```bash
pnpm --filter @apps/desktop tauri build
```

The native build requires the operating-system print stack and Tauri toolchain. The web build verifies the desktop UI without creating an installer.

## Security and configuration

- Secret values belong only in ignored environment files or the deployment secret store.
- Variables prefixed with `NEXT_PUBLIC_` or `VITE_` are compiled into browser code and must contain public configuration only.
- `SUPABASE_SECRET_KEY`, Razorpay secrets, Meta app secrets, webhook secrets, and WhatsApp access tokens are server-only.
- Customer documents use private storage and authenticated download routes. Do not change buckets to public access.
- Webhook events are accepted only after HMAC signature verification. Configure Meta to use `/api/webhooks/whatsapp`; the older `/api/whatsapp/webhook` path is a compatible alias.
- WhatsApp media download and Embedded Signup are disabled by default. Enable their flags only after server credentials, provider callbacks, and deployment logging have been verified.
- The Embedded Signup callback exchanges authorization codes on the server and never returns tokens to the browser. Operational WhatsApp API calls currently use `WHATSAPP_ACCESS_TOKEN` from the deployment secret store.
- Desktop sessions use in-memory token storage. Production desktop builds default to `https://api.xerservice.in` unless `XERSERVICE_BACKEND_URL` is supplied at compile time.

## Deployment checklist

Before deploying:

1. Run the complete validation commands above.
2. Confirm production environment variables are configured on each service.
3. Confirm Supabase Row Level Security and storage policies are enabled in the target project.
4. Register the Razorpay and Meta webhook URLs over HTTPS and verify their signatures.
5. Keep `WHATSAPP_MEDIA_DOWNLOAD_ENABLED=false` until private storage ingestion has been exercised with a real provider event.
6. Enable HSTS only after every production hostname is HTTPS.
7. Build and sign desktop installers through the release platform for each supported operating system.

No deployment is performed by this repository automatically. Provider dashboards, domain records, secret stores, app signing, and production database migration remain explicit release operations.
