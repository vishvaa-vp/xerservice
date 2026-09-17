# XerService Desktop Architecture

> **Document Status**: DRAFT / SPECIFICATION ONLY (Step 7 Architectural Foundation)
> **Implementation Scope**: Boundary definition and interface design only. **Zero native code, zero Tauri/Electron wrappers, and zero native printing drivers implemented in Step 7.**
> **Security Policy**: The desktop layer is strictly an untrusted client/operator shell. All financial authority, payment validation, and database access remain centralized in the backend.

---

## 1. Purpose

This document formalizes the architectural boundaries, security contracts, and communication protocols for the future desktop and native application layers of the **XerService** platform.

The desktop layer is designed to provide operating-system-level capabilities—such as hardware device integration, local spooler interaction, and physical kiosk peripherals—while consuming the **existing authoritative XerService backend and Supabase infrastructure**.

```mermaid
flowchart TD
    subgraph DesktopLayer [Untrusted Client Shell: Desktop Application Layer]
        DesktopApp["Future Desktop Shell (Tauri / Webview)\n- Operator UI & Presentation\n- Local Hardware Peripherals\n- OS Spooler Integration (Future)"]
    end

    subgraph SecurityBoundary [Network & Protocol Boundary (HTTPS / TLS)]
        APIGateway["Centralized XerService API Gateway\n(https://api.xerservice.in)"]
    end

    subgraph CentralBackend [Authoritative Backend Domain (ONE Central Core)]
        BackendServices["@packages/backend Domain Services\n- Pricing Engine & Quote Authority\n- Razorpay HMAC & Refund Verification\n- Vendor Ledger & Settlement Locking\n- Order Lifecycle State Machine"]
        SupabaseCore["Supabase PostgreSQL & Auth\n- RLS Security Policies & Triggers\n- User & Profile Verification\n- Immutable Financial Ledger"]
    end

    DesktopApp -- "HTTPS REST + Bearer JWT" --> APIGateway
    APIGateway --> BackendServices
    BackendServices --> SupabaseCore
```

---

## 2. Applications

The future desktop application tier encompasses three potential operational targets, all acting as presentation clients over the centralized platform API:

1. **XerService Desktop (Operator Application)**:
   - A dedicated multi-window workstation application for campus operations and regional hub administrators.
   - Provides low-latency local cache management and widescreen operator dashboards.
   - *Status*: Conceptual future target; not implemented in Step 7.

2. **Vendor Print Station (Order Fulfillment Terminal)**:
   - Installed at partner print shops to manage active printing queues.
   - Receives incoming print jobs over authenticated websockets or server-sent events.
   - Connects directly to local production printers for automated or semi-automated output.
   - *Status*: Conceptual future target; not implemented in Step 7.

3. **Kiosk Controller (Automated Self-Service Terminal)**:
   - Runs in kiosk mode on unattended hardware stations (e.g., library or college campus kiosks).
   - Interfaces with coin acceptors, UPI display QR screens, and physical touch displays.
   - *Status*: Conceptual future target; not implemented in Step 7.

---

## 3. Authority Model

The XerService architecture enforces a strict tripartite separation of authority:

| Architectural Tier | Authority Level | Permitted Responsibilities | Prohibited Actions |
|---|---|---|---|
| **Desktop Client Shell** | **Untrusted Client** | User interface, operator interaction, local caching, invoking OS printer dialogs or local hardware drivers | Calculating order pricing, validating payments, mutating ledger balances, creating settlement batches |
| **Centralized Backend API** | **Authoritative Application** | Validating JWT authentication, executing business logic, pricing calculation, signature verification, outbox queueing | Direct client trust, accepting client-computed financials |
| **Supabase PostgreSQL** | **Authoritative Persistence** | Atomic transactions, immutable audit trails, RLS enforcement, sequences, database triggers | Running untrusted client logic without validation |

---

## 4. Communication

The future desktop client shell communicates with the centralized backend strictly over standard web protocols:

```
Future Desktop Client
        ↓
    HTTPS / TLS
        ↓
XerService Centralized API Routes (/api/*)
        ↓
@packages/backend & Centralized Services
        ↓
Supabase Database & Storage
```

