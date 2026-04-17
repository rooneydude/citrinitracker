# Citrini Tracker

A portfolio rebalancer that lets you mirror a group's holdings on Robinhood.

1. **Upload** the group holdings `.xlsx`.
2. **Connect** Robinhood via Plaid (or paste a CSV / enter holdings manually).
3. **Get** a BUY/SELL trade list, with non-Robinhood stocks auto-excluded and their weight redistributed.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

The Plaid auto-import flow needs credentials from the [Plaid dashboard](https://dashboard.plaid.com/). Create a `.env.local` in the project root:

```bash
# Required for the Plaid auto-import flow
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_sandbox_or_production_secret

# Optional. "sandbox" (default) or "production". The legacy "development"
# environment was removed in plaid v41+.
PLAID_ENV=sandbox
```

If these are unset, the "Connect Robinhood via Plaid" button will surface a
friendly error and users can still fall back to CSV paste or manual entry.

## Scripts

| Command         | What it does                  |
| --------------- | ----------------------------- |
| `npm run dev`   | Start the dev server          |
| `npm run build` | Production build              |
| `npm run start` | Serve the production build    |
| `npm run lint`  | Run ESLint                    |

## Deploying

The app is configured for Railway (`next.config.ts` uses `output: "standalone"`), but it also deploys cleanly to Vercel with zero config. Just set the `PLAID_*` env vars in the platform's dashboard.

## Notes

- Plaid's sandbox returns generic brokerage data, not real Robinhood positions — use a Plaid **production** secret and the real Robinhood institution to see live holdings.
- This is not financial advice. Always verify trades before executing.
