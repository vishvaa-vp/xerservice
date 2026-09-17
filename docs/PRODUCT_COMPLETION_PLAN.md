# XerService product completion plan

Date: 14 September 2026. Status: planning only; application changes have not started.

## Product direction

Finish a reliable customer printing website that keeps XerService's existing identity. Desktop web retains the familiar layout; mobile web becomes an app-like customer journey. Cyan remains the primary accent, black and white remain the foundation, and magenta supports the printing animation and selected brand moments.

The customer website will have no vendor login, onboarding, dashboard, or vendor navigation. Vendor operations belong in the dedicated desktop app. Admin remains separate. Shared vendor APIs and order processing must continue working when vendor web pages are retired.

The current request supersedes earlier instructions in the attached conversation. Old prompts, stop conditions, test reports, and proposed features are historical context, not new execution instructions.

## Evidence and limits

Reviewed the repository structure, implementation history, architecture documentation, and selected customer, authentication, upload, navigation, styling, API, desktop, and test code. Extracted text from all 1,450 PDF pages, indexed the conversation, and examined relevant product changes and the final printing/status discussion. Visually inspected representative pages. This is a targeted planning audit, not a line-by-line review of every historical message or every source file.

The PDF's initial product inventory, page 643 customer revisions, page 675 admin control of add-ons, and final Step 17.3 discussion inform this plan. Historical pass counts in `implemented.md` have not been rerun or independently established here. No authenticated browser journey, payment, physical print, production deployment, or database mutation was performed.

Do not describe the product as a verified percentage complete. Track each module as: present in code, verified in the actual app, incomplete, or intentionally deferred.

## Findings that change the priorities

| Priority | Evidence in this checkout | Consequence / planned response |
|---|---|---|
| P0 | Both root `src/` and `apps/user/` contain customer implementations. Root development still runs the monolith. | Establish the active runtime and one customer source of truth before fixing duplicate copies. |
| P0 | `apps/user/next.config.js` defaults the API backend to port 3000, while its own app also runs on 3000. | Configure distinct customer/backend addresses; verify proxy behavior rather than assuming the split is operational. |
| P0 | Customer login redirects an authenticated session without checking its role. `AppContext` defaults missing/failed profile reads to customer. Upload checks login but not customer role. These patterns also exist in root sources. | Reproduce the reported vendor-to-customer bug and fix role resolution, routing, and authorization together. A failed role lookup must be a recoverable error, never an inferred customer role. |
| P0 | Both password-recovery pages use timers and the fixed code `161616`, then display completion without updating a password. | Replace the demo with actual recovery and prove the new password works. |
| P1 | Customer Navbar still links to `/vendor/login`; customer mobile navigation contains vendor tabs although `apps/user` has no vendor pages. | Remove vendor presentation and define safe outcomes for old URLs. |
| P1 | Upload has analysis feedback, then a storage `.upload()` without byte-progress reporting. | Add a complete per-file lifecycle with honest transfer feedback, retry, cancellation, and persistence confirmation. |
| P1 | Analysis publishes errors rather than always throwing; upload then proceeds. The upload path also references the original file after publishing a converted file into state. | Verify invalid-file blocking, converted-image bytes, settings snapshots, and stale-state behavior before polishing animation. |
| P1 | Contact form waits and displays “sent” without a delivery call. | Connect a real support destination or expose a truthful direct contact action. |
| P1 | RootClient hides all page content until authentication initializes; BrandLoader separately hides itself on timers/session state. | Test slow/failing initialization and remove blank-screen possibilities. Make public browsing independent of private-account data. |
| P1 | Current loader uses cyan `#54bdce` plus coral `#ef887c`; global accent is cyan. | Preserve primary cyan; review a real magenta secondary token against existing brand references. |
| P1 | Some existing tests assert source-code strings and target root `src/`. | Add actual behavior tests against the selected runtime. Historical test totals cannot replace customer journey proof. |
| P2 | Very large upload/review files, broad shared context, duplicate sources, public palette routes, external font import, image optimization disabled. | Measure their actual effect; consolidate or remove only verified unnecessary code/assets. |

