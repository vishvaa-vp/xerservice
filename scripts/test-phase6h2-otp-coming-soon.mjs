import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const login = read('src/app/login/page.tsx');
const profile = read('src/app/dashboard/profile/page.tsx');
const linkPhone = read('src/components/profile/LinkPhoneModal.tsx');
const vendorLogin = read('apps/vendor/src/app/vendor/login/page.tsx');
const migration = read('supabase/migrations/20260909120000_harden_verified_phone_identity.sql');
const outbox = read('src/lib/notification-outbox.ts');
const notifications = read('src/app/api/notifications/route.ts');
const env = read('.env.local');

const checks = [
    ['email and Google login remain available', login.includes('signInWithPassword') && login.includes('signInWithOAuth')],
    ['phone authentication flags are enabled', env.includes('PHONE_AUTH_ENABLED=true') && env.includes('NEXT_PUBLIC_PHONE_AUTH_ENABLED=true')],
    ['mobile OTP action is wired to the existing form', login.includes("setStep('mobile')") && login.includes('Mobile OTP Login')],
    ['OTP requests use Supabase Auth', login.includes('supabase.auth.signInWithOtp({') && login.includes('phone: normalized')],
    ['new numbers can receive OTP and create accounts', login.includes('shouldCreateUser: true')],
    ['OTP verification uses the SMS challenge', login.includes('supabase.auth.verifyOtp({') && login.includes("type: 'sms'")],
    ['Indian phone numbers are normalized before requests', login.includes('normalizePhoneNumber(mobile)') && login.includes('isValidIndianMobile(mobile)')],
    ['phone sync creates or links profile upon verification', login.includes('/api/customer/phone/sync')],
    ['OTP requires six digits', login.includes("otp.join('')") && login.includes('code.length < 6')],
    ['OTP resend has a cooldown', login.includes('setCountdown(60)') && login.includes('Resend OTP in {countdown}s')],
    ['request and verification errors stay visible', login.includes('Failed to send OTP. Please try again.') && login.includes('The OTP you entered is incorrect')],
    ['OTP values are never logged', !login.includes('console.log(otp') && !linkPhone.includes('console.log(otp')],
    ['vendor login remains email and password only', vendorLogin.includes('signInWithPassword') && !vendorLogin.includes('signInWithOtp')],
    ['profile editing cannot directly write a phone number', !profile.includes('updateProfile({ phone')],
    ['phone linking still verifies through Supabase', linkPhone.includes('supabase.auth.updateUser') && linkPhone.includes("type: 'phone_change'")],
    ['verified phone database protection remains active', migration.includes('protect_profile_phone_identity') && migration.includes('BEFORE INSERT OR UPDATE ON public.profiles')],
    ['verified phone synchronization remains least privilege', migration.includes('sync_verified_phone_to_profile') && migration.includes('GRANT EXECUTE ON FUNCTION public.sync_verified_phone_to_profile() TO authenticated;')],
    ['authentication OTP stays outside app notifications', !outbox.includes('signInWithOtp') && !notifications.includes('OTP')],
];

let passed = 0;
for (const [name, condition] of checks) {
    assert.ok(condition, name);
    passed += 1;
    console.log(`PASS ${name}`);
}
console.log(`${passed} enabled phone OTP checks passed; no SMS was sent.`);
