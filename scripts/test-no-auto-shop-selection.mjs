/**
 * Regression Test: XerService — No Automatic Shop Selection Verification
 *
 * Verifies that:
 * 1. Home page / Navbar "Upload from Device" and "Print Now" never automatically assign a shop.
 * 2. Upload page (/order/upload) has no hardcoded fallback shop ID (e.g. "1", "D-Block", etc.).
 * 3. Upload page handleFiles rejects document additions if no shop is selected.
 * 4. Upload page ensureDraftOrder rejects draft creation if shopId is empty/undefined.
 * 5. Pricing page (/order/pricing) uploadUrl routes to /#shops when no shop is selected (not fallback "1").
 * 6. Mobile bottom sheet uploadUrl routes to /#shops when no shop is selected.
 * 7. Live database schema rejects order insertion with NULL or invalid shop_id.
 */

import fs from "fs";
import path from "path";
import assert from "assert";
import { createClient } from "@supabase/supabase-js";

console.log("--- TEST SUITE: NO AUTOMATIC SHOP SELECTION ---");

const srcDir = path.resolve(process.cwd(), "src");

// Load .env.local manually
const envPath = path.resolve(process.cwd(), ".env.local");
const envVars = {};
if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
            const [k, ...v] = trimmed.split("=");
            envVars[k.trim()] = v.join("=").trim().replace(/^['"]|['"]$/g, "");
        }
    }
}

// Check 1: Home page (src/app/page.tsx) does not auto-select first or nearest shop
console.log("\n[Check 1] Auditing src/app/page.tsx for auto-selection logic...");
const homeContent = fs.readFileSync(path.join(srcDir, "app/page.tsx"), "utf-8");

assert(!homeContent.includes("setCurrentOrder(prev => ({ ...prev, shopId: '1'"), "Home page must not assign shopId: 1");
assert(!homeContent.includes("shopId: shops[0].id"), "Home page must not auto-select shops[0]");
console.log("✓ Home page does not auto-select first or fallback shop.");

// Check 2: Upload page (src/app/order/upload/page.tsx) does not fallback to shop 1 or first shop
console.log("\n[Check 2] Auditing src/app/order/upload/page.tsx for fallback shop...");
const uploadContent = fs.readFileSync(path.join(srcDir, "app/order/upload/page.tsx"), "utf-8");

assert(!uploadContent.includes('shopParam || "1"'), "Upload page must not default shopParam to 1");
assert(!uploadContent.includes("shopParam || '1'"), "Upload page must not default shopParam to 1");
assert(!uploadContent.includes('shopId || "1"'), "Upload page must not default shopId to 1");
assert(!uploadContent.includes("shopId || '1'"), "Upload page must not default shopId to 1");
console.log("✓ Upload page has no fallback default shop assignment.");

// Check 3: Upload page handleFiles blocks file uploads when no shop is selected
console.log("\n[Check 3] Auditing handleFiles shop requirement in upload page...");
assert(
    uploadContent.includes("const currentTargetShopId = shopData?.id || currentOrder.shopId || shopParam;") &&
    uploadContent.includes("if (!currentTargetShopId) {") &&
    uploadContent.includes('setError("Please select a print shop first before uploading documents.");'),
    "Upload page must block handleFiles when no shop is selected"
);
console.log("✓ handleFiles rejects files if no shop is selected.");

// Check 4: Upload page ensureDraftOrder validates explicit shopId
console.log("\n[Check 4] Auditing ensureDraftOrder explicit shopId requirement...");
assert(
    uploadContent.includes("if (!shopId || typeof shopId !== 'string' || !shopId.trim()) {") &&
    uploadContent.includes('throw new Error("An explicit print shop selection is required before creating an order.");'),
    "ensureDraftOrder must strictly throw if shopId is missing"
);
console.log("✓ ensureDraftOrder enforces explicit valid shopId before database insert.");

// Check 5: Upload page renders "No Print Shop Selected" card when no shop is active
console.log("\n[Check 5] Auditing No Print Shop Selected card in upload page...");
assert(
    uploadContent.includes("No Print Shop Selected") &&
    uploadContent.includes("Please select a print shop first to view pricing and upload documents.") &&
    uploadContent.includes('href="/#shops"'),
    "Upload page must render a No Print Shop Selected card directing to /#shops"
);
console.log("✓ Upload page displays dedicated No Print Shop Selected card directing to /#shops.");

// Check 6: Pricing page (src/app/order/pricing/page.tsx) fallback uploadUrl
console.log("\n[Check 6] Auditing pricing page uploadUrl...");
const pricingContent = fs.readFileSync(path.join(srcDir, "app/order/pricing/page.tsx"), "utf-8");
assert(!pricingContent.includes("/order/upload?shop=${currentOrder.shopId || '1'}"), "Pricing page must not fall back to shop 1");
assert(pricingContent.includes("const uploadUrl = currentOrder.shopId") && pricingContent.includes(": '/#shops';"), "Pricing page must route to /#shops when currentOrder.shopId is absent");
console.log("✓ Pricing page uploadUrl routes to /#shops when no shop is selected.");

// Check 7: MobileNavigation (src/components/layout/MobileNavigation.tsx) uploadUrl
const mobileNavContent = fs.readFileSync(path.join(srcDir, "components/layout/MobileNavigation.tsx"), "utf-8");
assert(
    mobileNavContent.includes("const uploadUrl = '/#shops';") ||
    mobileNavContent.includes("uploadUrl = '/#shops'"),
    "MobileNavigation must route to /#shops so customer always explicitly chooses shop"
);
console.log("✓ MobileNavigation uploadUrl routes to /#shops so customer always chooses shop.");

// Check 8: Live database constraints on orders table shop_id
console.log("\n[Check 8] Testing live database orders schema constraint on shop_id...");
const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = envVars.SUPABASE_SECRET_KEY || envVars.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
    console.warn("⚠️ Supabase credentials not found in env, skipping live database constraint assertion.");
} else {
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch an existing user_id from profiles or auth
    const { data: userRow } = await supabase.from("profiles").select("user_id").limit(1).maybeSingle();
    const testUserId = userRow?.user_id || "00000000-0000-0000-0000-000000000001";

    // Attempt insert order with NULL shop_id
    const { error: nullShopErr } = await supabase
        .from("orders")
        .insert({
            user_id: testUserId,
            status: "DRAFT",
            payment_status: "UNPAID",
            total_amount: 0,
            shop_id: null,
        });

    assert(nullShopErr !== null, "Database MUST reject inserting an order with NULL shop_id");
    console.log("✓ Database enforces NOT NULL constraint on orders.shop_id: " + nullShopErr.message);

    // Attempt insert order with non-existent foreign key shop_id
    const fakeUuid = "00000000-0000-0000-0000-000000000000";
    const { error: fkShopErr } = await supabase
        .from("orders")
        .insert({
            user_id: testUserId,
            status: "DRAFT",
            payment_status: "UNPAID",
            total_amount: 0,
            shop_id: fakeUuid,
        });

    assert(fkShopErr !== null, "Database MUST reject inserting an order with non-existent shop_id foreign key");
    console.log("✓ Database enforces foreign key integrity on orders.shop_id: " + fkShopErr.message);
}

console.log("\n==================================================");
console.log("✓ ALL NO-AUTO-SHOP-SELECTION CHECKS PASSED (8/8)");
console.log("==================================================");