- **Authentication Protocol**: The desktop client obtains a standard Supabase Auth session (`access_token` and `refresh_token`) via email/password or OTP login against GoTrue.
- **Request Authorization**: Every API request dispatches the token in standard format: `Authorization: Bearer <access_token>`.
- **API Parity**: Desktop applications use the exact same REST endpoints (`/api/orders/*`, `/api/vendor/*`, `/api/admin/*`) consumed by the web applications (`apps/user`, `apps/vendor`, `apps/admin`).

---

## 5. Printing Boundary

The boundary between current web printing and future native printing is explicitly delineated:

### Current Browser Printing (Step 7 — Preserved 100%)
- Rendered using client-side JavaScript (`pdfjs-dist` and `LivePrintPreview.tsx`).
- File uploads analyzed client-side via Web Workers and server-side via `pdf-lib`.
- Print specifications modeled purely using `@packages/types` (`PrintSettings`, `DbPrintSettings`) and calculated via `@packages/shared` (`sheetDimensions`, `selectedPageNumbers`, `pagesOnSide`).
- Fulfillment preview operates inside the web browser without native OS requirements.

### Future Native Printing (Step 8+ — Post-Migration)
- The desktop shell will bridge jobs to the host operating system's native spooler (CUPS on Linux/macOS, WinSpool on Windows).
- Silent printing and automated tray/duplex/finishing configuration via native driver APIs.
- Physical printer state telemetry (out of paper, paper jam, low ink/toner).
- **CRITICAL**: None of these native capabilities are implemented in Step 7.

---

## 6. Security Boundary

Desktop client binaries are distributed to physical hardware and cannot be trusted with secrets.

### Strictly Forbidden in Desktop Binaries
Under no circumstances may any desktop build, package, configuration, or bundle contain:
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `ADMIN_COOKIE_SECRET`
- `DATABASE_URL` / Direct PostgreSQL connection strings
- Private cryptographic signing keys

### Permitted in Desktop Binaries
Desktop clients are restricted to public, client-safe configuration:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (anon key)
- `NEXT_PUBLIC_RAZORPAY_KEY_ID` (public checkout ID)
- Public API endpoint URL (e.g., `https://api.xerservice.in` or local proxy URL)

---

## 7. Future Native Capabilities (Backlog / Step 8+)

The following capabilities represent future native work and are **STRICTLY EXCLUDED** from Step 7:

1. **Printer Discovery**: Enumeration of networked and USB printers via SNMP, Bonjour/mDNS, or Windows Print Spooler APIs.
2. **Printer Selection & Mapping**: Associating specific physical print queues with particular shop kiosks.
3. **OS Print Settings**: Direct driver-level control over paper feed trays, DPI, resolution, and post-print stapling/binding hardware.
4. **Local Spooler Integration**: Native queue management bypassing the browser print dialog.
5. **Kiosk Hardware Drivers**: Serial/USB communication with coin acceptors, thermal receipt printers, and barcode/QR scanners.
6. **Hardware Health Telemetry**: Monitoring physical device temperature, paper levels, and UPS battery backup status.

---

## 8. Summary & Next Steps

Step 7 established the architectural contract for the future desktop tier without modifying application runtime behavior or introducing premature native dependencies. Existing web applications in `apps/user`, `apps/vendor`, and `apps/admin` continue operating independently.

---

## Step 8 — Native Printing Foundation

> **IMPORTANT ARCHITECTURAL DISCLAIMER**:
> **"Step 8 establishes the native printing contract only. It does not provide physical printer access."**
> Zero OS-specific print spooler drivers, zero CUPS/WinSpool bindings, zero native executables, zero background daemons, and zero physical printer interactions are implemented in Step 8.

### 8.1 Why Native Printing is Required

While browser-based printing satisfies simple customer document preview, campus-scale production hubs and unattended kiosks require native hardware access:

