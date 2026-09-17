# XerService — Implementation History

> **What is this?** A simple, step-by-step record of everything that has been built in XerService so far. Written in plain English so anyone can understand what was done and why.
>
> **Last Updated:** September 15, 2026

---

## September 15, 2026 — Checkout recovery verification

- Kept the existing UI; stabilized empty document state to avoid redundant checkout effects.
- Added recoverable feedback when a manual payment-status request fails.
- Verified saved PDF preview restoration after refresh, pending-payment persistence, repeat-payment blocking, and confirmed-payment reconciliation with isolated browser fixtures.
- Fixed the root admin users page production build by adding its required Suspense boundary.
- Passed 28 browser checks against both development and production, 19 product checks, 6 customer-role checks, and 6 desktop handoff checks. Root, customer app, and desktop builds passed; existing lint warnings remain.
- Database migration, live authentication delivery, payments, and physical printing still require deployment/environment verification. These tests did not perform live transactions or printing.

## Tech Stack (What Technologies We Use)

### Frontend (What customers and vendors see)
| Technology | Version | Purpose |
|---|---|---|
| **Next.js** | 15.5.24 | Main web framework for all three web apps (User, Vendor, Admin) |
| **React** | 18 | UI component library |
| **TypeScript** | 5.x | Type-safe JavaScript for all codebases |
| **Tailwind CSS** | 3.x | Utility-first styling for web apps |
| **Lucide React** | 0.394 | Icon library |
| **Leaflet + React Leaflet** | 1.9.4 | Interactive maps for shop discovery |
| **Chart.js + react-chartjs-2** | 4.4.3 | Charts and graphs for dashboards |
| **PDF.js** | 6.3.289 | PDF document rendering and analysis in browser |
| **pdf-lib** | 1.17.1 | PDF manipulation (sheet calculation, page extraction) |

### Backend (Server-side logic)
| Technology | Version | Purpose |
|---|---|---|
| **Supabase** | — | Database (PostgreSQL), Authentication (GoTrue), File Storage |
| **Supabase JS Client** | 2.116.0 | Server and client-side Supabase access |
| **Row Level Security (RLS)** | — | Database-level security policies on every table |
| **PostgreSQL RPCs** | — | Server-side atomic business logic functions |
| **Razorpay** | Standard Checkout | Payment gateway for UPI, cards, netbanking, wallets |

### Desktop Native App (Vendor printing workstation)
| Technology | Version | Purpose |
|---|---|---|
| **Tauri** | v2.11.5 | Native desktop framework (Rust backend + WebView frontend) |
| **Rust** | 1.98.1 | Native desktop runtime, CUPS integration, persistence |
| **Vite** | 8.3.0 | Frontend bundler for desktop WebView |
| **macOS CUPS** | — | Native print spooler integration (`/usr/bin/lp`, `/usr/bin/lpstat`) |

### Shared Packages (Reusable across all apps)
| Package | Purpose |
|---|---|
| `@packages/types` | Pure TypeScript type contracts (orders, printing, addons, finance, user) |
| `@packages/printing` | Platform-neutral printing contracts, hardware validators, mock provider |
| `@packages/shared` | Shared utilities and helpers |
| `@packages/backend` | Backend domain services (pricing, ledger, auth) |

### Monorepo Structure
| Folder | What it is |
|---|---|
| `apps/user` | Customer-facing web app (Next.js, port 3000) |
| `apps/vendor` | Vendor dashboard web app (Next.js, port 3002) |
| `apps/admin` | Admin control panel web app (Next.js, port 3003) |
| `apps/desktop` | Vendor printing desktop app (Tauri v2 + Vite + Rust) |
| `packages/types` | Shared TypeScript types |
| `packages/printing` | Printing domain contracts |
| `packages/shared` | Shared utilities |
| `packages/backend` | Backend business services |
| `supabase/migrations/` | 20 database migration files |
| `src/` | Original monolithic app (being migrated into apps/) |
| `scripts/` | Automated verification and test scripts |
| `docs/` | Architecture documentation |

