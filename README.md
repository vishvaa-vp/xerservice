# XerService (Frontend-only Share Build)

This shared version is intentionally frontend-only.

## What was removed
- All Next.js API routes under `src/app/api/*`
- Supabase/database integration files
- Environment keys/secrets from `.env.local`

## How to run
```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Notes
- OTP/login, wallet top-up, and contact are now local demo flows (no backend calls).
- No database or external key is required in this shared copy.