1. **Unattended / Silent Printing**: Self-service kiosks and high-volume shop fulfillment queues cannot rely on human operators clicking through OS print dialogs for every document.
2. **Hardware-Level Configuration**: Production workloads require automated selection of physical input trays (e.g., bypass tray for photo paper, tray 1 for standard A4, tray 2 for A3), resolution/DPI tuning, and post-print finishing (stapling, booklet folding, punching).
3. **Hardware Health Telemetry**: Real-time detection of low toner, paper depletion, paper jams, door-open sensors, and offline connectivity.
4. **Queue Management**: Direct control over host print spooler priority, cancellation of runaway jobs, and byte-level transfer monitoring.

### 8.2 Why Browser Printing is Insufficient

Modern web browsers enforce strict security sandboxes that deliberately prevent web applications from controlling printers:

- **Sandbox Barriers**: JavaScript running in web browsers cannot enumerate local or network printer hardware, query driver capabilities, or select specific printer trays.
- **Mandatory User Confirmation**: Browser `window.print()` triggers an interactive modal dialog requiring human intervention, making automated queue processing impossible.
- **Opaque Telemetry**: The web browser does not report whether a print job actually spooled, completed, ran out of paper, or jammed.
- **Single-Job Execution**: Browsers cannot batch, reorder, or programmatically cancel spooler jobs across multiple client sessions.

### 8.3 Web ↔ Native Communication Boundary

To guarantee security, maintainability, and clean decoupling, the native printing tier is isolated behind the following protocol boundary:

```mermaid
flowchart TD
    subgraph WebApps [Web Presentation Tier (apps/user, apps/vendor, apps/admin)]
        ClientUI["Web UI Client\n(Browser Preview / pdfjs-dist / Settings Form)"]
    end

    subgraph Backend [Centralized Authoritative Core (Backend API)]
        BackendAPI["XerService API Gateway\n(Validates Auth, Pricing, Order State)"]
        PrintJobContract["PrintJobRequest Payload\n(Generated & Authorized by Backend)"]
    end

    subgraph NativeTier [Desktop / Native Layer (Future Tauri / Shell)]
        NativeShell["Desktop Native Runtime\n(Tauri Shell / Worker)"]
        Provider["PrintProvider Interface\n(@packages/printing)"]
        OSSpooler["Host OS Spooler\n(CUPS on Linux/macOS, WinSpool on Windows)"]
    end

    subgraph PhysicalTier [Physical Hardware Tier]
        PhysicalPrinter["Physical Printer\n(LaserJet, Copier, Kiosk Peripheral)"]
    end

    ClientUI -- "REST / WebSocket" --> BackendAPI
    BackendAPI --> PrintJobContract
    PrintJobContract -- "Authenticated Job Dispatch" --> NativeShell
    NativeShell --> Provider
    Provider --> OSSpooler
    OSSpooler --> PhysicalPrinter
```

**Boundary Rules**:
- The web applications (`apps/user`, `apps/vendor`, `apps/admin`) **MUST NOT** directly access OS printers or spooler APIs.
- The future native runtime is exclusively responsible for:
  - Local printer discovery
  - Device selection & capability reporting
  - Capability validation against job requests
  - Spooler job submission
  - Real-time status tracking & cancellation
  - Translating host spooler errors into normalized error models

### 8.4 The `@packages/printing` Foundation Package

The core contracts reside in `@packages/printing`, a platform-neutral TypeScript library:

```
packages/printing/
├── package.json        # Private workspace package depending only on @packages/types
├── tsconfig.json       # Pure ES2020 compiler config (zero DOM, zero Node builtins)
└── src/
    ├── types.ts        # Domain models (PrintJobRequest, NormalizedPrinter, etc.)
    ├── provider.ts     # PrintProvider interface, validator, error normalizer, MockPrintProvider
    └── index.ts        # Public package barrel exports
```

#### 8.4.1 Print-Job Model
The print job contract strictly separates three phases:
1. **`PrintJobRequest`**: The authorized request from the application/backend to print a document (includes `jobId`, `orderId`, `orderNumber`, `fileId`, `fileName`, `documentUri`, `mimeType`, `settings`, `copies`, `colorMode`, `paperSize`, `duplexMode`, `shopId`).
2. **`PrintDestination`**: Target hardware selected by the operator or runtime (includes `printerId`, `tray`, `resolutionDpi`, `mediaType`).
3. **`PrintJobResult`**: Execution outcome reported by the runtime (includes `jobId`, `status`, `printerId`, `submittedAt`, `completedAt`, `nativeJobId`, `pagesPrinted`, `error`).

