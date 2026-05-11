# Citrini Tracker

A portfolio rebalancer that lets you mirror a group's holdings on Robinhood.

1. **Sign up** with email + password (Supabase Auth).
2. **Upload** the group holdings `.xlsx`.
3. **Connect** Robinhood via Plaid (or paste a CSV / enter holdings manually).
4. **Get** a BUY/SELL trade list, with non-Robinhood stocks auto-excluded and their weight redistributed.

State (holdings, exclusions, Plaid connection) is synced to Supabase per user, so you can sign in from any device and pick up where you left off.

## Getting Started

```bash
npm install
cp .env.example .env.local   # then fill in the real values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

See `.env.example` for the full list. Two groups:

**Supabase (publishable, safe in the browser):**

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxx
```

**Plaid (server-only):**

```bash
PLAID_CLIENT_ID=...
PLAID_SECRET=...
PLAID_ENV=sandbox    # or "production"
```

If the Plaid vars are unset, the "Connect Robinhood via Plaid" button still fails gracefully and users can fall back to CSV paste / manual entry.

## Scripts

| Command         | What it does                  |
| --------------- | ----------------------------- |
| `npm run dev`   | Start the dev server          |
| `npm run build` | Production build              |
| `npm run start` | Serve the production build    |
| `npm run lint`  | Run ESLint                    |
| `npm test`      | Run vitest                    |

## Architecture

- **Next.js 16 App Router** (note: middleware is now `proxy.ts` in v16).
- **Supabase Auth** with cookie-based sessions via `@supabase/ssr`.
- **Row Level Security** on every table — every row is keyed to `auth.uid()`. A user can never read or write another user's data, even if they craft a request directly against the REST API.
- **Plaid access tokens are stored server-side only** in the `plaid_tokens` table. The browser never sees them. API routes read the token from Supabase under the current user's auth context.
- State persistence uses Next.js Server Actions, debounced for the inputs that change rapidly.

## Database schema

Two tables in `public`:

- `user_state` — group holdings, exclusions, portfolio value, manual RH holdings, last-Plaid-refresh timestamp.
- `plaid_tokens` — Plaid `access_token` + `item_id`, one row per user.

Both tables have RLS policies that restrict every operation (`select`, `insert`, `update`, `delete`) to the row where `auth.uid() = user_id`. The `anon` role has no privileges on either table at all (defense in depth).

## Deploying to Vercel

1. Push to GitHub.
2. Import the repo in Vercel.
3. Add the env vars from `.env.example` in **Project Settings → Environment Variables** (use real values from your Supabase + Plaid dashboards).
4. In Supabase **Project Settings → Authentication → URL Configuration**, set the **Site URL** to your Vercel URL and add `https://your-vercel-url.vercel.app/auth/callback` to the redirect allowlist.
5. Recommended: enable **leaked password protection** in Supabase → Authentication → Password Strength (checks new passwords against HaveIBeenPwned).

## Notes

- Plaid's sandbox returns generic brokerage data, not real Robinhood positions — use a Plaid **production** secret and the real Robinhood institution to see live holdings.
- This is not financial advice. Always verify trades before executing.
