import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      '[Supabase] Warning: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing.'
    )
  }
}

export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || ''
)

export function getSupabaseClient() {
  return supabase
}

// Capture recovery before the page mounts; Supabase may consume the URL fragment during startup.
let recoverySession = false;
supabase.auth.onAuthStateChange(event => {
  if (event === 'PASSWORD_RECOVERY') recoverySession = true;
  if (event === 'SIGNED_OUT') recoverySession = false;
});
export function hasRecoverySession() { return recoverySession; }
const exchanges = new Map<string, ReturnType<typeof supabase.auth.exchangeCodeForSession>>();
export function exchangeAuthCode(code: string) {
  if (!exchanges.has(code)) exchanges.set(code, supabase.auth.exchangeCodeForSession(code));
  return exchanges.get(code)!;
}
export default supabase;