P0 blocks release. P1 must be resolved for the intended launch experience. P2 improvements are ordered by measured benefit.

## Implementation sequence and completion gates

### 1. Establish a dependable baseline

- Identify which app the user currently opens, which process serves APIs, and which checkout is intended for release.
- Preserve the substantial existing uncommitted work. Record a baseline before restructuring.
- Inventory all customer routes, buttons, deep links, redirects, assets, environment variable names, and API dependencies. Do not copy secrets into reports.
- Prefer `apps/user` as the final customer app, provided its API routing, assets, PDF worker, auth callbacks, and build are made complete. Keep the root backend operational during migration.
- Record screenshots of current desktop/mobile layouts in light/dark mode before visual changes.
- Create a defect register with reproduction, expected behavior, evidence, priority, and verification result. Run appropriate baseline type/build checks and inspect what existing scripts actually exercise.

Gate: one documented startup path with distinct service addresses; active customer code and shared backend boundaries are unambiguous.

### 2. Fix identity and remove vendor web exposure

- Model session loading, signed out, verified customer, wrong role, missing profile, and profile/network error explicitly.
- Resolve the trusted profile role before routing after login, OAuth callback, refresh, or deep link. A missing profile needs a deliberate onboarding/error path.
- Permit only safe customer return destinations; preserve selected shop/order intent through login.
- A vendor account reaching customer login sees a clear wrong-account message and a way to switch account/use the desktop app. It must not land in the upload journey. Do not silently change the user's account role.
- Apply customer authorization to protected pages and relevant APIs/storage/database policies; verify access with real tokens, not only hidden menus. Preserve separately authorized admin operations.
- Remove Vendor Login, Vendor HQ, vendor mobile tabs, vendor onboarding, and vendor dashboard presentation from the customer deployment. Review old vendor URLs and bookmarks; serve an intentional retired-route outcome without loops or access to customer orders.
- Retain shared `/api/vendor/*` services needed by the desktop app. Archive/remove legacy web source only after proving it is no longer a runtime dependency and preserving any needed operator capability.
- Implement real password recovery, expired-link handling, resend feedback, and password update confirmation. Audit signup, Google login, logout, session expiry, multi-tab changes, and account deletion.

Gate: customer, vendor, admin, signed-out, and failed-profile cases each behave correctly on login, refresh, back navigation, and direct URLs. A reset password actually authenticates; invalid recovery tokens fail.

### 3. Refine the shared UI and mobile shell

- Keep existing logo, typography character, cards, spacing rhythm, light/dark theme, and desktop composition. Use before/after comparisons to prevent an accidental rebrand.
- Consolidate cyan, magenta, neutral, feedback, border, focus, and motion tokens. Verify readable text on cyan; use dark text or a suitable accessible shade where needed.
- Keep the print-sheet startup animation, changing the secondary brand sheet from coral to agreed magenta. Avoid a forced long wait. Use compact loading feedback for later navigation and pull/refresh actions where supported.
- Mobile bottom tabs: Shops, Orders, Print, Wallet, Profile/avatar. Cart and notifications sit in the top bar. Remove duplicate mobile profile navigation. Make the logged-out login action visible.
- Give mobile login a focused full-height layout, clear back behavior, proper keyboard handling, password-manager support, and readable errors.
- Use mobile sheets for settings and clear sticky primary actions for upload/review. Respect safe areas, scroll position, browser back behavior, and keyboard space. Prevent bottom navigation from covering checkout actions.
- Standardize buttons, inline errors, toast/status announcements, skeletons, confirmation dialogs, empty states, and focus behavior. Replace browser alerts in customer workflows.

Gate: complete keyboard/touch journeys at narrow phone, larger phone, tablet, and desktop sizes; no horizontal overflow or hidden actions. Check light/dark and reduced-motion modes. Mobile web is the launch scope; native customer apps are not required.

