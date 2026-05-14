# Citrini Tracker

A portfolio rebalancer that lets you mirror a group's holdings on Robinhood.

1. **Sign in** with email + password (Supabase Auth).
2. **Upload** the group holdings `.xlsx`.
3. **Connect** Robinhood via Plaid (or paste a CSV / enter holdings manually).
4. **Get** a BUY/SELL trade list, with non-Robinhood stocks auto-excluded and their weight redistributed.

State (uploaded sheets, exclusions, Plaid tokens, current holdings) is persisted per user in Supabase with row-level security.

## Getting Started

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

Create a `.env.local` from `.env.example`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx

# Plaid (required for the Robinhood auto-import flow)
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_sandbox_or_production_secret
PLAID_ENV=sandbox   # or "production"
```

Get the Supabase values from `Project Settings → API` in the Supabase dashboard. The Plaid values come from the [Plaid dashboard](https://dashboard.plaid.com/).

If the Plaid values are unset, the "Connect Robinhood via Plaid" button surfaces a friendly error and users can still fall back to CSV paste or manual entry.

## Database

The Supabase project must have the `public.user_state` and `public.plaid_tokens` tables with RLS scoped to `auth.uid() = user_id`. Those are created by the project's existing migrations (`citrini_initial_schema`, `citrini_security_hardening`).

## Scripts

| Command         | What it does                  |
| --------------- | ----------------------------- |
| `npm run dev`   | Start the dev server          |
| `npm run build` | Production build              |
| `npm run start` | Serve the production build    |
| `npm run lint`  | Run ESLint                    |
| `npm test`      | Run the unit test suite       |

## Deploying

Deploys to **Vercel** with zero config:

1. Push this repo to GitHub.
2. Import the repo on Vercel.
3. Set the four env vars above in `Project Settings → Environment Variables`.
4. Add your production URL to `Authentication → URL Configuration → Site URL` and `Redirect URLs` in the Supabase dashboard so email-confirmation links return to the right host.

## Notes

- Plaid's sandbox returns generic brokerage data, not real Robinhood positions — use a Plaid **production** secret and the real Robinhood institution to see live holdings.
- This is not financial advice. Always verify trades before executing.
