"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup, type AuthState } from "@/app/login/actions";

export default function SignupForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    signup,
    undefined
  );

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Citrini Tracker</h1>
        <p className="text-foreground/40 text-sm mt-1">
          Create an account to sync across devices
        </p>
      </div>

      <form action={action} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-semibold text-foreground/70 mb-1"
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="w-full bg-background border border-card-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-semibold text-foreground/70 mb-1"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            className="w-full bg-background border border-card-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent"
          />
          <p className="text-foreground/30 text-xs mt-1">
            At least 8 characters.
          </p>
        </div>
        {state?.error ? (
          <p className="text-red text-sm">{state.error}</p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full py-2.5 bg-accent text-background font-bold rounded-xl text-sm hover:bg-accent/80 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="text-center text-foreground/40 text-sm mt-6">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
