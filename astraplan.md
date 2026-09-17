# XerService — Astra redesign and delivery plan

**Prepared:** 15 September 2026
**Status:** Planning only. Application code, database records, payments, and messages were not changed while preparing this document.
**Scope:** Admin, vendor desktop, customer website/mobile experience, shop configuration, earnings and settlements, PDF preview, and secure WhatsApp linking/importing.
**Direction:** Redesign the screens and navigation from a fresh product perspective while extending the working backend, authentication, order lifecycle, and native printing architecture.

## 1. The intended product

XerService should feel like one product across three workspaces:

- **Admin:** See what needs attention, manage people, open any vendor's shop, configure its services/prices/commission, and reconcile earnings and settlements.
- **Vendor desktop:** Receive orders, inspect the actual print output, print reliably, track shop earnings, and maintain the customer-facing shop profile.
- **Customer:** Discover a suitable shop, import documents, understand the print settings and exact price, pay, and follow collection progress.

Keep the cyan, magenta, black, and white brand. Replace generic dashboard layouts with clear hierarchy, real shop photography, purposeful cards, consistent controls, and useful feedback. Modernization must improve task completion and clarity rather than add decorative weight.

### Non-negotiable outcomes

1. No demo figures presented as real business activity.
2. People is the admin location for account edits. Customer summaries are read-only.
3. Vendors opens shop cards and dedicated shop workspaces; it never silently becomes the global finance page.
4. Every enabled print combination has an explicit, valid pricing path.
5. Printing and add-ons both participate in clearly defined commission policies.
6. Customer money is collected by XerService; shop earnings become eligible for settlement according to the existing completion/refund rules.
7. Vendor finance responses exclude private XerService commission fields.
8. Preview renders real PDF content and matches the document/settings dispatched to the printer.
9. Remove Print Queue from primary navigation while retaining the native queue, recovery, and duplicate-print protection.
10. Light, dark, and system theme work consistently across website and desktop.
11. WhatsApp linking proves control of the WhatsApp number on the server and persists across devices.
12. Every successful save represents a durable backend change; refresh must not undo it.

## 2. Findings from the screenshots, code, and connected database

### 2.1 What the screenshots demonstrate

| Evidence | Problem | Planned response |
|---|---|---|
| Admin Shops and Payments screenshots | The same finance page serves separate top-level navigation entries. Its Summary tab changes the active area to Payments. | Separate Vendors/shop management, Earnings, and Settlements routes. Keep only local sections within each area. |
| Admin finance layout | Large headings, repeated explanations, sparse space, and finance tables dominate ordinary shop tasks. | Compact page header, clear task cards, a focused shop workspace, contextual explanations next to unfamiliar fields. |
| Vendor desktop dashboard | Overview label, different visual language, fixed dark presentation, duplicated order/queue entry points. | Dashboard, Orders, Reports, and Shop settings within the shared XerService visual system. |
| Vendor order modal | The visible modal presents metadata and printer selection without a usable document canvas. | An order workspace with real PDF preview, thumbnails, document selection, printer compatibility, and clear action state. |
| Customer homepage | Wide horizontal shop row, generic image, large introductory panels, little useful browsing hierarchy. | Vertical photo cards, compact browsing controls, truthful service information, and a stronger mobile ordering flow. |

The screenshots are visual evidence, not proof that a displayed figure or action is backed by the database.

### 2.2 Verified code findings

| Area | Verified current behavior | Delivery implication |
|---|---|---|
| Admin dashboard | Both dashboard copies contain `INITIAL_CUSTOMERS`, `INITIAL_VENDORS`, `CONTACT_INBOX`, `mockAdminShops`, and `mockComplaints`. PrintHub Express and its owner/address are hardcoded. Several actions update React state; vendor requests use browser localStorage. | Rebuild these sections against authenticated APIs. Remove local-only operational actions from production. |
| People management | Existing admin users/vendor APIs already cover account management, shop assignment, and parts of account/order summaries. | Improve and reuse them; do not create another account-management system. |
| List scaling | Admin list handlers read broad datasets; the vendor handler reads only the first 1,000 Auth users. | Add accurate pagination/aggregation rather than silently incomplete totals as the product grows. |
| Shop pricing | `shop_pricing` is keyed by shop, paper size, colour mode, and sides. The engine calculates physical sheets after page selection, pages per side, duplex, and copies. | Complete shop configuration and capability validation. N-up does not inherently require a new price row for every value. |
| Add-ons | `addons`, `shop_addons`, images, per-shop prices, and order snapshots already exist. The service also contains an in-memory seeded fallback. | Move configuration into the shop workspace. Production persistence errors must not fall back to fake successful saves. |
| Commission | Existing ledger rules use a percentage of the order amount. Profit-based and fixed-per-unit models are not established by this implementation. | Introduce versioned policies and line-level snapshots before offering additional commission models. |
| Vendor financial privacy | Vendor finance summary returns the shared summary; vendor finance order responses select `commission_bps` and `platform_commission_amount`. | Remove private fields from vendor API projections, exports, logs, and caches, not just the visible dashboard. |
| Desktop | Tauri v2, Vite, TypeScript/DOM UI, Rust printing modules, persistent jobs, and CUPS integration exist. | Retain the native application and print controls. A React or Electron migration is unnecessary. |
| Desktop reports | Current report figures are reduced from the loaded `ui_orders` array. | Replace session-derived financial totals with server-backed statements and date-range aggregates. |
| Desktop settings presentation | Some display/compatibility branches manually interpret settings instead of using the shared canonical mapping. | Consolidate those touched branches around the existing mapper; test colour and both duplex edges explicitly. |
| Customer shop cards | Shop names/status/prices are queried from Supabase, but every card currently receives the same static shop image. | Use each shop's published image and provide a neutral fallback when none exists. |
| PDF foundation | PDF.js preview components, pdf-lib output preparation, and shared page/sheet geometry already exist. | Reuse the underlying rendering and print-layout contracts in the desktop preview. |
| WhatsApp | The current profile says unavailable. An old unused linking modal generates codes in the browser and accepts a universal test code. No reachable import of that modal was found in the inspected app pages. | Do not reactivate that component. Replace its verification logic with a real server-backed linking feature. |
| SMS login | The existing Supabase phone OTP flow was enabled in Stage 1; the user has configured Vonage in Supabase. | Preserve SMS login. WhatsApp business messaging needs its own setup and verification. |
| Page title | Customer metadata still contains `XerService (Tamilnadu)`. | Use `XerService` and page-specific titles without the regional suffix. |

### 2.3 Read-only database audit

These values were queried from the configured Supabase project on 15 September 2026. They are a point-in-time development-environment snapshot, not numbers to hardcode into the new UI.

**The configured Razorpay key is in test mode.** Database-backed records are not automatically real-money transactions. Existing records need transaction-level provenance before any report can label them live production sales. The current WhatsApp provider flag is `disabled`.

| Database record | Observed count |
|---|---:|
| Profiles | 9: 7 customer, 1 vendor, 1 admin |
| Shops | 1 |
| Active pricing rows | 3 |
| Orders | 39 |
| Add-on catalogue entries | 5 |
| Shop add-on assignments | 5 |
| Commission rules | 1 |
| Order financial ledger entries | 16 |
| Settlement batches | 0 |

No reliable count was returned for `support_tickets`; its deployed schema and persistence path remain unverified. Do not display zero as a verified support total.

The database shop is **D-Block Reprography ITECH**, status **OPEN**, with these prices:

| Paper | Colour | Sides | Price per physical sheet |
|---|---|---|---:|
| A4 | Black & white | Single | ₹2.00 |
| A4 | Colour | Single | ₹7.00 |
| A4 | Black & white | Double, long edge | ₹3.00 |

There are no other price rows in this snapshot. A3, Legal, colour duplex, and short-edge duplex therefore need configuration or must be unavailable. The report about two pages per side plus duplex could involve missing pricing, inconsistent settings mapping, or a specific UI path. Reproduce the exact combination before assigning a single root cause.