#### 8.4.2 Printer Model
Hardware is modeled via `NormalizedPrinter`:
- `printerId`: Unique device identifier or URI.
- `name`: Human-readable device name (e.g., "Office LaserJet Pro M404").
- `status`: Normalized state (`'idle' | 'busy' | 'offline' | 'error'`).
- `isDefault`: Whether the printer is the OS default.
- `capabilities`: Hardware limits (`supportedPaperSizes`, `colorSupported`, `duplexSupported`, `supportedOrientations`, `maxCopies`, `trays`).

#### 8.4.3 Normalized Job Status Lifecycle
Print execution follows a low-level technical spooling lifecycle:

$$\text{QUEUED} \longrightarrow \text{SUBMITTING} \longrightarrow \text{PRINTING} \longrightarrow \text{COMPLETED}$$
$$\text{or} \longrightarrow \text{FAILED} \quad / \quad \text{CANCELLED}$$

> [!IMPORTANT]
> **Technical vs. Business Lifecycle**:
> `PrintJobStatus` (`QUEUED`, `SUBMITTING`, `PRINTING`, `COMPLETED`, `FAILED`, `CANCELLED`) represents low-level spooler and hardware transmission state.
> It does **NOT** replace or modify the authoritative XerService `OrderLifecycleStatus` (`DRAFT` $\rightarrow$ `AWAITING_PAYMENT` $\rightarrow$ `QUEUED` $\rightarrow$ `PRINTING` $\rightarrow$ `READY` $\rightarrow$ `COMPLETED` $\rightarrow$ `CANCELLED`). The backend orchestrates business order updates based on aggregated print job events.

#### 8.4.4 Normalized Error Model
Host printer errors vary wildly across operating systems. Adapters translate OS-specific codes into canonical `PrintErrorCode` values:
- `PRINTER_NOT_FOUND`: Target device missing or unregistered.
- `PRINTER_OFFLINE`: Physical device unplugged, powered off, or network unreachable (retryable).
- `PRINTER_BUSY`: Device processing another job or experiencing paper jam (retryable).
- `UNSUPPORTED_PAPER_SIZE`: Requested paper size (e.g. Legal, A3) not loaded in hardware.
- `UNSUPPORTED_COLOR_MODE`: Color print requested on monochrome printer.
- `UNSUPPORTED_DUPLEX`: Two-sided print requested on simplex-only hardware.
- `INVALID_DOCUMENT`: Corrupted PDF or unreadable print stream.
- `PRINT_SUBMISSION_FAILED`: Spooler rejected submission (e.g., copies exceed limit).
- `PRINT_CANCEL_FAILED`: Job already committed or cannot be aborted.
- `PRINT_TIMEOUT`: Communication timed out waiting for printer response (retryable).
- `UNKNOWN_PRINT_ERROR`: Unclassified runtime failure.

### 8.5 Security Boundary Invariants

1. **Centralized Authority**: The native printing layer is strictly an untrusted executor. It is **NEVER** an authority for order ownership, payment verification, pricing, refunds, wallet balances, vendor commissions, or settlements.
2. **Zero Server Secrets**: No desktop binary or package may contain `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`, `ADMIN_COOKIE_SECRET`, or database credentials.
3. **Minimum Principle of Privilege**: The desktop runtime receives only the metadata and signed URL required to fetch the specific PDF payload for the authorized print job.

### 8.6 File & Document Handling Lifecycle

To prevent customer data leaks on shared or public print shop workstations:
```
Backend Authorized URL
        ↓
Native Runtime (Tauri / Local Agent)
        ↓
Encrypted Temporary Spool Buffer (Memory or ephemeral disk)
        ↓
Physical Print Spooler Transmission
        ↓
Immediate Secure Buffer Deletion (Zero lingering customer PDFs)
```
- Customer documents are **never permanently cached** on vendor workstations or kiosk local storage.
- Ephemeral spool files are unlinked immediately upon spooler confirmation or job cancellation.