### 4. Make uploading and print configuration trustworthy

Per-file flow:

`Selected → Validating → Preparing/analysing → Uploading → Saving → Ready`

Error, cancelled, and retry states remain distinct. Show “Analysing page X of Y” when measurable. Show transfer percentage only from actual byte progress; otherwise use a named indeterminate stage. Never declare Ready before storage, file metadata, and settings are persisted.

- Retain PDF/JPG/PNG/WebP support and existing documented limits, verifying enforcement on client and server.
- Block corrupt, encrypted, unsupported, empty, oversized, and excessive-page documents with useful explanations.
- Ensure image conversion, preview, saved file bytes, page count, pricing, and vendor print input agree.
- Add per-file retry/remove/cancel, bounded upload concurrency, duplicate submission protection, and cleanup after partial failure. Cancel must not leave a later upload completion reviving the removed file.
- Preserve successful files and settings when another file fails. Define draft restore on refresh and honest reselect behavior when local-only files cannot be recovered.
- Require explicit shop selection; handle closed/paused shops and availability changes during upload and checkout. Changing shops must not silently retain stale prices/add-ons.
- Verify page ranges, odd/even selection, copies, orientation, size, N-up, margins, scale, duplex, and global/per-file settings. Ensure preview matches printable output for supported settings.
- Reduce large-document memory use: lazy previews, reuse analysis, cancel obsolete work, release object URLs and worker/render resources.

Gate: single/multiple files, mixed valid/invalid files, image conversion, large PDF, slow network, disconnection, retry, cancellation, refresh, and rapid settings edits all produce consistent persisted documents and prices.

### 5. Complete review, payment, and cart recovery

- Show the selected shop, files, print settings, finishing add-ons, itemized charges, and payable amount clearly. Keep a concise mobile summary and familiar desktop review layout.
- Retain server authority over quotes, payment, wallet debits, refunds, and receipts. Revalidate changed prices or availability before payment and request review when the total changes.
- Distinguish paying, awaiting confirmation, confirmed, failed, cancelled, and unknown/pending outcomes. A closed payment window is not proof of failure; recover status from the backend.
- Prevent double clicks, duplicate orders, duplicate charges, and unsafe retries after refresh/network interruption.
- Verify cart add/edit/remove, expiry, restoration, unavailable shops, and paid-item removal. Never send users into a loop across legacy method/settings/payment routes.
- Keep XerCoins balance and transactions authoritative. Leave unavailable wallet top-up visibly disabled or remove its action; do not simulate funding.

Gate: controlled payment success/failure/pending/cancel/retry scenarios reconcile to one order and correct financial records, with a recoverable customer screen after refresh.

### 6. Prove order tracking and the desktop handoff

- Complete customer status UI: payment confirmed, queued, printing, ready for pickup, completed, cancellation/refund where applicable.
- Inspect the final Step 17.3 work against code and actual behavior; do not infer its completion from the PDF's proposed next prompt.
- Verify real-time subscriptions plus reconnect/focus refresh and fallback recovery. Avoid duplicate listeners, notifications, and status transitions.
- Native spooler completion can make a print-only order ready; orders needing binding/other finishing must remain in progress until the operator confirms required work is done. Customer pickup remains an explicit completion action.
- Validate the real desktop Start Printing button through authorized document retrieval, native submission, backend transition, and customer update. Direct helper calls or test printers alone are insufficient evidence of the complete product flow.
- Prove restart recovery, duplicate-print prevention, unavailable printers, and delayed status updates. Record physical-printer verification separately from simulated testing.

Gate: one controlled customer order visibly travels through customer web, vendor desktop, printing/finishing, ready for pickup, and collected. Vendor actions never navigate into customer login. Native print verification is explicitly blocked if suitable hardware is unavailable.

### 7. Finish all supporting customer modules