### Tools & Build System
| Tool | Purpose |
|---|---|
| **pnpm** | Package manager with workspace support |
| **pnpm-workspace.yaml** | Monorepo workspace configuration |
| **Cargo** | Rust build system for the desktop app |
| **Node.js** | v24.19.0 runtime |

---

## Step-by-Step Implementation History

---

### Step 1 — Architecture Freeze & Boundary Documentation

**What we did:**
Documented the complete architecture of the existing XerService monolithic application before making any changes. Created `docs/ARCHITECTURE_BOUNDARIES.md` that maps out every page, API route, database table, and security boundary.

**Why it matters:**
Before splitting a monolith into separate apps, you need to understand exactly what exists. This document became the blueprint for all future steps.

**What was produced:**
- `docs/ARCHITECTURE_BOUNDARIES.md` — Complete architecture specification
- Identified 47 API route handlers in `src/app/api/`
- Catalogued all database tables, RLS policies, and storage buckets
- Defined the three-app split: User, Vendor, Admin

---

### Step 2 — Database Foundation (Supabase Migrations)

**What we did:**
Created the complete database schema across 20 PostgreSQL migration files. Every table has Row Level Security (RLS) enforced so customers can only see their own data, vendors can only manage their own shop, and admin has controlled access.

**Why it matters:**
The database is the single source of truth. All pricing, payments, and order status live here. No client can bypass it.

**Key database tables created:**
- `profiles` — User accounts with verified phone identity
- `shops` & `shop_pricing` — Vendor shop details and per-shop pricing rules
- `orders` & `order_files` & `print_settings` — Customer print orders with file attachments
- `order_status_history` — Audit trail of every order status change
- `payment_attempts` & `payment_webhook_events` — Razorpay payment tracking
- `wallet_accounts` & `wallet_transactions` — XerCoins wallet ledger
- `order_financial_ledger` — Authoritative order-level financial accounting
- `shop_commission_rules` — Admin-controlled commission rates
- `notifications` & `notification_outbox` — In-app and external notifications
- `order_receipts` — Printable receipt records
- `shop_addons` — Admin-controlled print add-on services (binding, lamination, etc.)

**Key server-side functions (RPCs):**
- `apply_verified_order_pricing()` — Atomic pricing calculation (service_role only)
- `transition_vendor_order_status()` — Safe order state machine (QUEUED → PRINTING → READY → COMPLETED)
- `process_order_cancellation()` — Cancellation with automatic refund routing
- `checkout_with_wallet()` — Atomic wallet payment processing

---

### Step 3 — API Routes & Backend Services

**What we did:**
Built all 47 server-side API route handlers that power the platform. Every endpoint verifies authentication, checks authorization, and uses Supabase RLS for data access.

**Why it matters:**
All business logic runs on the server. The client never calculates prices, processes payments, or modifies financial records directly.

**Key API groups:**
- **Customer APIs** (`/api/customer/`) — Orders, wallet, phone sync, account deletion
- **Order APIs** (`/api/orders/`) — Order cancellation, payment preparation, pricing quotes
- **Payment APIs** (`/api/payments/razorpay/verify`) — Razorpay payment verification with HMAC-SHA256
- **Webhook APIs** (`/api/webhooks/razorpay`) — Idempotent payment webhook processing
- **Vendor APIs** (`/api/vendor/`) — Order queue, status transitions, finance summary, settlements, add-ons
- **Admin APIs** (`/api/admin/`) — User/vendor management, commission rules, settlement lifecycle, add-on management
- **Utility APIs** — PDF analysis, shop lookup, health check, notifications

---

### Step 4 — Customer Web Application (`apps/user`)

**What we did:**
Built the complete customer-facing web application where users discover shops, upload documents, configure print settings, pay, and track their orders.