### 8.7 Audit & Telemetry Logging

All printing operations emit sanitized telemetry via `createPrintJobLog()`:
- **Logged**: `jobId`, `orderId`, `printerId`, `timestamp`, `operation`, `normalizedStatus`, `errorCode`, redacted error messages.
- **Strictly Prohibited from Logs**: Customer document bytes, PDF text, file contents, auth tokens, passwords, customer phone numbers, or server secrets.

### 8.8 Future Native Adapters (Roadmap)

When native runtime development commences in subsequent steps, the following concrete adapters will implement the `PrintProvider` interface:
1. **Windows Adapter (`WinSpoolPrintProvider`)**: Uses Win32 Print Spooler APIs (`OpenPrinter`, `StartDocPrinter`, `WritePrinter`, `GetJob`) to support silent printing and tray selection on Windows workstations.
2. **macOS / Linux Adapter (`CupsPrintProvider`)**: Uses CUPS C-API / IPP (`ippCreateRequest`, `cupsPrintFile`) to interact with Unix print queues.
3. **Desktop Shell Wrapper**: A Tauri plugin exposing `PrintProvider` IPC methods to frontend React components via strongly-typed Tauri commands.

### 8.9 Step 8 Implementation Exclusions

The following capabilities are **INTENTIONALLY NOT IMPLEMENTED** in Step 8:
- ❌ CUPS daemon integration
- ❌ Windows Print Spooler C/Win32 integration
- ❌ macOS CorePrinting / Cocoa print APIs
- ❌ Automatic mDNS / Bonjour / SNMP printer discovery
- ❌ Silent physical printing
- ❌ Printer driver installation or OS print queue creation
- ❌ Tauri application shell or Electron wrapper
- ❌ Native Rust / C++ / C# binaries
- ❌ Background system service or local print daemon
- ❌ Physical kiosk peripheral integrations (coin acceptors, scanners)

---

## Step 9 — Desktop Runtime Foundation (Tauri v2)

> **STEP 9 ARCHITECTURAL SCOPE**:
> Step 9 establishes the dedicated desktop runtime foundation at `apps/desktop/` using **Tauri v2**. It defines the native application shell, minimal operator presentation, and a typed IPC command boundary bridging the frontend to `@packages/printing`.
> **Physical printer access, native spooler bindings, and OS driver calls remain strictly NOT IMPLEMENTED.**

### 9.1 Why Tauri v2 is Used

XerService selected **Tauri v2** over Electron and other desktop frameworks for five critical architectural reasons:

1. **Minimal Memory & Resource Footprint**: Print shop terminals and campus kiosks often run on modest hardware. Tauri utilizes the host operating system's native webview (WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux), producing binaries under 15 MB with idle memory consumption around 30–50 MB (compared to 150+ MB for Electron).
2. **Rust-Powered Memory Safety & Concurrency**: The native runtime core is written in Rust, eliminating data races, null-pointer dereferences, and memory safety vulnerabilities when interfacing with future low-level C print spooler APIs.
3. **Granular Capability Security Model**: Tauri v2 enforces strict permission capabilities (`capabilities/*.json`). Arbitrary shell execution, unrestricted filesystem read/write, and open HTTP networking are disabled by default.
4. **IPC Protocol Performance**: High-throughput binary streaming and JSON-RPC invocation between webview and Rust runtime minimize latency when transferring document metadata.
5. **Cross-Platform Compilation**: A unified codebase targeting Windows (production print shops), macOS (operator workstations), and Linux (low-cost campus kiosk terminals).

### 9.2 Desktop Runtime Responsibility

The desktop application (`apps/desktop`) serves as an **untrusted client operator workstation**:
- It provides a responsive desktop shell showing workstation readiness and backend connectivity.
- It acts as the local bridge between the operator and future hardware devices.
- It translates frontend print dispatch requests into validated IPC messages.
- It **never** acts as an authority for business logic, pricing, payments, refunds, or financial transactions.

