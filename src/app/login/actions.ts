"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function validate(formData: FormData): { email: string; password: string } | string {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !email.includes("@")) return "Enter a valid email";
  if (password.length < 6) return "Password must be at least 6 characters";
  return { email, password };
}

export async function login(formData: FormData) {
  const parsed = validate(formData);
  if (typeof parsed === "string") {
    redirect(`/login?error=${encodeURIComponent(parsed)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed);
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signup(formData: FormData) {
  const parsed = validate(formData);
  if (typeof parsed === "string") {
    redirect(`/login?error=${encodeURIComponent(parsed)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp(parsed);
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  // If email confirmation is enabled in Supabase, the user must verify before
  // signing in. We surface that as a notice on the login page.
  redirect("/login?message=Check%20your%20email%20to%20confirm%20your%20account");
}