**Key features:**
- **Shop Discovery** — Browse shops by location with interactive Leaflet maps
- **Document Upload** — Upload PDF, Word, and image files for printing
- **Print Settings** — Configure copies, color mode, paper size, duplex, orientation, page range
- **Live Print Preview** — Real-time PDF canvas preview showing what will be printed
- **Pricing Calculator** — Server-verified pricing based on shop rates, pages, settings, and add-ons
- **Payment Flow** — Razorpay Standard Checkout (UPI, Cards, Netbanking) + XerCoins Wallet
- **Order Dashboard** — Track order status, download receipts, view history
- **Wallet** — XerCoins balance, transaction history, wallet checkout
- **Profile** — Phone verification, account settings, account deletion
- **Notifications** — In-app notification bell with read/unread management

---

### Step 5 — Vendor Web Application (`apps/vendor`)

**What we did:**
Built the vendor dashboard where shop owners manage their incoming print orders, update order status, view their financial earnings, and manage print add-on availability.

**Key features:**
- **Order Queue** — Live list of incoming orders (QUEUED, PRINTING, READY, COMPLETED)
- **Order Status Management** — Transition orders through the lifecycle (QUEUED → PRINTING → READY → COMPLETED)
- **Order Details** — View customer documents, print settings, and add-ons for each order
- **Document Download** — Securely download customer files for printing (authorized via vendor Bearer token)
- **Order Cancellation** — Vendor-initiated cancellation with automatic refund handling
- **Finance Dashboard** — Earnings summary, order-level financial breakdown
- **Settlement Tracking** — View settlement batches and payout status
- **Add-on Management** — Toggle availability of platform-wide add-ons for their shop

---

### Step 6 — Admin Web Application (`apps/admin`)

**What we did:**
Built the admin control panel where platform administrators manage users, vendors, financial controls, commission rules, settlements, and print add-ons.

**Key features:**
- **User Management** — View, search, and manage customer accounts, reset passwords
- **Vendor Management** — View, search, and manage vendor accounts, reset passwords
- **Commission Controls** — Create and apply commission rules (basis points) to shops
- **Settlement Management** — Create settlement batches, confirm, mark as paid, cancel settlements
- **Financial Overview** — Platform-wide financial summary and shop-level breakdown
- **Add-on Administration** — Create, edit, delete, and image-upload for platform print add-ons (binding, lamination, stapling, etc.)
- **Login Security** — Admin cookie-based authentication, separate from customer/vendor auth

---

### Step 7 — Desktop Architecture Specification

**What we did:**
Created the architectural blueprint for the future native desktop application. Documented the authority model, communication protocols, and security boundaries. No code was written in this step — it was purely a design and planning phase.

**What was produced:**
- `docs/DESKTOP_ARCHITECTURE.md` — Complete desktop architecture specification
- Defined the desktop as an "untrusted client shell" — it can only talk to the backend via HTTPS
- Specified three future desktop targets: Operator Workstation, Vendor Print Station, Kiosk Controller
- Established that the desktop NEVER calculates prices, processes payments, or directly accesses the database

---

### Step 8 — Native Printing Package (`packages/printing`)

**What we did:**
Created the platform-neutral printing contracts package. This is the shared language that the desktop app, test suites, and future printing systems all speak.

**Why it matters:**
Every printer, print job, and capability is represented as a standardized TypeScript type. No matter what OS or printer driver is used, the data always looks the same.

**What was created:**
- `PrintJobRequest` — Normalized print job submission request
- `PrintJobResult` — Execution result from a print provider
- `PrintJobStatusInfo` — Real-time status telemetry for a print job
- `NormalizedPrinter` — Standardized printer representation with capabilities
- `PrinterCapabilities` — Paper sizes, color support, duplex support, max copies, trays
- `PrintProvider` interface — Abstract interface for native printing adapters
- `validateJobAgainstPrinter()` — Fail-closed capability validation
- `normalizePrinterError()` — Converts any OS error into a standard error format
- `MockPrintProvider` — In-memory mock implementation for testing

**Test results:** 46/46 tests passed.

---

### Step 9 — Desktop Workspace Scaffolding (`apps/desktop`)