```mermaid
flowchart TD
    subgraph WebviewTier [Desktop Frontend Shell (apps/desktop/src)]
        FrontendUI["Desktop Webview UI\n- Operator Status Display\n- Print Subsystem Telemetry"]
        IPCClient["Typed IPC Bridge\n(apps/desktop/src/ipc.ts)\n- Uses @packages/printing Contracts"]
    end

    subgraph TauriRuntime [Tauri v2 Native Runtime (apps/desktop/src-tauri)]
        TauriCore["Tauri Core Engine & Window Manager\n(Strict Capabilities: core:default)"]
        CommandHandlers["Rust IPC Command Handlers\n(src-tauri/src/lib.rs)\n- Validates Envelopes\n- Returns Normalized Responses"]
    end

    subgraph FutureAdapters [Platform Adapters: FUTURE / NOT IMPLEMENTED]
        AdapterStub["Future Platform Adapter Layer\n- WinSpool / CUPS / Cocoa\n[NOT IMPLEMENTED IN STEP 9]"]
        PhysicalPrinter["Physical OS Printer / Spooler\n[NOT IMPLEMENTED IN STEP 9]"]
    end

    FrontendUI --> IPCClient
    IPCClient -- "Tauri IPC (invoke)" --> TauriCore
    TauriCore --> CommandHandlers
    CommandHandlers -. "Future Native Call" .-> AdapterStub
    AdapterStub -. "Future Hardware Call" .-> PhysicalPrinter
```

### 9.3 Frontend vs. Rust Responsibilities

| Tier | Component | Responsibilities | Strictly Prohibited |
| :--- | :--- | :--- | :--- |
| **Frontend Shell** | `apps/desktop/src/` | • Mounts UI presentation<br>• Queries runtime status & capabilities<br>• Consumes `@packages/printing` types<br>• Displays operational telemetry | • Direct OS driver calls<br>• Local file persistence of customer PDFs<br>• Calculating order pricing or wallet balances |
| **Rust Runtime** | `apps/desktop/src-tauri/` | • Window lifecycle management<br>• Restrictive CSP enforcement<br>• Validates IPC command payloads<br>• Returns normalized error codes (`NO_NATIVE_ADAPTER`)<br>• Future bridge to host spooler | • Order state machine transitions<br>• Razorpay / payment verification<br>• Supabase service-role client instantiation<br>• Hardcoding server secrets |

### 9.4 IPC Command Boundary

The Rust runtime exposes 6 platform-neutral IPC commands matching `@packages/printing` semantics:

1. **`get_runtime_info`**:
   - Returns application name, version, Tauri version, environment (`development`), host OS platform, and configured backend URL.
2. **`get_printing_capabilities`**:
   - Returns platform capabilities. In Step 9, returns `supports_silent_printing: false`, `supports_job_cancellation: false`, `native_adapter_status: "NOT_IMPLEMENTED"`.
3. **`list_printers`**:
   - Returns an empty list (`[]`). Does not fabricate virtual or mock printers at the native layer.
4. **`submit_print_job(job_id)`**:
   - Rejects print execution with status `FAILED` and error code `NO_NATIVE_ADAPTER`. Does not send data to physical devices.
5. **`get_print_job_status(job_id)`**:
   - Accurately reports that no physical job exists in the native spooler (`status: "FAILED"`, `error_code: "NO_NATIVE_ADAPTER"`).
6. **`cancel_print_job(job_id)`**:
   - Returns `false` safely, confirming no physical spooler job exists to cancel.

### 9.5 Printing Boundary

The desktop runtime enforces a strict unidirectional dependency for printing contracts:
$$\text{apps/desktop} \longrightarrow \text{@packages/printing} \longrightarrow \text{@packages/types}$$
- The desktop frontend imports domain models (`PrintJobRequest`, `PrintJobResult`, `NormalizedPrinter`, `PlatformPrintingCapabilities`) directly from `@packages/printing`.
- No duplicate `printing.ts` or alternative `PrintProvider` interface exists in `apps/desktop`.
- The Rust IPC signatures align with these models.

### 9.6 Security & Permission Model

