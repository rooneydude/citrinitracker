"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { login, type AuthState } from "./actions";

export default function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const signupOk = params.get("signup") === "ok";
  const [state, action, pending] = useActionState<AuthState, FormData>(
    login,
    undefined
  );

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Citrini Tracker</h1>
        <p className="text-foreground/40 text-sm mt-1">
          Sign in to access your portfolio
        </p>
      </div>

      {signupOk ? (
        <div className="mb-4 rounded-xl border border-accent/30 bg-accent-dim p-3 text-accent text-sm">
          Check your email to confirm your account, then sign in.
        </div>
      ) : null}

      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next} />
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
            autoComplete="current-password"
            required
            className="w-full bg-background border border-card-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent"
          />
        </div>
        {state?.error ? (
          <p className="text-red text-sm">{state.error}</p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full py-2.5 bg-accent text-background font-bold rounded-xl text-sm hover:bg-accent/80 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-center text-foreground/40 text-sm mt-6">
        Need an account?{" "}
        <Link
          href="/signup"
          className="text-accent hover:underline"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