**What we did:**
Created the `apps/desktop` workspace with Tauri v2 configuration, Vite build system, TypeScript setup, and the basic HTML/CSS desktop shell. This is the foundation that all future desktop features are built on.

**What was created:**
- `apps/desktop/` — Complete Tauri v2 project structure
- `apps/desktop/src-tauri/` — Rust backend with `Cargo.toml` and `tauri.conf.json`
- `apps/desktop/index.html` — Desktop UI shell with dark theme
- `apps/desktop/styles.css` — Custom desktop styling
- `apps/desktop/src/main.ts` — TypeScript entry point
- `apps/desktop/src/ipc.ts` — IPC bridge for WebView ↔ Rust communication
- Security capabilities configuration (controlled IPC access)

**Test results:** 170/170 tests passed.

---

### Step 10 — Native Tauri v2 Runtime Foundation

**What we did:**
Made the desktop app actually launch as a real native macOS window. The Rust backend responds to IPC commands from the WebView, and the WebView can call Rust functions and display the results.

**What works:**
- Native macOS window launches at 1100×720 pixels
- Rust IPC handler responds to 6 core commands
- `get_runtime_info` — Returns app name, version, platform, Tauri version
- `get_printing_capabilities` — Returns platform printing capabilities
- `list_printers` — Discovers printers from the OS
- `submit_print_job` — Submits a print job (with validation)
- `get_print_job_status` — Queries job status
- `cancel_print_job` — Cancels a print job
- Frontend telemetry records all IPC lifecycle stages (A through F)

**Test results:** 16/16 tests passed.

---

### Step 11 — Native macOS Printer Discovery & Capabilities

**What we did:**
Connected the desktop app to the real macOS CUPS printing system. The app now discovers all physical printers installed on the computer and reads their actual hardware capabilities (paper sizes, color support, duplex, trays).

**How it works:**
1. Runs `/usr/bin/lpstat -p` to list all installed printers
2. Runs `/usr/bin/lpstat -d` to find the default printer
3. Runs `/usr/bin/lpoptions -p <printer> -l` to read each printer's capabilities
4. Normalizes everything into `NormalizedPrinter` objects

**Safety:**
- Zero shell interpolation — all commands use direct process execution with argument arrays
- Printer IDs are validated against malicious characters before being used in commands
- If CUPS is not available, returns an empty list (never crashes)

**Test results:** 30/30 tests passed.

---

### Step 12 — Real Native Print Job Submission

**What we did:**
Added the ability to actually submit a print job to a real physical printer through macOS CUPS. The desktop app generates a controlled test document, validates the printer destination, and submits via `/usr/bin/lp`.

**How it works:**
1. Validates that a real printer destination is selected
2. Generates a deterministic test document (never uses customer data for testing)
3. Builds `/usr/bin/lp` command with proper flags (`-d`, `-n`, `-o`)
4. Executes the command and parses the genuine native job ID from the output
5. Records the submission result in the persistence store

**Safety:**
- Only controlled test documents are submitted (never real customer orders yet)
- If no printer is available, submission is safely rejected with `PRINTER_NOT_FOUND`
- All command arguments are sanitized against shell injection

**Test results:** 23/23 tests passed.

---

### Step 12.1 — Printer Capability Truthfulness Fix

**What we did:**
Fixed a critical issue where the printer capability discovery could fall back to fake default values (like "A4 supported" or "max copies = 99") when CUPS didn't provide the information. Now, if a capability is unknown, it is reported as `null` (unknown) — never as a fabricated value.

**The rule:**
> Absence of information must NOT be treated as a capability.

**What changed:**
- If CUPS doesn't report paper sizes → empty array (not `['a4']`)
- If CUPS doesn't report color support → `null` (not `false`)
- If CUPS doesn't report duplex support → `null` (not `false`)
- If CUPS doesn't report max copies → `null` (not `99`)
- The capability validator now rejects requests when the capability is unknown (`null`), not just when it's explicitly unsupported

**Test results:** Included in Step 11 suite — 30/30 tests passed.

---

### Step 13 — Native Print Job Status & Queue Tracking

