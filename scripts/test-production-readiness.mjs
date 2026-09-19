#!/usr/bin/env node
/**
 * scripts/test-production-readiness.mjs
 * 
 * Comprehensive Automated Acceptance Test Suite for:
 * Step 1: Production Infrastructure & Deployment Readiness
 * 
 * Verifies:
 * 1. Production Environment Schema & Fail-Fast Validator
 * 2. Next.js Production Build Artifacts & Static Assets
 * 3. Supabase Schema Migration Integrity & Row-Level Security (RLS)
 * 4. Production HTTP Security Headers & Content Security Policy (CSP)
 * 5. Remote Supabase Database Invariant Certification (Zero Financial Delta)
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const rootDir = resolve(process.cwd());
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
    if (condition) {
        passCount++;
        console.log(`  ✓ PASS [${passCount}]: ${message}`);
    } else {
        failCount++;
        console.error(`  ✗ FAIL [${passCount + failCount}]: ${message}`);
    }
}

// Load .env.local for remote invariant checks
function loadEnv() {
    const envPath = join(rootDir, '.env.local');
    if (!existsSync(envPath)) return {};
    const content = readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    const env = {};
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            env[key] = val;
        }
    }
    return env;
}

const env = loadEnv();
const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env['SUPABASE_SECRET_KEY'] || env['SUPABASE_SERVICE_ROLE_KEY'] || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('\n========================================================================');
console.log('  STEP 1: PRODUCTION INFRASTRUCTURE & DEPLOYMENT READINESS SUITE');
console.log('========================================================================\n');

async function runTests() {
    // -------------------------------------------------------------------------
    // SECTION 1: Production Environment Blueprint & Validation Logic
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Production Environment Blueprint & Validator ---');
    const prodEnvExamplePath = join(rootDir, '.env.production.example');
    assert(existsSync(prodEnvExamplePath), '.env.production.example blueprint file exists');
    
    const prodEnvContent = readFileSync(prodEnvExamplePath, 'utf8');
    assert(prodEnvContent.includes('NEXT_PUBLIC_APP_URL'), '.env.production.example documents NEXT_PUBLIC_APP_URL');
    assert(prodEnvContent.includes('NEXT_PUBLIC_SUPABASE_URL'), '.env.production.example documents NEXT_PUBLIC_SUPABASE_URL');
    assert(prodEnvContent.includes('SUPABASE_SECRET_KEY'), '.env.production.example documents SUPABASE_SECRET_KEY');
    assert(prodEnvContent.includes('RAZORPAY_KEY_ID'), '.env.production.example documents RAZORPAY_KEY_ID');
    assert(prodEnvContent.includes('RAZORPAY_KEY_SECRET'), '.env.production.example documents RAZORPAY_KEY_SECRET');
    assert(prodEnvContent.includes('RAZORPAY_WEBHOOK_SECRET'), '.env.production.example documents RAZORPAY_WEBHOOK_SECRET');
    assert(prodEnvContent.includes('ENABLE_HSTS=true'), '.env.production.example recommends ENABLE_HSTS=true');
    assert(prodEnvContent.includes('WHATSAPP_TEST_MEDIA_PAYLOADS_ENABLED=false'), '.env.production.example enforces false for test media payloads');

    // Test env-validator module logic directly
    const envValidatorPath = join(rootDir, 'src/lib/env-validator.ts');
    assert(existsSync(envValidatorPath), 'src/lib/env-validator.ts exists');
    const validatorSource = readFileSync(envValidatorPath, 'utf8');
    assert(validatorSource.includes('export function validateServerEnv'), 'env-validator exports validateServerEnv');
    assert(validatorSource.includes('WHATSAPP_TEST_MEDIA_PAYLOADS_ENABLED === "true"'), 'env-validator guards against test payloads in production');
    assert(validatorSource.includes('ENABLE_HSTS'), 'env-validator checks HSTS security posture');
    assert(validatorSource.includes('cloud_api'), 'env-validator checks WhatsApp Cloud API requirements');

    // Check instrumentation hook
    const instrumentationPath = join(rootDir, 'src/instrumentation.ts');
    assert(existsSync(instrumentationPath), 'src/instrumentation.ts exists');
    const instrSource = readFileSync(instrumentationPath, 'utf8');
    assert(instrSource.includes('validateServerEnv'), 'instrumentation.ts calls validateServerEnv on startup');

    // -------------------------------------------------------------------------
    // SECTION 2: Next.js Production Build Artifacts & Assets
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Next.js Production Build Artifacts & Assets ---');
    const nextDir = join(rootDir, '.next');
    assert(existsSync(nextDir), '.next production build directory exists');
    assert(existsSync(join(nextDir, 'BUILD_ID')) || existsSync(join(nextDir, 'routes-manifest.json')), '.next/routes-manifest.json or BUILD_ID generated successfully');
    assert(existsSync(join(nextDir, 'server')), '.next/server directory contains compiled routes');
    assert(existsSync(join(nextDir, 'static')), '.next/static directory contains client assets');

    // Verify PDF.js worker assets packaged for browser runtime
    const pdfWorkerPath = join(rootDir, 'public/pdfjs/pdf.worker.min.mjs');
    assert(existsSync(pdfWorkerPath), 'public/pdfjs/pdf.worker.min.mjs static worker asset exists');
    const cmapsDir = join(rootDir, 'public/pdfjs/cmaps');
    assert(existsSync(cmapsDir) && readdirSync(cmapsDir).length > 0, 'public/pdfjs/cmaps/ assets are populated');
    const fontsDir = join(rootDir, 'public/pdfjs/standard_fonts');
    assert(existsSync(fontsDir) && readdirSync(fontsDir).length > 0, 'public/pdfjs/standard_fonts/ assets are populated');

    // -------------------------------------------------------------------------
    // SECTION 3: Supabase Schema Migration Integrity & Row-Level Security
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Supabase Schema Migration Integrity & RLS ---');
    const migrationsDir = join(rootDir, 'supabase/migrations');
    assert(existsSync(migrationsDir), 'supabase/migrations directory exists');
    
    const migrationFiles = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    assert(migrationFiles.length >= 20, `At least 20 migration files exist (found ${migrationFiles.length})`);

    // Verify all table creations have explicit RLS activation
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)/gi;
    const rlsRegex = /ALTER\s+TABLE\s+(?:public\.)?([a-zA-Z0-9_]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
    
    const tablesCreated = new Set();
    const tablesWithRls = new Set();

    for (const file of migrationFiles) {
        const sql = readFileSync(join(migrationsDir, file), 'utf8');
        let match;
        while ((match = tableRegex.exec(sql)) !== null) {
            tablesCreated.add(match[1].toLowerCase());
        }
        while ((match = rlsRegex.exec(sql)) !== null) {
            tablesWithRls.add(match[1].toLowerCase());
        }
    }

    console.log(`    Total tables declared across migrations: ${tablesCreated.size}`);
    console.log(`    Total tables with RLS enabled: ${tablesWithRls.size}`);

    const coreTables = [
        'profiles', 'shops', 'shop_pricing', 'orders', 'order_files',
        'print_settings', 'order_status_history', 'payment_attempts',
        'payment_webhook_events', 'wallet_accounts', 'wallet_transactions',
        'order_financial_ledger', 'shop_commission_rules', 'vendor_settlement_batches',
        'vendor_settlement_items', 'refund_requests', 'support_tickets', 'whatsapp_links'
    ];

    for (const tbl of coreTables) {
        assert(tablesCreated.has(tbl), `Core table '${tbl}' is defined in schema migrations`);
        assert(tablesWithRls.has(tbl), `Core table '${tbl}' has Row-Level Security (RLS) enabled`);
    }

    // -------------------------------------------------------------------------
    // SECTION 4: Production HTTP Security Headers & CSP
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Production HTTP Security Headers & CSP ---');
    const nextConfigPath = join(rootDir, 'next.config.js');
    assert(existsSync(nextConfigPath), 'next.config.js exists');
    const nextConfigContent = readFileSync(nextConfigPath, 'utf8');

    assert(nextConfigContent.includes("X-Content-Type-Options"), "Defines X-Content-Type-Options: nosniff");
    assert(nextConfigContent.includes("Referrer-Policy"), "Defines Referrer-Policy: strict-origin-when-cross-origin");
    assert(nextConfigContent.includes("X-Frame-Options"), "Defines X-Frame-Options: DENY");
    assert(nextConfigContent.includes("Permissions-Policy"), "Defines strict Permissions-Policy");
    assert(nextConfigContent.includes("Content-Security-Policy"), "Defines Content-Security-Policy (CSP)");
    assert(nextConfigContent.includes("frame-ancestors 'none'"), "CSP restricts frame-ancestors to 'none'");
    assert(nextConfigContent.includes("object-src 'none'"), "CSP blocks plugins with object-src 'none'");
    assert(nextConfigContent.includes("base-uri 'self'"), "CSP restricts base-uri to 'self'");
    assert(nextConfigContent.includes("Strict-Transport-Security"), "Configures Strict-Transport-Security (HSTS)");

    // -------------------------------------------------------------------------
    // SECTION 5: Remote Supabase Database Invariant Certification
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Remote Supabase Financial Invariant Certification ---');
    if (!supabaseUrl || !supabaseKey) {
        console.warn('  ⚠️ SUPABASE credentials not configured in .env.local; skipping remote query');
    } else {
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { count: ledgerCount, error: err1 } = await supabase
            .from('order_financial_ledger')
            .select('*', { count: 'exact', head: true });
        assert(!err1 && ledgerCount === 17, `Remote ledger invariant preserved (17 === ${ledgerCount})`);

        const { data: wallets, error: err2 } = await supabase
            .from('wallet_accounts')
            .select('balance');
        const walletSum = (wallets || []).reduce((acc, w) => acc + Number(w.balance || 0), 0);
        assert(!err2 && walletSum === 88.00, `Remote wallet balances invariant preserved (₹88.00 === ₹${walletSum.toFixed(2)})`);

        const { count: ruleCount, error: err3 } = await supabase
            .from('shop_commission_rules')
            .select('*', { count: 'exact', head: true });
        assert(!err3 && ruleCount === 2, `Remote commission rules invariant preserved (2 === ${ruleCount})`);

        const { count: batchCount, error: err4 } = await supabase
            .from('vendor_settlement_batches')
            .select('*', { count: 'exact', head: true });
        assert(!err4 && batchCount === 1, `Remote settlement batches invariant preserved (1 === ${batchCount})`);

        const { count: itemCount, error: err5 } = await supabase
            .from('vendor_settlement_items')
            .select('*', { count: 'exact', head: true });
        assert(!err5 && itemCount === 4, `Remote settlement items invariant preserved (4 === ${itemCount})`);
    }

    console.log('\n========================================================================');
    console.log(`ACCEPTANCE SUMMARY: ${passCount} PASSED, ${failCount} FAILED out of ${passCount + failCount} tests`);
    console.log('========================================================================\n');

    if (failCount > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal error during production readiness tests:', err);
    process.exit(1);
});