Current order groups:

| Order/payment status | Count |
|---|---:|
| Completed / paid | 7 |
| Cancelled / refunded | 9 |
| Cancelled / unpaid | 19 |
| Draft / unpaid | 2 |
| Awaiting payment / unpaid | 2 |

Current ledger interpretation, using the existing status definitions:

| Ledger group | Count | Recorded amount | Interpretation |
|---|---:|
| Fee not configured | 4 | ₹15.00 gross | Allocation is unknown; do not treat null commission or shop earnings as zero. |
| Ready to pay | 3 | ₹14.00 gross; ₹0.03 XerService fee; ₹13.97 shop earnings | Eligible according to the current ledger, in this test environment. |
| Reversed | 9 | ₹59.00 gross | Excluded from eligible shop earnings; not a new negative sale every time the screen loads. |

The current rule is **0.2%**, effective 5–30 September 2026. This audit does not change or endorse that commercial rate. The 39 orders versus 16 ledger entries is not by itself an accounting bug: unpaid drafts/cancellations need not produce earned revenue.

The earlier screenshots show ₹27 and ₹57; the later database snapshot differs. This reinforces why the dashboard needs a shared filter definition and an update timestamp.

### 2.4 Truthful data states

Every data panel must distinguish:

- **Production records:** Verified production source and transaction mode.
- **Test records:** Database transactions made in test mode, explicitly marked.
- **Demo preview:** Deliberate fixture view, clearly labelled and isolated from production actions.
- **Empty:** Successful query returned no matching records.
- **Unavailable:** Query or integration failed; show a retry action, never a fabricated zero.
- **Stale:** Previously loaded data is visible with its last update time during reconnection.
- **Setup needed:** Required price, commission, account, or integration configuration is missing.

Demo mode must be explicit, unavailable to ordinary production users, and excluded from financial reporting. Do not purge historical records merely because they look like sample data; classify them using evidence and preserve references.

## 3. Navigation and page ownership

### 3.1 Admin navigation

Use one persistent sidebar on desktop and a compact drawer on smaller screens. The top bar contains the page title, relevant actions, theme control, and account menu. Avoid a second navigation row reproducing the sidebar.

| Destination | Proposed canonical route | Purpose |
|---|---|---|
| Dashboard | `/admin/dashboard` | Action cards, operational alerts, and financial snapshots |
| People | `/admin/people` | Account creation, editing, roles, access, and shop assignment |
| Customers | `/admin/customers` | Read-only summaries of enabled customer accounts |
| Vendors | `/admin/vendors` | Vendor/shop cards and shop management entry |
| Support | `/admin/support` | Customer/vendor issues and messages |
| Earnings | `/admin/earnings` | XerService earnings and platform-wide comparisons |
| Settlements | `/admin/settlements` | Shop balances, payment preparation, and payment history |

Seven destinations cover the requested responsibilities. Do not add global Shops, Shop Finance, Commission Rules, or Add-ons destinations alongside them. Those belong inside a vendor's shop workspace. Put integration settings under an account/settings entry, outside daily navigation.

**Legacy compatibility:** `/xad/dashboard` → Dashboard; `/admin/users` → People; finance `view=summary` → Earnings; `view=shops` → Vendors; `view=payouts` → Settlements. `/admin/addons` becomes an explicit shop-selection entry into services. Preserve links and auth redirects while migrating; test back/forward and refresh.

### 3.2 Vendor desktop navigation

1. **Dashboard** — today's work, attention items, and shop earnings.
2. **Orders** — all order stages, document preview, printing, and recovery.
3. **Reports** — shop statements, payment history, and exports.
4. **Shop settings** — profile, images, hours, availability, and printer settings.

Printer status remains visible in the header. Device jobs and failures appear inside Orders and printer settings. Removing the Print Queue menu must not remove its underlying services or hide stuck jobs.

### 3.3 Customer navigation

Desktop: shop discovery plus Orders, Files/cart access, and Account when signed in. Mobile: **Home, Orders, Files, Account**, with the next ordering action anchored within each flow. The current cart/order model remains authoritative; Files is a presentation entry, not a second basket implementation.

## 4. Visual system and interaction rules

### 4.1 Brand tokens

Reuse the verified website palette:

| Token | Current value | Intended use |
|---|---|---|
| Cyan | `#54bdce` | Primary actions, selected navigation, progress, key values |
| Cyan hover | `#42b8ce` | Primary action hover |
| Cyan button text | `#092b31` | Readable text on cyan buttons |
| Magenta | `#cf438d` | Secondary chart series and short brand accents |
| Light background | `#ffffff` | Main light canvas |
| Light surface | `#f7f7fa` | Cards/secondary panels |
| Dark background | `#07070f` | Main dark canvas |
| Dark surface | `#0f0f1a` | Raised dark panels |

Use semantic success/warning/error colors only for status, with icons and text. Avoid adding indigo/purple as a competing brand. Share CSS variables and small visual primitives across the web and DOM desktop; do not import the entire website stylesheet or React runtime into the desktop to match its appearance.

### 4.2 Layout specification

- Admin desktop: approximately 232px sidebar; main content fluid with a comfortable maximum width around 1440px; compact 56–64px top bar.
- Card grid: three columns on wide screens, two at medium widths, one on narrow widths; minimum useful card width around 260px.
- Use 8/12/16/24/32px spacing steps, 12–20px card radii, restrained borders/shadows, and consistent icon sizes.
- Titles should be short: Dashboard, People, Vendors, Earnings, Settlements. Remove long generic descriptions such as the current Payments and shop earnings paragraph.
- Keep explanations where decisions need them: commission basis, pricing units, refund state, or why an action is unavailable.
- Use cards for entry points and summaries; use tables for dense transactions and comparisons. Avoid turning every transaction into an oversized card.
- Default desktop density should put real work above the fold. Empty states should not occupy the entire screen with a large illustration.
- Shop imagery uses fixed aspect ratios, deliberate cropping, a loading placeholder, and descriptive alt text. Missing photography gets branded initials, not a fabricated storefront.

### 4.3 Action feedback contract

Every write follows **edit → validate → save → server confirmation → refreshed saved value**.

| State | Required behavior |
|---|---|
| Editing | Inline labels, clear units, dirty-state indicator, accessible field errors |
| Saving | Disable only the affected action; show Saving…; block duplicate submissions |
| Saved | Show a concise success message and the returned saved value; announce without stealing focus |
| Rejected | Keep input, place the actionable error near the affected field, offer retry |
| Conflict | Explain that another admin changed the record; reload current values before overwriting |
| Offline/unknown outcome | Keep unsaved input; check server state before retrying a financial operation |
| Destructive or financial action | Review the concrete account/shop/amount and consequences before execution |