**What we did:**
Added the ability to ask "What happened to this print job?" by querying the native CUPS spooler for real-time job status.

**Status mapping (CUPS → XerService):**
| CUPS Status | XerService Status | Meaning |
|---|---|---|
| `pending` / `held` | `QUEUED` | Job is waiting in the queue |
| `processing` | `PRINTING` | Job is actively being printed |
| `completed` | `COMPLETED` | Spooler reports job is done |
| `cancelled` | `CANCELLED` | Job was cancelled |
| `aborted` / `stopped` | `FAILED` | Job failed |
| Not found | `FAILED` | Job disappeared from CUPS |

**Critical rule:**
> A missing or disappeared job is NEVER reported as `COMPLETED`. If CUPS doesn't know about a job, it's `FAILED`.

**Test results:** 23/23 tests passed.

---

### Step 14 — Native Print Job Control & Safe Cancellation

**What we did:**
Added the ability to safely cancel a native print job that was previously submitted to CUPS.

**How it works:**
1. Validates the job ID format (rejects malformed/injected IDs)
2. Checks if the job is in a cancellable state (`QUEUED` or `PRINTING`)
3. Executes `/usr/bin/cancel <job-id>` to request cancellation
4. Does NOT immediately assume cancellation succeeded — requires follow-up status check

**Safety rules:**
- Cannot cancel jobs in terminal states (`COMPLETED`, `CANCELLED`, `FAILED`)
- External (non-XerService) jobs cannot be cancelled
- Cancel command failure is honestly reported, never hidden

**Test results:** 20/20 tests passed.

---

### Step 15 — Native Print Queue Management & Safe Recovery

**What we did:**
Built the queue inspection and recovery layer. The desktop app can now see all jobs in the native CUPS spooler, identify which ones belong to XerService, and safely handle stale or missing jobs.

**Key features:**
- List all jobs in the CUPS print queue for all printers or a specific printer
- Mark each job as "XerService Managed" or "External" based on the job title
- External jobs are protected — XerService cannot cancel or modify them
- Stale jobs that disappeared from CUPS are flagged, never silently ignored
- Desktop UI shows a live queue table with status pills and cancel buttons

**Test results:** 19/19 tests passed.

---

### Step 16 — Native Print Job Persistence & Order-Safe Job Mapping

**What we did:**
Made print job records survive application restarts, crashes, and WebView reloads. Every print job is durably written to a JSON file on disk with atomic write guarantees.

**How the persistence works:**
1. Records are written to `xerservice_print_jobs.json` in the app data directory
2. Writes use atomic file operations: write to temp file → flush to disk → rename
3. If the file is corrupted, it's backed up and a fresh store is created
4. Duplicate records are automatically deduplicated on load
5. Terminal states (`COMPLETED`, `CANCELLED`, `FAILED`) are immutable — once done, they stay done

**Startup recovery:**
When the desktop app starts, it automatically reconciles all non-terminal jobs against CUPS:
- Jobs that were interrupted before submission → marked `INVESTIGATION_REQUIRED` / `FAILED` (never blindly re-submitted)
- Jobs with a native ID that disappeared from CUPS → marked `MISSING_FROM_CUPS` / `FAILED` (never fabricated as `COMPLETED`)
- Already completed jobs → left untouched

**Test results:** 28/28 tests passed.

---

### Step 17 — Real Order → Vendor Desktop → Native Printing Integration

**What we did:**
Connected everything together. For the first time, a real paid XerService customer order can flow from the Supabase database through the vendor's desktop app to the native CUPS printer.

**The complete flow:**

