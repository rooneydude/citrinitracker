import { NextResponse } from "next/server";
import { plaidClient, assertPlaidConfigured } from "@/lib/plaid";
import { Products, CountryCode } from "plaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const configError = assertPlaidConfigured();
  if (configError) {
    return NextResponse.json({ error: configError }, { status: 500 });
  }

  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: "citrini-user" },
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