Use field errors plus a persistent banner for significant failures; a disappearing toast alone is insufficient. Announce saves and progress with accessible status messages. Follow [W3C status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

### 4.4 Theme, accessibility, and motion

- Light / Dark / System settings persist across browser refresh and desktop restart; initialize before painting to avoid a theme flash.
- Use normal links for navigation and real buttons for actions. Avoid clickable `div` cards with no keyboard equivalent and nested interactive controls.
- Visible focus rings, labelled inputs/icon buttons, modal focus containment/restoration, Escape dismissal, keyboard-reachable menus, and chart table alternatives.
- If local tabs remain, implement linked tabs/panels, selected state, and keyboard movement according to the [W3C tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).
- Aim for 44px touch targets and readable contrast in both themes. Cyan text on white and subdued dark-theme labels need explicit contrast checks.
- Use short 150–220ms transitions, useful loading skeletons, and restrained cyan/magenta progress animation. Respect reduced motion.
- Upload percentages must represent bytes transferred. Use named phases for processing and quoting when an honest percentage is unavailable.

## 5. Admin screens and behavior

### 5.1 Dashboard

The dashboard is an operational starting page, not another tabbed implementation of every module.

**Above the fold:**

1. Compact header with date range, environment badge, and last update time.
2. Six or seven entry cards: People, Customers, Vendors, Support, XerService earnings, Settlements; optional Orders shortcut only if repeated operational use justifies it.
3. An attention list with concrete links: unpriced services, fee setup missing, vendor invitation pending, unresolved support, settlement discrepancy, offline shop.

**Below the fold:**

- Earnings trend with period comparison and a table alternative.
- Shop comparison: orders, collected service revenue, XerService earnings, shop earnings, refunds, and amount ready to pay.
- Recent admin activity: who changed a rate, suspended an account, published a shop, or recorded payment.

Each entry card has a meaningful count/value and one destination. People can show all accounts; Customers counts only enabled customers; Vendors shows shop/owner totals separately if they differ. Do not call an account active because it placed an order today.

Clicking a number opens the corresponding filtered records. Card figures and destination lists must use the same predicates and period. No fake growth percentages when the previous period is zero; show “No previous-period activity.”

### 5.2 People: the account control centre

- Filters: **All, Active, Inactive, Pending**, plus role and assigned shop; searchable name/email/phone; paginated server results.
- Define mutually exclusive access categories. Suggested rule: suspended/disabled → Inactive; otherwise invitation/activation incomplete → Pending; otherwise → Active. Last seen is a separate field.
- Keep requested columns: **Name, Email, Phone, Role, Assigned shop, Account status, Created, Actions**. Created is read-only.
- Edit panel contains profile fields, role/access, and shop assignment with short section labels.
- Email and phone changes must follow trusted Auth verification rules; editing a text field cannot establish a verified identity.
- Vendor creation can create a draft shop or assign an available shop. Avoid overwriting another owner's assignment.
- Prefer an invitation or expiring password-setup link. If a temporary password is necessary, show it once and require a change; never show stored permanent passwords.
- Do not send credentials until the operator deliberately initiates the delivery action through the chosen channel.
- Prevent removal of the last usable admin and accidental self-lockout; show the concrete affected account before access/role changes.
- Suspension must be enforced on protected backend operations and existing sessions, not just hidden in the UI.
- Audit relevant changes with actor, target, previous/new values, time, and reason where appropriate. Mask sensitive fields in routine logs.

**Acceptance:** create/invite, edit, disable/re-enable, and assign shop all persist after reload and in a second admin session. A failed save retains input. Pending/active counts reconcile with lists.

### 5.3 Customers: summaries without duplicate editing

Show enabled customer accounts as vertical summary cards, with a compact list option for large datasets.

Card content: name/avatar, joined date, completed orders, paid-order count, net amount spent, latest order, and open support count when available. Keep sensitive contact details behind the detail page or appropriate admin access.

Customer details include order history, payment/refund history, documents' metadata where required for support, and activity. Use **Edit account in People** for account changes. Do not place competing edit controls here.

Define metrics: completed orders are successful collections/completions; placed orders exclude abandoned drafts; net spend deducts confirmed refunds; wallet top-ups are not print orders. Prefer these explicit labels to a single ambiguous Orders number.

### 5.4 Vendors: cards and a dedicated shop workspace

The Vendors landing page uses vertical photo cards showing shop name, owner, availability, readiness, period order count, shop earnings, and amount ready to pay. Keep account state separate from shop availability.

Examples supplied by the user—Student Xerox, Friends Xerox, Atti Xerox, Lakshmi Xerox—describe intended usage. Do not seed them as real shops.

Proposed route: `/admin/vendors/[vendorId]/shops/[shopId]`. Keep owner and shop identifiers distinct. Existing handlers mostly assume one owner/one shop; enforce that supported rule initially and avoid silent reassignment. Multi-shop ownership requires a deliberate contract change, not a UI-only dropdown.

The shop workspace has one breadcrumb and a short local menu:

| Local section | Contents |
|---|---|
| Dashboard | This shop's orders, earnings, refunds, readiness, and recent activity |
| Shop profile | Published name, images, location, hours, contact, and visibility |
| Printing & prices | Supported settings, complete rate matrix, and quote tester |
| Add-ons | Photo catalogue assignments, price, availability, eligibility, quantity rules |
| Commission | The commercial policy for printing and add-ons |
| Orders & money | This shop's orders, financial details, refunds, and settlement history |

Use a vertical local menu on wide screens and an accessible section selector on narrow screens. Do not reproduce all global destinations inside it. Keep the selected shop visible throughout edits.

### 5.5 New shop example: Lakshmi Xerox

1. People → Create person → Vendor; create/invite the owner.
2. Create or assign a draft Lakshmi Xerox shop; persist both records safely and report partial failures accurately.
3. Vendors → Lakshmi Xerox → add profile details and photographs.
4. Enable only A4 single-sided B&W and colour if those are the actual services.
5. Enter prices for both; duplex/A3 remain unavailable.
6. Add supported finishing services with shop-specific photos/prices/limits.
7. Configure printing commission and add-on commission; test worked examples.
8. Validate collection/payment configuration and shop opening hours.
9. Preview the customer card; publish only after required checks pass.
10. Vendor signs in and sees the same shop profile and an honest empty dashboard.

Keep draft/published/archived visibility separate from Open/Paused/Closed trading status. A published closed shop may remain discoverable with truthful hours, while new checkout is disabled.

## 6. Printing settings and pricing

### 6.1 Capability and pricing model

Admin enables actual service capabilities first, then provides prices for each enabled billable combination.

- Paper: reuse supported A4, A3, and Legal types; introduce further sizes only after end-to-end support.
- Colour: black & white, colour.
- Sides: single, double long edge, double short edge.
- Layout: 1, 2, 4, 6, 9, or 16 PDF pages **per printed side**, where supported by the shared layout engine.
- Orientation, page range, scale, margins, and copies: validate using the existing shared settings contract.
- Colour/size/duplex capabilities shown to a customer must be fulfilable by the shop; a connected printer is checked again at dispatch.

The UI should say “Pages per side” because the current `pages_per_sheet` value is applied separately to front/back. Keep the persisted field until a compatible migration is justified.

### 6.2 Rate editor

- Matrix rows for paper/colour/sides, with enabled switch and **Price per physical sheet**.
- Expand a row for advanced overrides only when needed; avoid a hundreds-row spreadsheet by default.
- If the business wants different rates for 2-up/4-up layouts, add explicit optional layout overrides. Show when the base sheet rate is inherited.
- No assumption that short-edge and long-edge duplex share a rate; offer a deliberate “Use the same price” action.
- Orientation/scale should remain price-neutral unless an explicit business policy adds a surcharge.
- Copy/paste rate patterns and bulk edit are useful, but show affected rows and validate before publishing.
- Disabled combinations disappear or show unavailable with a reason in customer settings. Never offer them and fail only after payment preparation.
- Quote results use the server engine. A missing rate is “Price needed,” not ₹0.
- Historical paid orders retain the pricing snapshot they were charged. Publishing new prices cannot silently reprice them.

### 6.3 Arithmetic and quote tester

Use the existing calculation as the baseline:

```text
selected pages = validated page selection
printed sides per copy = ceil(selected pages / pages per side)
sheets per copy = printed sides per copy                 [single-sided]
sheets per copy = ceil(printed sides per copy / 2)       [double-sided]
physical sheets = sheets per copy × copies
printing amount = physical sheets × matching sheet price
order amount = printing amount + valid add-on amounts
```

**Worked example using the currently configured A4 B&W long-edge duplex rate:**

- 8 selected PDF pages, 2 pages per side, double-sided, 1 copy.
- 4 printed sides, 2 physical sheets, ₹3 per sheet → **₹6 printing**.
- 5 selected pages with the same settings → 3 printed sides, 2 sheets → **₹6 printing**.
- Copies multiply whole document sets; do not merge blank space between different copies without an explicit collating contract.

Provide an admin tester with page count, copies, settings, and add-ons. Show the matched rule, printed sides, sheets, customer amount, and commission allocation. A preview is labelled an estimate until the real uploaded document is verified by the server.

**Acceptance:** the user-reported N-up/duplex case receives a correct price or a clear unavailable state before checkout. Test odd/even/ranges, duplicate ranges, blank backs, multiple files/copies, and unsupported settings.

## 7. Shop add-ons with images

Reuse the existing global catalogue and per-shop assignments. The operator sees shop-specific editing by default; the global catalogue is a reusable source within that flow.

Each card/configuration has name, photo, description, price/unit, availability, page limits, compatible paper sizes, and extra preparation time when known. Define whether quantity is per document, copy, physical sheet, or item; do not multiply binding by page count accidentally.

- “Add service” selects an existing catalogue item or creates one; then sets this shop's price/availability.
- Global catalogue edits must show their cross-shop effect. A shop override must not change other shops.
- Reuse current image upload/storage support with validated type/size, safe names, resized outputs, and ownership checks.
- Customer add-on cards show the selected shop's price/photo and explain incompatible choices near the control.
- Snapshot price, name, quantity, policy version, and required fulfilment instructions onto the order.
- Vendor can mark a service temporarily unavailable; admin controls commercial prices and commission unless explicit permissions say otherwise.
- Stop production in-memory fallback on database errors. An unavailable storage/database service must produce an error, not seeded catalogue data labelled saved.

## 8. Commission policies and accounting

### 8.1 Policy editor

Use a clear dropdown or radio selection with a checkmark for **one calculation method per scope**. Checkboxes select eligible service categories. Do not stack several fee models accidentally.

| Method | Required input | Calculation |
|---|---|---|
| Percentage of service revenue | Percentage and included service categories | Eligible service revenue × percentage |
| Percentage of configured profit | Percentage and versioned cost basis | max(eligible service revenue − configured direct cost, 0) × percentage |
| Fixed amount per unit | Rupees and explicit unit | Eligible quantity × fixed fee |

Fixed-unit choices for printing: selected document page, printed side, or physical sheet. Add-ons support per item/service unit. A fixed per-order model may be added if required, but should not be mixed invisibly with a per-unit charge.

Commission scopes: shop default → printing override or add-on override → specific service override. Exactly one effective rule wins for each line and timestamp. Show inheritance and prevent overlapping rules of equal specificity.

All models need start/end time, version, who changed them, and a before/after calculator. Keep basis points as internal storage for percentages; do not show that term in normal forms.

### 8.2 Revenue and profit are different

“10% per paper” means 10% of that paper's selling amount when revenue percentage is selected. It is not ₹0.10 per page unless a fixed fee is selected.

**Illustrative commercial examples, not configured live prices:**

| Scenario | Customer service amount | XerService fee | Shop earnings |
|---|---:|---:|---:|
| Two single-sided ₹2 sheets, 10% of revenue | ₹4.00 | ₹0.40 | ₹3.60 |
| Same sale, configured total direct cost ₹2.40, 10% of configured profit | ₹4.00 | ₹0.16 | ₹3.84 |
| Same sale, ₹0.25 per physical sheet | ₹4.00 | ₹0.50 | ₹3.50 |
| Printing ₹4 at 10%, binding ₹20 at 5% | ₹24.00 | ₹1.40 | ₹22.60 |

Profit-based commission cannot be enabled until direct costs have been entered and snapshotted. Label it **Configured profit** or **Estimated margin** unless the product actually captures all relevant expenses. A shop's payout is not its accounting profit.

Define the revenue base before rollout: service selling amount after allocated discounts, with taxes/pass-through amounts handled explicitly. Preserve existing simple order allocation during migration. Decide who bears gateway charges and refunds; do not silently deduct new costs from shop earnings. Wallet top-ups are not service revenue; wallet-funded order payments must not count twice.

### 8.3 Ledger extension and integrity

- Extend the existing ledger using line-level allocation snapshots and versioned commission policies. Preserve old percentage rules and historical totals.
- Store monetary values as integer paise or exact database numerics; avoid accumulating binary floating-point rounding errors.
- Define rounding once per line, then sum lines. Deterministically allocate rounding remainders so totals reconcile exactly.
- Record service revenue, cost basis when applicable, selected rule/version, quantity/unit, XerService fee, shop earnings, discounts, and refund allocation.
- Reject configurations where a fixed fee exceeds eligible line revenue unless an explicit subsidized business model is approved and implemented.
- Preserve the split invariant for eligible service amounts. Track taxes/pass-through/adjustment lines separately if introduced.
- Missing policy remains unallocated/setup needed. Do not assume a default rate or assign everything to the shop.
- Future policy changes do not alter existing paid-order snapshots. Retroactive repair requires an explicit preview, scoped selection, audit entry, and checks against settlement locks.
- Preserve verified payment/refund event idempotency and row locking. Repeated webhooks must not create repeated earnings/reversals.

### 8.4 Vendor visibility

Vendor Dashboard and Reports show **Shop earnings, Ready to receive, In progress, Received, Refund adjustments**, and order counts. Admin sees the full split.

Whitelist vendor API fields. Remove commission rates, methods, platform fee totals, and private cost assumptions from responses, exports, browser state, and diagnostic logs. Verify cross-shop authorization as well.

Hiding a commission line cannot mathematically conceal a fee if the vendor can see both customer gross and shop net. Prefer shop-net financial summaries; review where customer receipt totals remain operationally necessary. Promise field privacy, not impossible prevention of inference.

## 9. Earnings, refunds, and settlements

### 9.1 Earnings page

- Date presets: Today, Yesterday, This week, This month, This year, Custom; use Asia/Kolkata reporting boundaries and UTC storage.
- Compare with previous equivalent period; keep filters consistent across cards/charts/tables/exports.
- Primary cards: XerService earnings, Service revenue, Shop earnings, Confirmed refunds, Orders included.
- Separate money earned from money transferred. A chart of customer collections is not a chart of XerService earnings.
- Charts: daily earnings trend; printing versus add-ons; shop comparison. Reuse Chart.js and load it only on report views.
- Table: shop, paid/completed order counts, service revenue, XerService earnings, shop earnings, confirmed refunds, cancellations, unallocated amount.
- Give every metric a documented source, state inclusion, timestamp basis, and refund treatment. Expose short help only when requested.

### 9.2 Refunds and cancellations

Show both global and shop-specific breakdowns:

- Unpaid cancellations: operational count, no money refunded.
- Paid cancellations awaiting refund: amount pending, earnings held according to policy.
- Confirmed refunds: actual successful refunded amount, date, provider reference, and allocated reversal.
- Failed/pending refunds: attention state, not treated as completed reimbursement.
- Refund after shop payment: explicit adjustment/recovery balance; never edit the historical paid settlement out of existence.
- Partial refunds need line allocation and rounding support; until supported end-to-end, disable partial amounts rather than fake the accounting.

The current combined reversal metric is a baseline, not proof that every cancelled order returned money. Separate these states in the new reporting contract.

### 9.3 Settlements page

Automatically fetch each shop's eligible unpaid earnings and show:

1. **Ready to settle:** shop, ready amount, held amount, order count, last paid date.
2. **In progress:** draft/confirmed batches with status and operator.
3. **Paid history:** date, amount, masked destination, reference, and statement download.

Workflow: **select shop → review eligible items → create batch → confirm → perform/verify transfer → record paid**.

- Continue using the existing manual external payment workflow initially. “Automatically fetch balance” does not authorize automatic bank transfers.
- Compute available balance atomically, excluding items already locked in another active batch.
- Include orders only when eligible, allocated, not reversed, and not already paid. Explain excluded items.
- Keep live and test transactions separate. Never pay real money for test-mode orders.
- Verify or review beneficiary details before transfer; destination changes are audited and require appropriate confirmation.
- Failed/interrupted transfer remains unresolved until reconciled. Clicking a button alone is not proof of payment.
- Record amount, method, reference, actor, confirmation time, and evidence as appropriate. Duplicate submit must be harmless.
- Cancelling a draft/eligible batch releases its locks safely; paid history uses compensating adjustments rather than deletion.

**Acceptance:** two admins cannot settle the same ledger item twice; a refund racing with confirmation is handled transactionally; vendor statement and admin batch agree after reload.

## 10. Support

Combine support issues, contact messages, and operational requests in one Support destination, using filters instead of six unrelated dashboard tabs.

- Ticket list: Open, Waiting, Resolved; source, customer/vendor, shop, linked order, priority, last reply, owner.
- Ticket detail: conversation timeline, relevant order context, safe attachments, internal notes, assignment, and status.
- Route existing contact/order issue entry points into real persisted tickets; first confirm deployed schema and current submission behavior.
- Admin-only notes must not appear in customer/vendor responses.
- Customer/vendor can access only their own permitted tickets; attachment URLs expire and are authorized.
- Success means the message/ticket was stored. If external notification fails, preserve the ticket and show delivery status separately.
- Optional enhancement: unresolved duration and escalation filters. Do not display invented service targets or guarantees.

## 11. Vendor desktop redesign

### 11.1 Dashboard

Use the website logo, typography, token palette, buttons, themes, and card proportions. Preserve native window behavior and keep work inside the desktop app.

Header: shop name, Open/Paused/Closed, backend connection state, actual printer status, theme/account menu.

Primary cards: New orders, Printing, Ready for pickup, Today's completed orders. Secondary earnings strip: Shop earnings today, Ready to receive, Last payment received. Distinguish order data freshness from local printer connectivity.

Main panel: recent/urgent orders with time waiting, document count, print settings, and one next action. Side panel: printer attention, paused service warnings, and shop availability controls. Show an honest “No orders yet” when empty.

Use a compact earnings trend only when useful and backed by history. Do not manufacture estimated wait times or printer-ready status from the mere presence of a device.

### 11.2 Orders: preserve the strong workflow

- Keep the existing ordering, status transitions, duplicate prevention, file authorization, native job persistence, and recovery.
- Integrate New, Printing, Ready, Completed, and Cancelled filters with search and date range.
- Put local job progress and failures beside their order. Retain a device-jobs panel for orphaned native jobs and diagnostics.
- Support multi-file orders in the details/preview; do not show only the first document as if it were the entire order.
- Standardize status mapping and language with the backend. Disable actions with a useful reason when payment, capability, or job state blocks them.
- Reprint requires a deliberate action, reason, and audit trail. It must not bypass duplicate protection accidentally.
- Backend disconnect shows stale cached information and a reconnect state. Do not create new print jobs from unverified offline payment state.

### 11.3 Real PDF preview

Design a resizable order workspace: document list/thumbnails on the left, large PDF canvas in the centre, printer/settings summary and next action on the right. Collapse secondary panels on narrow windows.

Required preview controls:

- Select any file in the order; page/sheet navigation, zoom, fit page/width, thumbnails, and original versus print-layout view.
- Show selected page range, copies, paper, orientation, colour, margins/scale, N-up arrangement, duplex front/back, and expected sheet count.
- Keep paid settings read-only unless a supported, audited amendment process exists. Selecting a printer must not silently alter purchased settings.
- Load/error/retry states for expired authorization, missing files, corruption, encrypted documents, and unsupported rendering features.

Use the existing **PDF.js** dependency family for actual page rendering. Mozilla's examples demonstrate document/page loading, viewports, and canvas rendering; this is the basis for the viewer, not proof of physical printer behavior. See [PDF.js examples](https://mozilla.github.io/pdf.js/examples/).

**Print parity contract:**

1. Authorized original PDF and immutable order settings are inputs.
2. Reuse/extract the pure layout preparation used by `prepare-print-pdf` and shared geometry where compatible with Tauri.
3. Preview the same prepared artifact that is dispatched, or demonstrate identical transformations with tested contracts.
4. Apply page selection and N-up exactly once. If baked into the artifact, disable equivalent native transformations.
5. Copies, duplex edge, paper, and colour remain explicit native job parameters where appropriate; verify the driver's actual capability.
6. Match displayed sheet counts to server quote and dispatch settings. Flag a mismatch before printing.

PDF.js is a renderer; native printing remains in Tauri/Rust/CUPS. CUPS supports page ranges, copies, sides, and other print options, so duplicate application of those options is a real integration risk. Validate against [OpenPrinting CUPS options](https://openprinting.github.io/cups/doc/options.html).

Virtualize thumbnails, render only visible/nearby pages, cancel stale renders, release canvases/blob URLs on close, and load the worker on demand. Package worker/assets locally and scope file access narrowly. Tauri's capability model controls which windows can invoke native operations; follow [Tauri capabilities](https://v2.tauri.app/security/capabilities/).

**Physical acceptance:** test actual single/duplex jobs, long/short edge, N-up, mixed orientations, multiple copies/files, reconnect, cancellation, and restart recovery on supported printers. Spooler acceptance or completion is not proof that the customer collected the paper. Record visual/hardware limits rather than claiming universal driver parity.

### 11.4 Reports as a shop passbook

Opening panel: shop identity, statement period, masked payment account, opening balance, earned in period, adjustments, received payments, and closing balance. Account balances use shop earnings, not the loaded order list's customer totals.

Transaction rows: date, reference/order, description, earnings credit, refund/adjustment debit, payment received debit, and running balance. Include links to the order or settlement receipt.

Define the passbook balance as **money XerService owes this shop**: opening balance + earned credits − reversals/adjustments − payments = closing balance. Show not-yet-eligible earnings separately from ready-to-receive balance.

Offer date filters, search, CSV, and printable PDF using existing tooling where practical. Full-period totals must come from the server even when the table is paginated. Downloaded reports match on-screen filters and exclude private commission fields.

### 11.5 Shop settings

- Vendor may edit shop display name, description, photographs, hours, public contact, and temporary availability, subject to explicit server permissions.
- Preview the customer card before publishing image/name changes.
- Vendor edits persist to the same shop record/media used by customer discovery; invalidate/refetch affected views.
- Reuse admin-defined commercial settings as read-only. Permit temporary add-on unavailability where supported.
- Printer selection, default device, capability diagnostics, and connection troubleshooting live here.
- Theme selection persists on restart. Show the same Light/Dark/System vocabulary as the website.

## 12. Customer experience redesign

### 12.1 Home and shop discovery

- Replace the two large introductory boxes with a concise hero: one useful heading, short supporting copy, and the primary print/discovery action.
- Make the shop collection the visual centre. Use vertical cards with photo above content, shop name, availability, location, supported service chips, clear starting prices, and **Print here**.
- Desktop: three-column grid where space permits; tablet: two; mobile: one comfortable column. Avoid horizontal carousels for the only shop list.
- With one shop, present one well-sized card and relevant service/help content; do not stretch it into a nearly empty full-width row or clone it.
- “From ₹2” must identify the applicable basis (for example A4 B&W, single-sided). Never advertise a price absent from the enabled matrix.
- Search/filter by name/location and actual service support. Add distance only if permission and reliable coordinates are available.
- Show real shop images; no fabricated ratings, reviews, popularity labels, or “verified” claims without an actual verification process.
- Closed shops clearly explain availability; draft/unpublished shops are not public.
- WhatsApp appears as a compact secondary import/connect option only when operational. Until then, state unavailable without fake linking actions.

### 12.2 Upload → configure → review → pay → collect

Keep existing backend stages and saved drafts while improving the presentation:

1. **Upload:** drag/drop on desktop, native picker on mobile, multiple-file list, thumbnails, page counts, per-file progress, cancel/retry, unsupported-file explanation.
2. **Configure:** large live preview, common settings first, advanced settings behind a clear disclosure, controls restricted to the selected shop's capabilities.
3. **Add-ons:** photograph cards with price/unit and eligibility feedback; selection is reflected immediately in the pending quote.
4. **Review:** per-file settings, sheets, print/add-on totals, selected shop, pickup details; meaningful edit links that preserve state.
5. **Pay:** clear amount and method, one active payment attempt, authoritative confirmation, recoverable pending state.
6. **Collect:** order number, status timeline, shop directions/hours, receipt, and contextual support.

Mobile uses a sticky primary action/total summary with safe-area spacing and keyboard-aware layout. Preserve document/settings state when moving back, logging in, or refreshing. Do not remove working payment-recovery behavior during visual changes.

### 12.3 Account, orders, files, and feedback

- Account groups profile, verified phone, linked WhatsApp, appearance, and support into simple sections.
- Orders uses clear status chips, chronological cards, receipt access, and an order detail timeline.
- Files shows current draft/imported documents with ownership, origin, and expiry where applicable; do not persist sensitive document bytes in unrestricted localStorage.
- Repeat order may be offered only while source files remain available and after re-quoting current prices/capabilities.
- Use an explicit upload phase model: Uploading → Checking document → Preparing preview → Ready. Recovery should retain successful files if one file fails.
- Remove Tamilnadu from customer browser title and other corresponding metadata/title surfaces. Keep meaningful geographic information in shop addresses.

## 13. Secure WhatsApp linking and document importing

### 13.1 What linking means

Linking associates a verified WhatsApp sender identity with an existing XerService account for document import and opted-in order updates. It is not signing into the user's entire WhatsApp account, reading personal chats, or replacing Supabase login.

Keep existing Supabase + Vonage SMS OTP unchanged. Supabase currently documents the WhatsApp OTP channel for Twilio/Twilio Verify, so enabling Vonage phone auth does not itself enable WhatsApp delivery. See [Supabase phone sign-in](https://supabase.com/docs/guides/auth/phone-login?showSmsProvider=MessageBird).

### 13.2 Recommended first linking flow

Use a user-initiated message to XerService's verified business number, followed by confirmation in the signed-in website:

1. Signed-in user opens Account → WhatsApp → **Connect WhatsApp**.
2. Show what will be linked and imported, with a separate choice for order notifications. Marketing permission must not be bundled into document import.
3. Server creates a cryptographically random, single-use challenge bound to the user and intended verified phone, expiring after five minutes. Store a hash rather than the raw secret.
4. Mobile opens WhatsApp with a prepared linking message; desktop shows a QR/link for that same action. The URL contains only a short-lived challenge, never a session/JWT or document URL.
5. User sends the message. A signed provider webhook identifies the sender and challenge. Opening the link without sending a message does not link anything.
6. Server validates signature, expiry, user/challenge binding, sender identity, single-use status, and uniqueness; store **Awaiting confirmation**.
7. The original authenticated website shows the received masked number and asks the user to confirm the connection.
8. Confirmation atomically consumes the challenge and creates the link. UI reads the durable server result and shows **Connected**, masked number, linked date, and Disconnect.

Default to the account's already verified phone. A different number requires an explicit separate verification flow; never silently replace `auth.users.phone`, transfer someone else's WhatsApp link, or create a new customer identity. Use generic conflict errors and a recovery route when the number is already linked.

If the preferred user experience later requires typing a WhatsApp OTP, use a server-generated challenge delivered through an approved authentication template with expiry and attempt limits. Meta documents [authentication templates with OTP buttons](https://www.postman.com/meta/whatsapp-business-platform/request/6vkv46u/create-authentication-template-w-otp-copy-code-button). Do not use the browser-generated/test-code component.

### 13.3 Provider and webhook preparation

- Recommended baseline: direct Meta WhatsApp Cloud API through a small server adapter. Consider a business solution provider only if managed onboarding/support justifies its extra cost.
- Confirm business account, app ownership, registered sending number, permissions, billing, and test recipients. Do not assume the old hardcoded number is usable.
- Configure a public HTTPS webhook, GET verification challenge, signed POST validation, messaging subscriptions, and server-side token storage/rotation.
- Verify POST signatures over the raw request body using the app secret and constant-time comparison. A GET verification token does not authenticate later events.
- Deduplicate message IDs and state transitions; tolerate duplicates and out-of-order delivery. Persist accepted events before acknowledging/processing asynchronously.
- Rate-limit linking by user, sender, and origin. Never log raw challenges, tokens, or complete document URLs.
- Represent provider downtime, failed delivery, expired links, wrong number, already connected, and disconnected states explicitly.

Meta's archived SDK documentation describes the GET challenge versus POST signature distinction. Use it as protocol background only, not a dependency recommendation; confirm the active Graph API contract at implementation. See [Meta webhook verification reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/).

### 13.4 Persistence and APIs

Proposed records, adapted to existing schemas after inspection:

| Record | Key purpose |
|---|---|
| WhatsApp links | User, provider sender identifier, verified number, status, linked/revoked times, consent/version |
| Link challenges | User, hashed challenge, intended sender, expiry, attempts, state, confirmation/consumption time |
| Provider inbox events | Unique provider event/message ID, type, processing status, retry count, minimal protected payload |
| Imported files | Owner, source message/media ID, storage path, MIME/size, validation state, expiry, draft association |

Proposed authenticated endpoints: create challenge, read connection status, confirm, disconnect, list imports, and attach selected imports to the existing draft. The provider webhook has its own signature authentication. Never accept user ID or linked status solely from a browser payload.

### 13.5 Document import journey

1. Linked user sends a PDF/image to the XerService business chat.
2. Verified webhook maps sender to the current active link. Unlinked senders receive only onboarding guidance when permitted; their file must not appear in someone else's account.
3. Server fetches media using provider authorization and stores it in private, owner-scoped storage after validation.
4. Apply current XerService limits: 20 MB and 500 PDF pages, plus supported MIME types and content validation. Provider acceptance does not override application limits.
5. Check format/magic bytes, parser errors, encrypted files, resource limits, and safe filenames. Reject suspicious/unsupported content and use a quarantined state until validation completes.
6. Customer sees a new file in Files/cart import view with a thumbnail and source label; duplicate events do not duplicate the document.
7. User selects the shop, settings, and add-ons and receives the normal server quote. Imported files do not authorize payment or printing by themselves.
8. Private media access expires and is authorized; disconnect blocks subsequent imports and cancels pending links without corrupting existing orders.

Provider media URLs require an authorized server download and are short-lived; retrieve a new URL when needed rather than exposing provider tokens to the browser. See [Meta media download reference](https://www.postman.com/meta/whatsapp-business-platform/request/zsq66eh/download-media).

Prevent arbitrary URL fetching: derive media from validated provider IDs/responses, constrain redirects/hosts, and do not accept a user-supplied download URL as trusted input.

### 13.6 Cost and release gates

WhatsApp pricing depends on message category, recipient market, and applicable volume tiers; provider subscriptions/markups may add cost. Consult the current [official WhatsApp pricing page](https://whatsappbusiness.com/products/platform-pricing/) before purchasing or enabling production messages. This plan does not quote an unverified rupee rate or assume future messaging remains free.

Estimate monthly cost as billable delivered messages by category × current rate, plus provider fees and storage/processing. Track success/failure and spend without collecting unnecessary message content.

Enable linking first, then file importing, then opted-in order updates. Keep each capability separately gated. Require actual test-number webhook/link/import verification and later controlled production delivery before claiming the integration works live. Browser mocks prove UI behavior only.

## 14. Backend and implementation boundaries

### 14.1 Existing code to reuse

Repository-relative paths below identify the focused implementation areas; read the current files again when starting each stage.

| Responsibility | Existing area |
|---|---|
| Admin shell | `src/components/layout/Navbar.tsx`, `src/components/admin/AdminHeaderNav.tsx`, corresponding `apps/admin` copies |
| Demo dashboard replacement | `src/app/xad/dashboard/page.tsx`, `apps/admin/src/app/xad/dashboard/page.tsx` |
| People | `src/app/admin/users/page.tsx`, `src/app/api/admin/users/**`, `src/app/api/admin/vendors/**` |
| Finance | `src/app/admin/finance/page.tsx`, `src/app/api/admin/finance/**`, `packages/backend/src/finance/vendor-ledger.ts` |
| Pricing | `packages/backend/src/pricing/pricing-engine.ts`, `order-pricing.ts`, relevant pricing RPC migrations |
| Add-ons | `packages/backend/src/addons/addons-service.ts`, `src/app/api/admin/addons/**`, shop add-on routes |
| Vendor privacy/reporting | `src/app/api/vendor/finance/**` and vendor frontend consumers |
| Desktop | `apps/desktop/index.html`, `src/main.ts`, `src/styles.css`, `src/ipc.ts`, `src-tauri/src/printing/**` within that app |
| PDF | `src/components/pdf/**`, `src/lib/prepare-print-pdf.ts`, `src/lib/pdf-document.ts`, `packages/shared/src/printing.ts` |
| Customer | `src/app/page.tsx`, `src/app/shops/**`, order pages, cart, dashboard/profile |
| Auth/linking | Existing Supabase auth wrappers, `src/components/profile/WhatsAppLinkModal.tsx`, profile/phone components |
| Branding | `src/app/globals.css`, mobile styles, app layouts, existing theme context and logo assets |

The repo contains root/admin copies and customer app links. Map shared versus copied files before editing to avoid divergence or editing the same linked file twice. Do not perform a repository-wide migration as part of the visual redesign.

### 14.2 Proposed backend work

- Admin dashboard/customer/vendor aggregate endpoints with consistent filters and no fake fallback.
- Shop-scoped profile, capability, pricing, and add-on APIs with explicit field permissions.
- Versioned commission policies and immutable line allocations, reusing the existing order-level ledger for rollups.
- Accurate paginated account queries and order aggregates; avoid client-side full-table scans.
- Support persistence only after confirming existing schema/entry points.
- Vendor-only finance response types and server statements.
- WhatsApp challenge/link/webhook/import persistence and bounded background processing.

All API changes need schema validation, authorization, pagination where appropriate, error contracts, and auditability. Server secrets remain server-only. Dashboard endpoints must not move pricing or financial authority into clients.

### 14.3 Migration strategy

1. Add compatible columns/tables/indexes and RLS policies before switching reads/writes.
2. Backfill with a dry-run count and deterministic mappings; preserve all historical money snapshots.
3. Classify test/live provenance from provider records or authoritative metadata. Unknown history stays unknown; current environment mode alone cannot classify old transactions.
4. Deploy the new API contracts, then screens behind per-area flags.
5. Verify two-shop isolation and old-client behavior before retiring legacy paths.
6. Roll back UI/routes through flags if needed. Do not roll back by deleting financial history or reversing successful payments.

## 15. Lightweight performance plan

- Measure current route bundles, request counts, rendering, and memory before setting final budgets.
- Reuse existing icons, Chart.js, Supabase, PDF.js/pdf-lib, Tauri, and shared types. Add a dependency only for a demonstrated gap.
- Load charts and PDF workers when their views need them. Customer home should not download admin charts or the PDF engine.
- Use one bounded aggregate request for a dashboard region rather than one request for every card. Paginate lists and index shop/date/status filters.
- Cancel obsolete search/quote requests; debounce search around 250–300ms; avoid repeated fetches on every state change.
- Use scoped realtime subscriptions with reconnect handling; fall back to bounded polling only for visible views. Do not refetch every dashboard table for every event.
- Persist only appropriate UI preferences locally; server remains the source for accounts, settings, money, links, and saved operations.
- Optimize uploaded shop/add-on images and reserve their layout size. Avoid giant uncompressed card assets and blocking font downloads.
- Virtualize large transaction lists when measurement justifies it. For PDF previews, use bounded page/canvas caches and clean up workers/tasks on close.
- Proposed acceptance targets: ordinary interactions visibly respond within 100ms; no unexpected layout jump; no permanent spinner; no bundle growth above 10% on an unchanged entry route without an explained benefit.
- Measure page load on a representative midrange phone and slow connection, not only the development Mac. Record actual baseline/result rather than claiming a score without measurement.

## 16. Delivery stages and exit criteria

Implement a complete vertical slice at a time. Each stage includes its backend persistence, UI states, permissions, and affected verification. The prior Stage 1 cleanup is a foundation; the redesign below replaces its temporary finance navigation deliberately.

| Stage | Work | Depends on | Exit criteria |
|---|---|---|---|
| A0 — Truth and baseline | Inventory demo/live/test sources; reproduce pricing/settings cases; map routes and copied files; capture desktop/mobile baselines | None | Each visible number/action has a documented source; test-mode badge defined; no unsupported live claims |
| A1 — Shell and design foundation | Shared tokens, theme behavior, admin sidebar, compact headers, canonical routes/legacy mappings, customer title cleanup | A0 | Correct active navigation after click/reload/back; keyboard/mobile/theme checks; no duplicated global navigation |
| A2 — People and customers | Real People filters/edit/create/invite/assignment; read-only customer cards/detail pages; paginated aggregates | A1 | Writes survive reload and another session; access changes enforced; counts reconcile |
| A3 — Vendors and shop profile | Vendor/shop cards, draft/published profile, photos, hours, dedicated workspace | A2 | Create a second test shop without overwriting the first; customer visibility follows publish state |
| A4 — Printing and add-ons | Shop capabilities, rate matrix, tester, per-shop image add-ons, fail-closed persistence | A3 | Every enabled combination quotes; unavailable combinations cannot reach payment; N-up/duplex reproduction fixed |
| A5 — Commission engine | Existing revenue model compatibility, additional models, explicit units, costs, rule versions, line snapshots, vendor field privacy | A4 | Worked examples and rounding/refund invariants pass; no private commission fields in vendor responses |
| A6 — Earnings and settlements | Database-backed dashboard, period comparisons, shop totals, refund states, settlement review/history | A5 | Totals reconcile; concurrent settlement protection; no test-to-live payout mixing; exports agree |
| A7 — Support | Persisted issues/messages, account/shop/order context, notes/permissions, action feedback | A2/A3 | Real submissions persist and are visible only to authorized parties |
| A8 — Vendor desktop shell | Theme parity, Dashboard, integrated Orders/device jobs, shop settings | A3/A6 | Existing order/printing controls preserved; no primary Print Queue entry; restart keeps theme/profile |
| A9 — Desktop PDF preview | Real PDF engine, every order file, print artifact/settings parity, bounded rendering | A4/A8 | Preview/quote/native settings agree; real-printer test evidence exists for supported combinations |
| A10 — Vendor statements | Passbook, server date aggregates, received payments, balances, CSV/PDF | A6/A8 | Opening + credits − debits = closing; reload/period/export consistency; no commission disclosure fields |
| A11 — Customer redesign | Vertical shop cards, modern home, mobile navigation, upload/configure/add-on/review/tracking polish | A3/A4 | Complete customer journey on desktop/mobile with accurate quotes, recovery, and brand parity |
| A12 — WhatsApp linking | Provider setup, server challenges, signature checks, account confirmation/disconnect | A2/A11 + provider prerequisites | Genuine test-number link survives another device; wrong/replayed/expired link rejected |
| A13 — WhatsApp imports/updates | Private media ingestion, validation, deduplication, existing draft integration, optional notifications | A12 | Real test document appears once in the correct account; unlink/retry/failure paths work |
| A14 — Release verification | Cross-role regression, live/test separation, deployment migrations, production integration/hardware evidence | All relevant stages | Documented evidence meets the release checklist; remaining limitations visible |

**Recommended next coding task:** A0/A1, then A2. Do not start with a large dashboard full of new charts while its source records are still fixtures. Stage A0 mostly formalizes and reproduces findings already recorded here.

Stages are scoped by deliverables rather than optimistic time promises. Break A4, A5, A6, A9, and A13 into small reviewed changes; they touch pricing, money, or external systems.

## 17. Verification and definition of done

### 17.1 Existing suites to reuse

- Admin account/auth: `test-phase6k-admin-auth.mjs`, `test-admin-user-vendor-mgmt.mjs`, `test-phase6n-user-vendor-mgmt.mjs`.
- Admin UI: `test-admin-ui-stage1.mjs`; update it for intended new routes and add actual persistence coverage.
- Pricing/add-ons/ledger: `test-pricing-engine.mjs`, `test-admin-controlled-addons.mjs`, `test-phase6j-vendor-ledger.mjs`, `test-phase6k-admin-finance.mjs`.
- Phone regression: `test-phase6h1-phone-auth-foundation.mjs`, existing OTP/browser suites; SMS behavior must remain intact.
- Desktop: existing auth, order rendering, document download, submission, status, queue, persistence, and recovery suites.

Read each script before execution. Some historical suites assert old UI strings or use fixtures; update obsolete expectations intentionally and do not confuse static checks with runtime verification. Tests that print, send, pay, or mutate a live environment require explicit controlled test setup.

### 17.2 Required scenario matrix

| Area | Scenarios |
|---|---|
| Navigation | Direct URLs, reload, back/forward, legacy links, active state, unauthorized roles, mobile drawer |
| Account management | Successful save, rejected save, duplicate submit, identity verification, role/shop change, suspension, concurrent edits |
| Shop isolation | Shop A update does not change Shop B; vendor cannot request another shop's profile, orders, finance, files, or images |
| Price configuration | All enabled combinations; disabled settings; missing cost/rate; N-up/duplex/copies; boundary page ranges; stale quote |
| Commission | Revenue/profit/unit examples; overrides; overlap rejection; immutable history; decimal rounding; fee greater than revenue |
| Money | Paid/refunded/unpaid distinctions; full/partial refund policy; delayed/duplicate webhook; refund after payout; concurrent batches |
| UI feedback | Loading, empty, unavailable, stale, success, failure, and retry; keyboard/screen reader; light/dark and reduced motion |
| PDF/printing | Actual content on every file; page selection/N-up/duplex; no double transformation; missing/encrypted file; printer unavailable; interrupted/restarted job |
| WhatsApp | Correct sender, wrong sender, expired/replayed challenge, duplicate event, signature failure, link conflict, revoked link, invalid media, retry |
| Customer | Shop select, login return, upload recovery, configure, add-ons, quote, payment pending/success, order tracking, support |

### 17.3 Persistence evidence

For each write: save → refetch → browser refresh → second authenticated session/client → database read of the intended record. Where safe, repeat after API restart to detect in-memory state masquerading as persistence.

Run mutation tests against seeded local/staging records. Do not alter real people, commercial rates, or bank settlements merely to prove that a button works. Compare aggregate queries against deterministic expected fixture values, then separately verify the deployed read paths.

### 17.4 Build and runtime gates

- Run type checks and the affected Next.js production builds; include root, admin, and customer entry points when shared shell/types change.
- Build the desktop with its current TypeScript/Vite command; run the relevant Cargo checks/tests when Rust/native behavior changes.
- Inspect changed pages at mobile, tablet, and desktop widths in both themes; include desktop window resizing.
- Check browser/runtime errors, data fetch failures, accessible controls, memory cleanup, and response payload privacy.
- Run appropriate regression once changes settle; do not rerun every unrelated historical test after a text-only adjustment.
- Record test environment explicitly: static, mocked browser, real staging persistence, provider test mode, production provider, or physical printer.
- Release notes state what was changed, what evidence passed, and what still requires live credentials/hardware. Mocked tests never establish live SMS, WhatsApp, payment, settlement, or printing success.

## 18. Decisions that must be made before their dependent stage

These are implementation choices to resolve at the relevant stage, not reasons to stop the whole redesign now.

| Decision | Recommended baseline |
|---|---|
| Vendor versus shop structure | Preserve supported one-owner/one-shop behavior first; use distinct identifiers and avoid assumptions in new contracts |
| Inactive/Pending meaning | Inactive means access disabled; Pending means activation/invitation incomplete; recency is separate |
| Fixed fee unit | Require explicit selected page / printed side / physical sheet; no ambiguous “per page” option |
| Profit costs | Admin-entered, versioned direct cost per service unit; label estimates honestly; disable without cost |
| Payment/tax/gateway treatment | Document the split before additional models launch; preserve existing treatment until explicitly changed |
| Shop publication edits | Vendor can publish ordinary profile/photo/hour changes; audit them; reserve owner/access/commission changes for admin |
| Image moderation | Validate files, scope storage, provide admin correction; add approval workflow only if operationally necessary |
| WhatsApp provider/number | Direct Cloud API baseline; verify business number/onboarding and current costs before provisioning |
| WhatsApp number mismatch | Require explicit separate verified-number flow; never overwrite the login phone silently |
| Document retention | Reuse current policy initially; choose and expose expiry for imported documents before rollout |
| Native platforms | Verify current macOS/CUPS path; add Windows/Linux claims only when their adapters and hardware tests exist |

## 19. Additional improvements worth prioritizing

1. **Setup readiness:** a shop checklist with links to missing prices, photographs, commission, or hours prevents broken customer flows.
2. **Customer-view preview:** let admin/vendor inspect the published shop card and supported settings before going live.
3. **Reconciliation inbox:** surface unallocated paid orders, unresolved refunds, and settlement mismatches as actionable work.
4. **Change history:** make commercial changes explainable when an owner asks why an order used a particular price.
5. **Unified terminology:** use the same names for sides, pages, sheets, statuses, services, and earnings throughout the three apps.
6. **Honest connectivity:** distinguish backend connected, data current, printer detected, printer ready, job submitted, and job finished.
7. **Safe recovery:** retain drafts and failed-action input; resolve unknown outcomes before retrying money or printing actions.

Defer decorative analytics, automatic payouts, complex tiered commissions, multi-shop ownership expansion, and additional desktop platforms until the core flows above are dependable.

## 20. Execution prompt for each future stage

> Implement Stage [ID] from astraplan.md against the current XerService state. Read only the relevant code and project instructions. Preserve prior changes, the shared backend, order/payment safeguards, and the cyan/magenta/black/white brand. Deliver the complete vertical slice described in that stage, including real persistence, correct authorization, clear feedback, responsive layouts, and accessible controls. Reuse existing components/dependencies; keep changes scoped. Label test/demo data explicitly and never substitute fake data for errors. Run affected tests and builds; verify save/reload and cross-shop isolation where relevant. Distinguish mocked, staging, provider, and physical-printer evidence. Report only changes, checks, and remaining issues. Stop at the completed stage boundary before starting the next stage.

## 21. Research notes

Official technical sources are linked beside the decisions they support. External research was used for Supabase phone channels, WhatsApp linking/message/media requirements, PDF.js rendering, native printer options, Tauri permissions, and accessible interaction behavior. Screen layouts, commercial policy structure, and rollout stages are product recommendations based on the user's request and inspected repository.

Some direct Meta developer documentation requests returned rate-limit/fetch errors. Accessible official WhatsApp pricing and Meta-maintained Postman references were used; the archived Meta SDK page is identified as historical protocol background. Confirm current API versions, onboarding, template approval, and rate cards during the integration stage.

This document is a delivery specification, not evidence that the proposed screens, commission models, support system, WhatsApp service, or physical preview parity have already been implemented.
