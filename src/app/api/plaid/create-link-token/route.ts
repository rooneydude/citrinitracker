import { NextResponse } from "next/server";
import { plaidClient, assertPlaidConfigured } from "@/lib/plaid";
import { Products, CountryCode } from "plaid";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const configError = assertPlaidConfigured();
  if (configError) {
    return NextResponse.json({ error: configError }, { status: 500 });
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const response = await plaidClient.linkTokenCreate({
      // Use the Supabase user id as Plaid's client_user_id. This lets us
      // reconcile webhooks to the right user later if we add them.
      user: { client_user_id: userData.user.id },
      client_name: "Citrini Tracker",
      products: [Products.Investments],
      country_codes: [CountryCode.Us],
      language: "en",
    });

    return NextResponse.json({ link_token: response.data.link_token });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to create link token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