1. **Restrictive Capabilities (`capabilities/default.json`)**:
   - Only `core:default` is enabled.
   - Shell command execution, arbitrary process spawning, and unconstrained filesystem access are completely disabled.
2. **Content Security Policy (`tauri.conf.json`)**:
   - `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:* https://api.xerservice.in`
   - Network requests are constrained to localhost and the authoritative XerService API gateway.
3. **Zero Server Secrets**:
   - Under no circumstances does `apps/desktop` contain `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`, `ADMIN_COOKIE_SECRET`, or direct database URLs.

### 9.7 Authentication & Backend Gateway Boundary

The desktop client follows the standard untrusted client authentication protocol:
```
Vendor Operator signs in via Authoritative Supabase Auth / Backend
        ↓
Desktop shell receives temporary short-lived session JWT
        ↓
Desktop shell dispatches requests via HTTPS:
Authorization: Bearer <access_token>
        ↓
Centralized XerService Backend validates session and executes domain logic
```
- **No Second Auth Database**: Desktop does not create a local user database or custom auth server.
- **No Local Storage Auth**: Session credentials are kept ephemeral in memory or secure OS keystore.
- **Backend Authoritative**: Pricing, refunds, commissions, and order transitions remain centralized on the backend.

### 9.8 Future Native Printer Adapters (Roadmap)

In subsequent migration steps, concrete native adapters will be created in Rust:
- **Windows Adapter (`windows_spooler.rs`)**: Direct C FFI bindings to `winspool.drv` (`OpenPrinterW`, `StartDocPrinterW`, `WritePrinter`).
- **macOS / Linux Adapter (`cups_client.rs`)**: IPP / CUPS protocol client sending print streams to `/printers/<printer_name>`.
- **Hardware Telemetry Worker**: Background async task querying printer SNMP / USB status for paper and toner levels.

### 9.9 Step 9 Implementation Exclusions

The following remain **INTENTIONALLY NOT IMPLEMENTED** in Step 9:
- ❌ Physical printer discovery (USB / Network / SNMP / mDNS)
- ❌ Windows WinSpool API calls
- ❌ macOS CorePrinting / Cocoa print dialogs
- ❌ Linux CUPS IPP bindings
- ❌ Native printer drivers or virtual queues
- ❌ Silent physical printing
- ❌ Physical printer Tauri plugins
- ❌ Electron runtime
- ❌ Background OS service daemon
---

## Step 11 — Native Printer Discovery & Capabilities

> **STEP 11 ARCHITECTURAL SCOPE**:
> Step 11 implements the first real native printing layer for the Tauri desktop application (`apps/desktop/src-tauri/src/printing/`).
> It detects installed printers from the host operating system subsystem (macOS CUPS), normalizes device information and capabilities to `@packages/printing` contracts, and returns them across Tauri IPC.
> **Physical print job submission, spooling, and document printing remain strictly DEFERRED to Step 12.**

### 11.1 Native Architecture & Modularity

The native printing subsystem is modularized inside the Tauri application:

```
apps/desktop/src-tauri/src/
├── lib.rs                  # Core Tauri entrypoint, registers commands and IPC telemetry
├── main.rs                 # Standard desktop binary entry
└── printing/
    ├── mod.rs              # Subsystem interface: list_native_printers, get_platform_capabilities
    ├── capabilities.rs     # Capability detection, PPD parser, and camelCase Serde structs
    ├── discovery.rs        # Host OS printer discovery (macOS /usr/bin/lpstat subsystem)
    └── errors.rs           # Canonical print error mapping for native adapter errors
```

### 11.2 Host OS Subsystem Integration (macOS)

On macOS, printer discovery and capabilities are retrieved via native CUPS subsystem utilities:
1. **Destination & Status Enumeration**: Runs `/usr/bin/lpstat -p` to parse installed printers, statuses (`idle`, `busy`, `offline`), and queue states.
2. **Default Destination Query**: Runs `/usr/bin/lpstat -d` to identify the host operating system's configured default printer without guessing.
3. **Device URI & Connection Classification**: Runs `/usr/bin/lpstat -v` to categorize printer connectivity into `usb`, `network`, or `virtual`.
4. **PPD Option & Capability Inspection**: Runs `/usr/bin/lpoptions -p <name> -l` to inspect supported page sizes (`a4`, `a3`, `legal`), duplexer support, and color capabilities.

