import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Tracker, { type InitialUserState } from "./Tracker";
import { GroupHolding, RobinhoodHolding } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // proxy.ts already redirects unauthenticated visitors, but check again so
  // we never accidentally render the tracker without a user.
  if (!user) redirect("/login");

  const [{ data: stateRow }, { data: tokenRow }] = await Promise.all([
    supabase.from("user_state").select("*").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("plaid_tokens")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const initialState: InitialUserState = {
    groupHoldings: (stateRow?.group_holdings as GroupHolding[] | null) ?? [],
    groupHoldingsParsedAt: stateRow?.group_holdings_parsed_at
      ? new Date(stateRow.group_holdings_parsed_at as string).getTime()
      : null,
    excluded: (stateRow?.excluded as string[] | null) ?? [],
    forceIncluded: (stateRow?.force_included as string[] | null) ?? [],
    portfolioValue:
      stateRow?.portfolio_value != null
        ? String(stateRow.portfolio_value)
        : "",
    rhHoldings: (stateRow?.rh_holdings as RobinhoodHolding[] | null) ?? [],
    plaidLastRefreshedAt: stateRow?.plaid_last_refreshed_at
      ? new Date(stateRow.plaid_last_refreshed_at as string).getTime()
      : null,
  };

  return (
    <Tracker
      userId={user.id}
      userEmail={user.email ?? ""}
      plaidInitiallyConnected={Boolean(tokenRow)}
      initialState={initialState}
    />
  );
}
