import { getUserState } from "@/lib/userState";
import { createClient } from "@/lib/supabase/server";
import HomeClient from "./HomeClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [initialState, supabase] = await Promise.all([
    getUserState(),
    createClient(),
  ]);
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email ?? null;

  return <HomeClient initialState={initialState} email={email} />;
}
