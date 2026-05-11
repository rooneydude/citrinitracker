import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { GroupHolding, RobinhoodHolding } from "@/lib/types";

// Shape stored in `public.user_state`. JSONB columns are typed as the
// in-memory shapes the app already uses everywhere else.
export interface UserState {
  groupHoldings: GroupHolding[];
  groupHoldingsParsedAt: number | null;
  excluded: string[];
  forceIncluded: string[];
  portfolioValue: string;
  rhHoldings: RobinhoodHolding[];
  plaidLastRefreshedAt: number | null;
  plaidConnected: boolean;
}

export const EMPTY_STATE: UserState = {
  groupHoldings: [],
  groupHoldingsParsedAt: null,
  excluded: [],
  forceIncluded: [],
  portfolioValue: "",
  rhHoldings: [],
  plaidLastRefreshedAt: null,
  plaidConnected: false,
};

interface UserStateRow {
  user_id: string;
  group_holdings: GroupHolding[] | null;
  group_holdings_parsed_at: string | null;
  excluded: string[] | null;
  force_included: string[] | null;
  portfolio_value: number | string | null;
  rh_holdings: RobinhoodHolding[] | null;
  plaid_last_refreshed_at: string | null;
}

function tsToMs(ts: string | null): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

// Memoized per-request so a page that needs both auth and state only
// hits Postgres once. React's `cache` is request-scoped, not global.
export const getUserState = cache(async (): Promise<UserState> => {
  const supabase = await createClient();

  // Auth is verified by the proxy; this just gets the uid for the query.
  // RLS would block cross-user reads anyway, but we still need to know
  // whether the row exists.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return EMPTY_STATE;

  const [stateRes, plaidRes] = await Promise.all([
    supabase
      .from("user_state")
      .select(
        "group_holdings, group_holdings_parsed_at, excluded, force_included, portfolio_value, rh_holdings, plaid_last_refreshed_at"
      )
      .eq("user_id", userData.user.id)
      .maybeSingle<Omit<UserStateRow, "user_id">>(),
    supabase
      .from("plaid_tokens")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle(),
  ]);

  const row = stateRes.data;
  if (!row) {
    return { ...EMPTY_STATE, plaidConnected: !!plaidRes.data };
  }

  const portfolioValue =
    row.portfolio_value === null || row.portfolio_value === undefined
      ? ""
      : String(row.portfolio_value);

  return {
    groupHoldings: row.group_holdings ?? [],
    groupHoldingsParsedAt: tsToMs(row.group_holdings_parsed_at),
    excluded: row.excluded ?? [],
    forceIncluded: row.force_included ?? [],
    portfolioValue,
    rhHoldings: row.rh_holdings ?? [],
    plaidLastRefreshedAt: tsToMs(row.plaid_last_refreshed_at),
    plaidConnected: !!plaidRes.data,
  };
});
