import { Suspense } from "react";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in — Citrini Tracker" };

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <Suspense
        fallback={
          <div className="text-foreground/40 text-sm">Loading…</div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