```
CUSTOMER                          VENDOR DESKTOP                    PRINTER
   |                                    |                              |
   |  1. Upload document                |                              |
   |  2. Configure print settings       |                              |
   |  3. Pay via Razorpay/Wallet        |                              |
   |  4. Order becomes QUEUED           |                              |
   |                                    |                              |
   |                              5. Fetch orders with token           |
   |                              6. See order in queue table          |
   |                              7. Click "Review & Print"            |
   |                              8. Select printer                    |
   |                              9. Validate capabilities             |
   |                             10. Click "Start Printing"            |
   |                                    |                              |
   |                             11. Download document (authorized)    |
   |                             12. Stage temp file + SHA-256         |
   |                             13. Submit to CUPS via /usr/bin/lp ---|---> Physical Print
   |                             14. Delete temp file immediately      |
   |                             15. Update order: QUEUED → PRINTING   |
   |                                    |                              |
   |                             16. Monitor CUPS status               |
   |                             17. CUPS says "completed"             |
   |                             18. Update order: PRINTING → READY    |
   |                                    |                              |
   |  19. Customer picks up order       |                              |
   |  20. Vendor marks: READY → COMPLETED                              |
```

**Critical safety rules enforced:**
1. **Payment is never enough to print** — Vendor must explicitly click "Start Printing" after reviewing the order
2. **Unpaid orders cannot be printed** — Orders without `PAID` payment status are blocked (`UNPAID_ORDER_BLOCKED`)
3. **No duplicate printing** — If an order already has an active print job, a second attempt is blocked (`DUPLICATE_PRINT_BLOCKED`)
4. **Printer must be compatible** — Color, paper size, duplex, and copies are validated against the real printer's capabilities before submission
5. **CUPS completed ≠ Order completed** — When the printer finishes, the order becomes `READY` (waiting for pickup), NOT `COMPLETED`. The `COMPLETED` status is reserved for when the customer actually picks up the order.
6. **Temp files are deleted immediately** — Customer document bytes are removed from disk right after submission. Only metadata (filename, fingerprint, job ID) is stored permanently.
7. **Zero secrets on the desktop** — No Supabase service keys, no Razorpay secrets, no database credentials exist anywhere in the desktop app.

**What was built:**
- `processOrderPrint()` — Complete order-to-print pipeline function
- Vendor orders table in desktop UI (fetched via authenticated API)
- Order print confirmation drawer (document details, printer selection, capability validation)
- `save_temp_document` Rust IPC command (stages file + computes SHA-256)
- `get_order_print_job` Rust IPC command (looks up order mapping)
- Window test hooks for automated verification (`__xerserviceProcessOrderPrint`, `__xerserviceGetOrderJobMapping`, `__xerserviceFetchVendorOrders`)

**Test results:** 25/25 tests passed.

---

### Step 17.1 — XerService Vendor Desktop Product UI Integration

**What we did:**
Transformed the desktop application from an internal developer diagnostic workstation into a production-grade Vendor Desktop application matching the XerService Vendor HQ visual design system.

**Why it matters:**
Print shop operators need a clean, intuitive, and distraction-free interface to manage and print customer orders without being exposed to raw CUPS logs, internal IDs, JSON payloads, or terminal diagnostics.

**What was built:**
1. **Production Layout & Sidebar Navigation:**
   - Fixed left sidebar with XerService branding and connected shop indicator.
   - Tabbed view switcher: Overview, Orders, Print Queue, and Reports.
   - Vendor identity avatar with one-click sign out.
   - Top status bar with live printer readiness indicators and global refresh.

2. **Overview Dashboard:**
   - Quick-glance metric cards: Queued Orders, Printing Now, Ready for Pickup, and Detected Printers.
   - Recent orders preview list with direct one-click review actions.
   - Hardware detection banner alerting operators if no physical printers are connected.

3. **Orders Management View:**
   - Full orders data table with customer name, document names, total printable pages, order amount, and status badge.
   - Status filtering tabs: All, Queued, Printing, Ready, and Completed.
   - "Print" action button for actionable orders and "View" for terminal states.

4. **Interactive Order Detail Modal:**
   - Full document breakdown: filename, page counts, sheet counts, paper size, color mode, sides/duplex, orientation, and copies.
   - Add-on badges (binding, lamination, stapling).
   - Dynamic printer selection with real-time capability validation against printer hardware.
   - Order lifecycle progress tracker (`QUEUED` → `PRINTING` → `READY` → `COMPLETED`).
   - Actionable "Start Printing" button with progress spinner and friendly error explanations.

