# XerService

XerService is a print-order platform with customer, administrator, shop-vendor, and native desktop experiences. Customers upload and configure documents, shops process paid orders, and administrators manage users, services, pricing, commissions, refunds, and settlements.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | Canonical Next.js application and API routes |
| `apps/user` | Customer web application on port 3001 |
| `apps/vendor` | Vendor web application on port 3002 |
| `apps/admin` | Administrator web application on port 3003 |
| `apps/desktop` | Tauri v2 vendor workstation and native print integration |
| `packages/backend` | Server-only auth, payments, pricing, finance, notification, and WhatsApp services |
| `packages/shared` | Shared domain helpers |
| `packages/printing` | Platform-neutral print contracts and validation |
| `packages/types` | Shared TypeScript types |
| `supabase/migrations` | Ordered database and storage migrations |
| `docs` | Architecture and product completion documents |

The architecture boundaries are documented in [docs/ARCHITECTURE_BOUNDARIES.md](docs/ARCHITECTURE_BOUNDARIES.md) and [docs/DESKTOP_ARCHITECTURE.md](docs/DESKTOP_ARCHITECTURE.md).

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

2. Copy `.env.example` to `.env.local` and provide the required values. When running an application directly from `apps/`, copy its relevant public values to that application's `.env.local`. The desktop Vite application uses the `VITE_*` values documented in the template.

3. Apply the SQL files in `supabase/migrations` to the intended Supabase project in filename order. Review the target project before applying migrations.

4. Start the canonical web and API application:

   ```bash
   pnpm dev
   ```

   The application runs at [http://localhost:3000](http://localhost:3000).

Individual applications can also be started with pnpm filters:

```bash
pnpm --filter @apps/user dev
pnpm --filter @apps/vendor dev
pnpm --filter @apps/admin dev
pnpm --filter @apps/desktop dev
```

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
