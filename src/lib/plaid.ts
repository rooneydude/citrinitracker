import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

// Plaid removed the "development" environment in v41+, so we only support
// sandbox and production. Defaults to sandbox when PLAID_ENV is unset.
const envMap: Record<string, string> = {
  sandbox: PlaidEnvironments.sandbox,
  production: PlaidEnvironments.production,
};

const basePath =
  envMap[(process.env.PLAID_ENV ?? "sandbox").toLowerCase()] ??
  PlaidEnvironments.sandbox;

const configuration = new Configuration({
  basePath,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID ?? "",
      "PLAID-SECRET": process.env.PLAID_SECRET ?? "",
    },
  },
});

export const plaidClient = new PlaidApi(configuration);

export function assertPlaidConfigured(): string | null {
  if (!process.env.PLAID_CLIENT_ID) return "PLAID_CLIENT_ID is not set";
  if (!process.env.PLAID_SECRET) return "PLAID_SECRET is not set";
  return null;
}