5. **Integrated Print Queue View:**
   - Live native spooler monitoring showing document titles, destination printers, and current status.
   - Safe job cancellation for operator-managed jobs.
   - Session job history log.

6. **Secure Vendor Authentication Flow (Supabase Auth & In-Memory Session):**
   - Reuses the existing Supabase Auth authority directly with registered vendor email and password.
   - Zero token-pasting: vendor logs in with credentials identical to the Vendor HQ web portal.
   - Dual-layer authorization: verifies `public.profiles.role === 'vendor'` and confirms shop ownership in `public.shops` (unauthorized or customer accounts are immediately rejected).
   - In-memory session storage: access tokens and session data are held strictly in process RAM via a custom `inMemoryStorageAdapter` and wiped on sign out.
   - Zero credentials in `localStorage` or unencrypted disk files; zero raw tokens displayed in the UI.

7. **Term & Diagnostic Cleansing:**
   - All internal technical terms (CUPS, Rust, IPC stages, localJobId, nativeJobId, persistence JSON, Step numbers) completely hidden from operator view.
   - Physical printer counts reflect host reality (0 physical printers on dev hardware shows 0, disabling print submission honestly).

**Verification & Regression:**
- 400/400 automated regression tests passing across all Steps 8 through 17.
- Full TypeScript type-check and Vite production build passed.
- Full Tauri v2 release build compiled cleanly.
- Strict zero-boundary rule maintained (`apps/user`, `apps/vendor`, `apps/admin`, and `supabase` 100% untouched).

---

## Full Test Suite Summary

| Test Script | What it Tests | Results |
|---|---|---|
| `test-order-to-native-print-integration.mjs` | Step 17: Order → Native Print | **25/25 ✅** |
| `test-desktop-print-persistence.mjs` | Step 16: Durable Persistence | **28/28 ✅** |
| `test-desktop-print-queue.mjs` | Step 15: Queue Management | **19/19 ✅** |
| `test-desktop-print-control.mjs` | Step 14: Job Cancellation | **20/20 ✅** |
| `test-desktop-print-status.mjs` | Step 13: Status Tracking | **23/23 ✅** |
| `test-desktop-print-submission.mjs` | Step 12: Print Submission | **23/23 ✅** |
| `test-desktop-printer-discovery.mjs` | Step 11 & 12.1: Discovery | **30/30 ✅** |
| `test-desktop-runtime.mjs` | Step 10: Tauri Runtime | **16/16 ✅** |
| `test-desktop-foundation.mjs` | Step 9: Workspace Setup | **170/170 ✅** |
| `test-printing-package.mjs` | Step 8: Printing Package | **46/46 ✅** |
| **TOTAL** | | **400/400 ✅** |

---

## Database Migrations (Complete List)

| Migration | Purpose |
|---|---|
| `create_initial_schema` | Users, shops, shop pricing |
| `create_orders_schema` | Orders, order files, print settings, status history |
| `create_order_documents_storage` | Private document storage bucket with RLS |
| `create_apply_verified_order_pricing` | Atomic server-side pricing calculation |
| `create_payments_schema` | Payment attempts, webhook idempotency |
| `create_vendor_status_rpc` | Safe vendor order state machine |
| `add_payment_method_to_payment_attempts` | Track UPI/Card/Netbanking/Wallet method |
| `create_wallet_schema` | XerCoins wallet accounts and transactions |
| `fix_wallet_shop_availability` | Fix shop availability check for wallet checkout |
| `create_cancellation_and_refund_engine` | Order cancellation and automatic refund routing |
| `create_notifications_system` | In-app notification system |
| `create_notification_outbox` | External notification delivery queue |
| `harden_verified_phone_identity` | Phone number verification and uniqueness |
| `create_order_receipts` | Printable receipt generation |
| `create_vendor_financial_ledger` | Vendor earnings, commission deductions, settlements |
| `fix_vendor_ledger_refund_audit` | Fix refund audit trail in vendor ledger |
| `create_admin_finance_controls` | Admin commission rules and settlement lifecycle |
| `create_account_deletion_architecture` | GDPR-compliant account deletion |
| `create_admin_controlled_print_addons` | Platform-wide print add-on services |
| `fix_addon_service_role_trigger` | Fix add-on trigger permissions |