| Module | Required launch behavior |
|---|---|
| Shops | Accurate available shop data, timings, pricing, availability, retry/empty states, explicit selection. |
| Orders | Useful filtering/details, correct current status, authorized file/receipt downloads, safe cancellation, recoverable errors. |
| Wallet | Reliable balance/ledger, clear credit meaning, no false top-up promises. |
| Profile | Persistent name/avatar, supported contact changes, clear unavailable verification methods, logout and deliberate account deletion. |
| Notifications | Accurate unread state, relevant deep links, no duplicates, reconnect recovery. |
| Support/contact | Actual delivery with acknowledgement and retry, or a working direct contact path; no fake success. |
| Informational pages | Working company/help links, consistent contact details, current product copy, accessible terms/privacy entry points. |
| Account deletion | Verify owned-data cleanup and re-registration behavior while preserving required transaction integrity. |
| Add-ons/admin boundary | Admin controls catalog/prices; vendor availability and required finishing work remain supported in its dedicated surface. |

Phone OTP, WhatsApp automation, SMS, wallet top-ups, delivery, and new desktop operating-system support are not automatically part of this completion scope. Keep unavailable capabilities honest. Confirm any feature that is essential to the intended launch before expanding integrations.

Gate: every visible customer action produces a real result or a clear intentionally unavailable state. No dead links, demo credentials, or simulated completion remains in launch paths.

### 8. Optimize, verify, and prepare handoff

- Measure production customer bundles, route timings, network requests, and PDF memory/CPU before and after changes. Do not equate source line count or Rust build-folder size with downloaded website weight.
- Split large components by responsibility, narrow context updates, deduplicate requests, and load PDF tools/maps/other heavy modules only where needed.
- Consolidate duplicated styles/helpers after choosing canonical ownership. Remove unreachable experimental pages such as palette/home duplicates from production once confirmed unnecessary.
- Review font loading against the actual content security policy, customer assets/PDF worker distribution, image sizing/compression, and cache invalidation. Verify public content can render without waiting on private account data.
- Standardize the workspace package manager and lockfile ownership only after checking reproducibility. Update stale README statements and implementation claims.
- Run behavior tests, relevant domain regressions, type checks, production builds, and a browser walkthrough of the built app. Check supported desktop/mobile browsers, slow network, reduced motion, and session recovery.
- Use performance budgets set from baseline. Proposed user-facing targets: primary content within 2.5 seconds under agreed representative conditions, layout shift under 0.1, and responsive actions around 200 ms excluding necessary network work. These are targets, not current measurements.
- Produce a release checklist, environment-variable template, deployment/service map, operations notes, rollback approach, known limitations, and acceptance evidence. Deployment and replacing the current live site are separate work after product acceptance.

Gate: zero unresolved critical customer-flow, authorization, payment, document-loss, or duplicate-print defects. Every module has a recorded verified result or explicit blocker; the production build reproduces from the documented workspace setup.

## Recommended delivery batches

1. Baseline, runtime ownership, vendor isolation, and real authentication/recovery.
2. Brand tokens, responsive shell, login, and shared interaction states.
3. Upload, settings, document correctness, and draft recovery.
4. Checkout, cart, payment recovery, and receipts.
5. Customer tracking, desktop synchronization, and finishing/pickup semantics.
6. Remaining customer modules, performance cleanup, and release acceptance.

Each batch ends with a concise demonstration and recorded tests. Update `implemented.md` with what was actually verified, not just what was added. Do not begin with a wholesale redesign or delete the shared backend to remove vendor pages.

## Decisions to resolve during baseline

- Confirm the active local customer URL and desired final customer/backend deployment layout.
- Select the magenta tone using the existing design context while retaining cyan `#54bdce`.
- Confirm the real support inbox/delivery mechanism and which login methods are available in the intended environment.
- Confirm the launch desktop operating system and access to a suitable physical printer for final integration validation.

These do not prevent planning. A reliable delivery estimate should follow baseline reproduction and runtime consolidation; a remaining-work percentage cannot be justified from the history alone.