### 11.3 Strict Invariants Enforced

1. **Zero Mock/Fake Printers**: If the host operating system has 0 printers installed, the discovery adapter returns an empty vector (`[]`). It strictly does not inject synthetic or demonstration printers.
2. **Zero Physical Printing**: No physical document submission (`/usr/bin/lp`, `/usr/bin/lpr`, `NSPrintOperation`) is executed. Command `submit_print_job` continues to fail closed with `NO_NATIVE_ADAPTER`.
3. **Contract Parity with `@packages/printing`**: Structs use `#[serde(rename_all = "camelCase")]` ensuring complete fidelity with `NormalizedPrinter`, `PrinterCapabilities`, and `PlatformPrintingCapabilities`.
4. **Clean Boundary & Zero Secret Leakage**: The printing module contains zero database connections, zero backend server secrets, and zero financial logic.

---

## Step 12 — Real Native Print Job Submission

> **STEP 12 ARCHITECTURAL SCOPE**:
> Step 12 implements the real native print-job submission layer for the Tauri desktop application (`apps/desktop/src-tauri/src/printing/submission.rs`).
> It connects WebView &harr; Tauri IPC (`submit_print_job`) &harr; Rust &harr; Native Printing Adapter &harr; macOS CUPS spooler (`/usr/bin/lp`) for controlled test documents.
> **Customer order printing, automatic printing, and external downloads are strictly excluded.**

### 12.1 Native Submission Module Architecture

The native printing subsystem in `apps/desktop/src-tauri/src/printing/` now includes:

```
apps/desktop/src-tauri/src/printing/
├── mod.rs              # Exports submit_native_print_job, list_native_printers, capabilities
├── capabilities.rs     # Capability detection, PPD options parser
├── discovery.rs        # Host OS printer discovery (/usr/bin/lpstat)
├── errors.rs           # Canonical error mapping
└── submission.rs       # Real print submission engine (/usr/bin/lp execution)
```

### 12.2 Security & Process Execution Model

1. **Explicit Process Invocation**: All CUPS interactions use `std::process::Command::new("/usr/bin/lp")` with explicit, separated vector arguments (`.arg("-d")`, `.arg("-n")`, `.arg("-o")`). Shell interpreters (`sh -c`, `bash -c`) and string concatenation are strictly forbidden.
2. **Printer Destination Validation**: Before any process is executed, the requested destination printer is verified against the host OS installed printers via `discover_installed_printers()`. Unknown destinations are rejected immediately with `PRINTER_NOT_FOUND`.
3. **Hardware Capability Validation**: Requested print settings (`copies`, `paperSize`, `colorMode`, `duplexMode`) are checked against discovered hardware limits. Unsupported requests return `PRINT_SUBMISSION_FAILED`, `UNSUPPORTED_PAPER_SIZE`, `UNSUPPORTED_COLOR_MODE`, or `UNSUPPORTED_DUPLEX`.
4. **Deterministic Test Document Only**: Submissions are strictly restricted to ephemeral, deterministic test documents ("XerService Native Print Test Step 12"). No customer files, backend URLs, or customer identities are used.

### 12.3 Lifecycle Telemetry & Honesty Invariant

The submission adapter logs explicit lifecycle stages:
- `STAGE_E_SUBMISSION_STARTED`: Adapter begins submission inspection.
- `STAGE_E_CUPS_SUBMISSION`: Safe `/usr/bin/lp` execution attempted.
- `STAGE_E_CUPS_ACCEPTED`: CUPS spooled job confirmed with `native_job_id`.
- `STAGE_E_SUBMISSION_FAILED`: Destination missing, offline, or rejected by spooler.

**Honesty Invariant**: The desktop layer never falsely reports `COMPLETED` for unverified print jobs or machines with 0 installed printers. When no destinations exist, it accurately reports `FAILED` with `PRINTER_NOT_FOUND`.