---

## API Routes (Complete List)

### Customer APIs
- `GET /api/customer/orders` — List customer's orders
- `GET /api/customer/orders/[orderId]/files/[fileId]/download` — Download order document
- `GET /api/customer/orders/[orderId]/receipt` — Get order receipt
- `GET /api/customer/wallet` — Wallet balance and transactions
- `POST /api/customer/phone/sync` — Sync verified phone number
- `POST /api/customer/account/delete` — Delete account (GDPR)

### Order APIs
- `POST /api/orders/[orderId]/cancel` — Cancel an order
- `POST /api/orders/[orderId]/payment/prepare` — Prepare Razorpay payment
- `POST /api/orders/[orderId]/payment/wallet` — Pay with XerCoins wallet
- `POST /api/orders/[orderId]/quote` — Get server-verified pricing quote

### Payment APIs
- `POST /api/payments/razorpay/verify` — Verify Razorpay payment signature
- `POST /api/webhooks/razorpay` — Razorpay webhook (idempotent)

### Vendor APIs
- `GET /api/vendor/orders` — List shop's active orders
- `GET /api/vendor/orders/[orderId]/files/[fileId]/download` — Download customer document (authorized)
- `POST /api/vendor/orders/[orderId]/status` — Transition order status
- `POST /api/vendor/orders/[orderId]/cancel` — Vendor-initiated cancellation
- `GET /api/vendor/overview` — Shop dashboard overview
- `GET /api/vendor/addons` — List add-ons for shop
- `PUT /api/vendor/addons/[id]/availability` — Toggle add-on availability
- `GET /api/vendor/finance/summary` — Financial summary
- `GET /api/vendor/finance/orders` — Financial order history
- `GET /api/vendor/settlements` — Settlement history

### Admin APIs
- `GET/POST /api/admin/users` — List and manage users
- `GET/PUT /api/admin/users/[userId]` — View and update user
- `POST /api/admin/users/[userId]/reset-password` — Reset user password
- `GET/POST /api/admin/vendors` — List and manage vendors
- `GET/PUT /api/admin/vendors/[userId]` — View and update vendor
- `POST /api/admin/vendors/[userId]/reset-password` — Reset vendor password
- `GET/POST /api/admin/addons` — List and create add-ons
- `PUT/DELETE /api/admin/addons/[id]` — Update and delete add-ons
- `POST /api/admin/addons/upload-image` — Upload add-on image
- `GET /api/admin/finance/summary` — Platform financial summary
- `GET /api/admin/finance/shops` — Per-shop financial data
- `GET /api/admin/finance/shops/[shopId]` — Shop financial detail
- `GET/POST /api/admin/finance/commission-rules` — Commission rules
- `POST /api/admin/finance/commission-rules/[ruleId]/apply` — Apply commission rule
- `GET/POST /api/admin/finance/settlements` — Settlement batches
- `GET /api/admin/finance/settlements/[id]` — Settlement detail
- `POST /api/admin/finance/settlements/[id]/confirm` — Confirm settlement
- `POST /api/admin/finance/settlements/[id]/mark-paid` — Mark settlement paid
- `POST /api/admin/finance/settlements/[id]/cancel` — Cancel settlement

### Utility APIs
- `GET /api/health` — Health check
- `POST /api/pdf/analyze` — Analyze uploaded PDF
- `GET /api/shops/[shopId]/addons` — Get shop's available add-ons
- `GET/POST /api/notifications` — List and create notifications
- `POST /api/notifications/[id]/read` — Mark notification read
- `POST /api/notifications/read-all` — Mark all notifications read

---

> **Note:** This document will be updated as new steps are implemented.
